//! Lifecycle tests for the Tender template: full tenders run end to end
//! on the real engine, through the Circle template for binding.

mod common;

use common::*;
use tari_template_lib::prelude::*;
use tari_template_test_tooling::transaction::args;

#[test]
fn full_tender_settles_and_every_bucket_is_accounted() {
    let mut s = setup();
    let info0 = info(&mut s);
    assert!(info0.bound, "tender must be bound after registration");
    assert_eq!(info0.state, asiri_types::TenderState::Draft);

    lock(&mut s);
    let info1 = info(&mut s);
    assert_eq!(info1.state, asiri_types::TenderState::Open);
    assert!(info1.rules_hash.is_some(), "rules hash recorded at lock");

    // Five sellers commit. Prices in a scrambled order.
    let prices = [9_000u128, 8_500, 8_000, 9_500, 10_000];
    let mut sellers = Vec::new();
    for (i, price) in prices.iter().enumerate() {
        let seller = make_seller(&mut s.test, 40 + i as u8);
        commit(&mut s, &seller, *price);
        sellers.push(seller);
    }
    // Four reveal. Seller 4 (price 10_000) stays silent.
    set_epoch(&mut s.test, 5);
    for (i, seller) in sellers.iter().enumerate().take(4) {
        reveal(&mut s, seller, prices[i]);
    }
    let info2 = info(&mut s);
    assert_eq!(info2.commitments_count, 5);
    assert_eq!(info2.reveals_count, 4);

    // Close: the 8_000 bid wins. The silent bond is forfeited in halves.
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);
    let info3 = info(&mut s);
    assert_eq!(info3.state, asiri_types::TenderState::Awarded);
    let award = info3.award.clone().expect("award recorded");
    assert_eq!(award.winner, sellers[2].key);
    assert_eq!(award.winning_price, Amount::new(8_000));
    assert_eq!(award.commitments_count, 5);
    assert_eq!(award.reveals_count, 4);
    assert!(!award.by_override);
    assert_eq!(info3.forfeit_for_circle, Amount::new(50));
    assert_eq!(info3.forfeit_locked, Amount::new(50));

    // Override window (3 epochs from epoch 10) passes, delivery is
    // confirmed by two distinct approvers.
    set_epoch(&mut s.test, 13);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "advance_delivery", args![])
            .build_and_seal(s.test.secret_key()),
        vec![],
    );
    confirm_delivery(&mut s, 0);
    let mid = info(&mut s);
    assert_eq!(mid.state, asiri_types::TenderState::AwaitingDelivery);
    confirm_delivery(&mut s, 1);
    let settled = info(&mut s);
    assert_eq!(settled.state, asiri_types::TenderState::Settled);
    let settlement = settled.settlement.clone().expect("settlement recorded");
    assert_eq!(settlement.winner, sellers[2].key);
    assert_eq!(settlement.price, Amount::new(8_000));

    // The winner claims the payment into their account, and the receipt.
    let winner = &sellers[2];
    let before = balance(&mut s.test, winner.account);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "claim_payment", args![])
            .put_last_instruction_output_on_workspace("pay")
            .call_method(winner.account, "deposit", args![Workspace("pay")])
            .call_method(s.tender, "claim_receipt", args![])
            .put_last_instruction_output_on_workspace("receipt")
            .call_method(winner.account, "deposit", args![Workspace("receipt")])
            .build_and_seal(&winner.secret),
        vec![winner.proof.clone()],
    );
    let after = balance(&mut s.test, winner.account);
    assert_eq!(after - before, Amount::new(8_000));
    let withinfo = info(&mut s);
    assert!(withinfo.receipt_id.is_some(), "receipt issued at claim");

    // The circle claims the unspent escrow (10_000 - 8_000) and its
    // forfeit half into the treasury.
    let (a0_account, a0_proof, a0_secret) = {
        let a = &s.approvers[0];
        (a.0, a.1.clone(), a.2.clone())
    };
    let _ = a0_account;
    let _ = a0_proof;
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.circle, "collect_tender_refund", args![s.tender])
            .call_method(s.circle, "collect_tender_forfeits", args![s.tender])
            .build_and_seal(&a0_secret),
        vec![],
    );
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.circle, "treasury_balance", args![])
            .build_and_seal(s.test.secret_key()),
        vec![],
    );
    assert_eq!(s.test.expect_return::<Amount>(0), Amount::new(2_050));

    // Revealed sellers claim their bonds back in full. The silent
    // seller's bond is gone: their claim is rejected.
    for (i, seller) in sellers.iter().enumerate().take(4) {
        let before = balance(&mut s.test, seller.account);
        s.test.execute_expect_success(
            s.test
                .transaction()
                .call_method(s.tender, "claim_bond", args![])
                .put_last_instruction_output_on_workspace("bond")
                .call_method(seller.account, "deposit", args![Workspace("bond")])
                .build_and_seal(&seller.secret),
            vec![seller.proof.clone()],
        );
        let after = balance(&mut s.test, seller.account);
        assert_eq!(after - before, Amount::new(BOND), "seller {i} bond returned");
    }
    let silent = &sellers[4];
    let reason = s.test.execute_expect_failure(
        s.test
            .transaction()
            .call_method(s.tender, "claim_bond", args![])
            .build_and_seal(&silent.secret),
        vec![],
    );
    assert!(
        format!("{reason}").contains("no returnable bond"),
        "unexpected rejection: {reason}"
    );

    // The locked half never moves again. Every claim path is now
    // closed, and the tender still records the locked 50: it sits in
    // the bond vault with no method that can release it.
    let reason = s.test.execute_expect_failure(
        s.test
            .transaction()
            .call_method(s.circle, "collect_tender_forfeits", args![s.tender])
            .build_and_seal(&a0_secret),
        vec![],
    );
    assert!(
        format!("{reason}").contains("already claimed"),
        "unexpected rejection: {reason}"
    );
    let end = info(&mut s);
    assert_eq!(end.forfeit_locked, Amount::new(50));
    assert_eq!(end.forfeit_for_circle, Amount::new(50));
}

#[test]
fn tie_breaks_by_earliest_reveal() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 51);
    let b = make_seller(&mut s.test, 52);
    commit(&mut s, &a, 7_000);
    commit(&mut s, &b, 7_000);
    set_epoch(&mut s.test, 5);
    // B reveals first, A second, same price: B wins the tie.
    reveal(&mut s, &b, 7_000);
    reveal(&mut s, &a, 7_000);
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);
    let inf = info(&mut s);
    let award = inf.award.expect("award recorded");
    assert_eq!(award.winner, b.key);
    assert_eq!(award.winning_price, Amount::new(7_000));
}

#[test]
fn one_reveal_tender_awards_that_bid() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 53);
    let b = make_seller(&mut s.test, 54);
    commit(&mut s, &a, 6_000);
    commit(&mut s, &b, 5_000);
    set_epoch(&mut s.test, 5);
    reveal(&mut s, &a, 6_000);
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);
    let inf = info(&mut s);
    let award = inf.award.expect("award recorded");
    assert_eq!(award.winner, a.key);
    assert_eq!(award.reveals_count, 1);
    assert_eq!(award.commitments_count, 2);
    // B stayed silent while an award was there to take: forfeited.
    assert_eq!(inf.forfeit_for_circle, Amount::new(50));
    assert_eq!(inf.forfeit_locked, Amount::new(50));
}

#[test]
fn zero_reveal_tender_expires_with_full_refunds() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 55);
    let b = make_seller(&mut s.test, 56);
    commit(&mut s, &a, 6_000);
    commit(&mut s, &b, 5_000);
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);
    let inf = info(&mut s);
    assert_eq!(inf.state, asiri_types::TenderState::Expired);
    assert!(inf.award.is_none());
    assert_eq!(inf.forfeit_for_circle, Amount::zero());
    assert_eq!(inf.forfeit_locked, Amount::zero());
    // Both bonds are claimable in full.
    for seller in [&a, &b] {
        let before = balance(&mut s.test, seller.account);
        s.test.execute_expect_success(
            s.test
                .transaction()
                .call_method(s.tender, "claim_bond", args![])
                .put_last_instruction_output_on_workspace("bond")
                .call_method(seller.account, "deposit", args![Workspace("bond")])
                .build_and_seal(&seller.secret),
            vec![seller.proof.clone()],
        );
        let after = balance(&mut s.test, seller.account);
        assert_eq!(after - before, Amount::new(BOND));
    }
    // The full escrow is refundable to the circle.
    let a0_secret = s.approvers[0].2.clone();
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.circle, "collect_tender_refund", args![s.tender])
            .call_method(s.circle, "treasury_balance", args![])
            .build_and_seal(&a0_secret),
        vec![],
    );
    assert_eq!(s.test.expect_return::<Amount>(1), Amount::new(CAP));
}

/// The lowest bid wins even when it is the last one revealed: reveal
/// order decides ties, never the winner on price.
#[test]
fn last_revealer_wins() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 51);
    let b = make_seller(&mut s.test, 52);
    let c = make_seller(&mut s.test, 53);
    commit(&mut s, &a, 9_000);
    commit(&mut s, &b, 8_500);
    commit(&mut s, &c, 8_000);
    set_epoch(&mut s.test, 5);
    reveal(&mut s, &a, 9_000);
    reveal(&mut s, &b, 8_500);
    reveal(&mut s, &c, 8_000);
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);
    let award = info(&mut s).award.expect("an award is recorded");
    assert_eq!(award.winner, c.key);
    assert_eq!(award.winning_price, Amount::new(8_000));
}

/// An override proposal that never reaches its threshold before the
/// override window closes changes nothing: delivery proceeds on the
/// computed award and the computed winner is the one who settles.
#[test]
fn override_window_lapses_with_a_pending_proposal() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 54);
    let b = make_seller(&mut s.test, 55);
    commit(&mut s, &a, 8_000);
    commit(&mut s, &b, 9_000);
    set_epoch(&mut s.test, 5);
    reveal(&mut s, &a, 8_000);
    reveal(&mut s, &b, 9_000);
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);

    let proposer = s.approvers[0].2.clone();
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(
                s.tender,
                "propose_override",
                args![Some(b.key), Hash32::from_array([7u8; 32])],
            )
            .build_and_seal(&proposer),
        vec![],
    );
    let id: u32 = s.test.expect_return(0);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "sign_override", args![id])
            .build_and_seal(&proposer),
        vec![],
    );
    assert!(
        !s.test.expect_return::<bool>(0),
        "one signature is below the threshold, nothing executes"
    );

    // The window closes with the proposal pending. Delivery advances
    // on the computed award.
    set_epoch(&mut s.test, 13);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "advance_delivery", args![])
            .build_and_seal(s.test.secret_key()),
        vec![],
    );
    confirm_delivery(&mut s, 0);
    confirm_delivery(&mut s, 1);
    let inf = info(&mut s);
    assert_eq!(inf.state, asiri_types::TenderState::Settled);
    let award = inf.award.expect("the computed award stands");
    assert_eq!(award.winner, a.key);
    assert_eq!(award.winning_price, Amount::new(8_000));
}
