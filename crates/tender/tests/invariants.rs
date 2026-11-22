//! Invariant and adversarial tests for the Tender template. Each test
//! names the invariant it defends. The numbering matches the invariant
//! list in the project README.

mod common;

use common::*;
use tari_template_lib::prelude::*;
use tari_template_test_tooling::transaction::args;

/// Builds the transaction first, then asserts the engine rejects it
/// with a reason containing the needle.
macro_rules! expect_fail {
    ($s:expr, $tx:expr, $needle:expr) => {{
        let tx = $tx;
        let reason = $s.test.execute_expect_failure(tx, vec![]);
        assert!(
            format!("{reason}").contains($needle),
            "expected rejection containing '{}', got: {reason}",
            $needle
        );
    }};
}

/// I1: once the rules are locked and funded, no call can change them.
#[test]
fn i1_rules_are_immutable_once_locked() {
    let mut s = setup();
    // In Draft an approver may still revise the rules.
    let secret = s.approvers[0].2.clone();
    let mut revised = s.rules.clone();
    revised.budget_cap = Amount::new(9_000);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "update_rules", args![revised])
            .build_and_seal(&secret),
        vec![],
    );
    // Restore the standard cap so the standard lock amount applies.
    let secret = s.approvers[0].2.clone();
    let rules = s.rules.clone();
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "update_rules", args![rules])
            .build_and_seal(&secret),
        vec![],
    );
    lock(&mut s);
    let secret = s.approvers[0].2.clone();
    let mut changed = s.rules.clone();
    changed.budget_cap = Amount::new(1);
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "update_rules", args![changed])
            .build_and_seal(&secret),
        "not a draft"
    );
    // A stranger cannot touch the rules even in a fresh draft.
    let mut s2 = setup();
    let stranger = make_seller(&mut s2.test, 90);
    let rules2 = s2.rules.clone();
    expect_fail!(
        s2,
        s2.test
            .transaction()
            .call_method(s2.tender, "update_rules", args![rules2])
            .build_and_seal(&stranger.secret),
        "approver"
    );
}

/// I3: a reveal counts only when it is signed by the payment identity
/// the commitment binds, with the exact price and salt committed.
#[test]
fn i3_reveal_requires_the_committed_identity_price_and_salt() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 81);
    let b = make_seller(&mut s.test, 82);
    commit(&mut s, &a, 8_000);
    set_epoch(&mut s.test, 5);
    // Signed by B, naming A's identity.
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.tender,
                "reveal_bid",
                args![Amount::new(8_000), a.salt.to_vec(), a.key],
            )
            .build_and_seal(&b.secret),
        "signed by the payment identity"
    );
    // Right signer, wrong salt.
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.tender,
                "reveal_bid",
                args![Amount::new(8_000), vec![9u8; 32], a.key],
            )
            .build_and_seal(&a.secret),
        "no matching commitment"
    );
    // Right signer and salt, wrong price.
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.tender,
                "reveal_bid",
                args![Amount::new(7_999), a.salt.to_vec(), a.key],
            )
            .build_and_seal(&a.secret),
        "no matching commitment"
    );
    // The honest reveal still works afterwards.
    reveal(&mut s, &a, 8_000);
    assert_eq!(info(&mut s).reveals_count, 1);
    // A second reveal of the same commitment is rejected.
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.tender,
                "reveal_bid",
                args![Amount::new(8_000), a.salt.to_vec(), a.key],
            )
            .build_and_seal(&a.secret),
        "no matching commitment"
    );
}

/// I5: across varied bid sets, the award is always the lowest valid
/// revealed price, earliest reveal winning ties, and a silent low
/// bidder never wins.
#[test]
fn i5_award_is_always_the_lowest_valid_revealed_price() {
    let cases: Vec<(Vec<u128>, Vec<usize>)> = vec![
        (vec![5_000, 4_000, 6_000], vec![0, 1, 2]),
        (vec![5_000, 4_000, 6_000], vec![2, 0]),
        (vec![3_000, 3_000, 3_000], vec![1, 2, 0]),
        (vec![9_999, 1_000], vec![0]),
    ];
    for (case_idx, (prices, reveal_order)) in cases.iter().enumerate() {
        let mut s = setup();
        lock(&mut s);
        let mut sellers = Vec::new();
        for (i, price) in prices.iter().enumerate() {
            let seller = make_seller(&mut s.test, 100 + (case_idx * 10 + i) as u8);
            commit(&mut s, &seller, *price);
            sellers.push(seller);
        }
        set_epoch(&mut s.test, 5);
        for idx in reveal_order {
            reveal(&mut s, &sellers[*idx], prices[*idx]);
        }
        set_epoch(&mut s.test, 10);
        close_reveal(&mut s);
        let award = info(&mut s).award.expect("award");
        let expected_price = reveal_order.iter().map(|i| prices[*i]).min().unwrap();
        let expected_winner = reveal_order
            .iter()
            .find(|i| prices[**i] == expected_price)
            .unwrap();
        assert_eq!(award.winning_price, Amount::new(expected_price), "case {case_idx}");
        assert_eq!(award.winner, sellers[*expected_winner].key, "case {case_idx}");
    }
}

/// I7: an override needs approvers, the window, and a revealed seller.
#[test]
fn i7_override_guards() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 83);
    let b = make_seller(&mut s.test, 84);
    commit(&mut s, &a, 8_000);
    commit(&mut s, &b, 9_000);
    set_epoch(&mut s.test, 5);
    reveal(&mut s, &a, 8_000);
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);

    // A non-approver cannot propose.
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.tender,
                "propose_override",
                args![Some(a.key), Hash32::from_array([1u8; 32])],
            )
            .build_and_seal(&a.secret),
        "approver"
    );
    // The chosen seller must have revealed: B never did.
    let secret = s.approvers[0].2.clone();
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.tender,
                "propose_override",
                args![Some(b.key), Hash32::from_array([1u8; 32])],
            )
            .build_and_seal(&secret),
        "valid revealed bid"
    );
    // After the override window the same proposal is rejected.
    set_epoch(&mut s.test, 13);
    let secret = s.approvers[0].2.clone();
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.tender,
                "propose_override",
                args![Some(a.key), Hash32::from_array([1u8; 32])],
            )
            .build_and_seal(&secret),
        "override window"
    );
}

/// I8: delivery settles only on distinct approvers at the threshold.
#[test]
fn i8_confirmation_counts_distinct_approvers() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 85);
    commit(&mut s, &a, 8_000);
    set_epoch(&mut s.test, 5);
    reveal(&mut s, &a, 8_000);
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);
    set_epoch(&mut s.test, 13);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "advance_delivery", args![])
            .build_and_seal(s.test.secret_key()),
        vec![],
    );
    // A seller cannot confirm.
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "confirm_delivery", args![])
            .build_and_seal(&a.secret),
        "approver"
    );
    // The same approver twice still counts once: the duplicate is
    // rejected outright and the tender stays unsettled.
    confirm_delivery(&mut s, 0);
    let secret = s.approvers[0].2.clone();
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "confirm_delivery", args![])
            .build_and_seal(&secret),
        "already confirmed"
    );
    assert_eq!(info(&mut s).state, asiri_types::TenderState::AwaitingDelivery);
    confirm_delivery(&mut s, 1);
    assert_eq!(info(&mut s).state, asiri_types::TenderState::Settled);
}

/// I10 and I11: one commitment per seller, the exact bond, and the
/// windows enforced at both ends.
#[test]
fn i10_i11_commitments_and_windows() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 86);
    commit(&mut s, &a, 8_000);
    // A second commitment from the same seller.
    let commitment = commitment_for(7_000, &a.salt, &a.key);
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(a.account, "withdraw", args![TARI_TOKEN, Amount::new(BOND)])
            .put_last_instruction_output_on_workspace("bond")
            .call_method(s.tender, "commit_bid", args![commitment, Workspace("bond")])
            .build_and_seal(&a.secret),
        "already committed"
    );
    // A short bond from a new seller.
    let b = make_seller(&mut s.test, 87);
    let commitment_b = commitment_for(7_000, &b.salt, &b.key);
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(b.account, "withdraw", args![TARI_TOKEN, Amount::new(BOND - 1)])
            .put_last_instruction_output_on_workspace("bond")
            .call_method(s.tender, "commit_bid", args![commitment_b, Workspace("bond")])
            .build_and_seal(&b.secret),
        "bond must equal"
    );
    // Reveals are closed while the bid window is open.
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.tender,
                "reveal_bid",
                args![Amount::new(8_000), a.salt.to_vec(), a.key],
            )
            .build_and_seal(&a.secret),
        "reveal window"
    );
    // Closing early is rejected.
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "close_reveal", args![])
            .build_and_seal(s.test.secret_key()),
        "reveal window"
    );
    // Commitments close at the bid deadline.
    set_epoch(&mut s.test, 5);
    let c = make_seller(&mut s.test, 88);
    let commitment_c = commitment_for(7_000, &c.salt, &c.key);
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(c.account, "withdraw", args![TARI_TOKEN, Amount::new(BOND)])
            .put_last_instruction_output_on_workspace("bond")
            .call_method(s.tender, "commit_bid", args![commitment_c, Workspace("bond")])
            .build_and_seal(&c.secret),
        "bid window"
    );
}

/// Binding cannot be forged: bind answers only the circle component,
/// and an unbound tender cannot be funded.
#[test]
fn binding_cannot_be_forged_and_unbound_tenders_cannot_lock() {
    let mut s = setup();
    // A direct user call to bind is refused by the access rule.
    let secret = s.approvers[0].2.clone();
    let approver_key = s.approvers[0].3;
    let tx = s
        .test
        .transaction()
        .call_method(
            s.tender,
            "bind",
            args![vec![approver_key], "Forged Circle".to_string()],
        )
        .build_and_seal(&secret);
    let reason = s.test.execute_expect_failure(tx, vec![]);
    assert!(
        format!("{reason}").contains("Denied") || format!("{reason}").contains("denied"),
        "unexpected rejection: {reason}"
    );

    // A second tender that nobody registers stays inert.
    let rules = s.rules.clone();
    let tender2: ComponentAddress = s.test.call_function("Tender", "new", args![s.circle, rules], vec![]);
    let (account, proof, secret) = {
        let a = &s.approvers[0];
        (a.0, a.1.clone(), a.2.clone())
    };
    let tx = s
        .test
        .transaction()
        .call_method(account, "withdraw", args![TARI_TOKEN, Amount::new(CAP)])
        .put_last_instruction_output_on_workspace("escrow")
        .call_method(tender2, "lock_and_fund", args![Workspace("escrow")])
        .build_and_seal(&secret);
    let reason = s.test.execute_expect_failure(tx, vec![proof]);
    assert!(
        format!("{reason}").contains("not bound"),
        "unexpected rejection: {reason}"
    );
}

/// Locking demands the exact cap from an approver.
#[test]
fn lock_demands_the_exact_cap() {
    let mut s = setup();
    let (account, proof, secret) = {
        let a = &s.approvers[0];
        (a.0, a.1.clone(), a.2.clone())
    };
    let tx = s
        .test
        .transaction()
        .call_method(account, "withdraw", args![TARI_TOKEN, Amount::new(CAP - 1)])
        .put_last_instruction_output_on_workspace("escrow")
        .call_method(s.tender, "lock_and_fund", args![Workspace("escrow")])
        .build_and_seal(&secret);
    let reason = s.test.execute_expect_failure(tx, vec![proof]);
    assert!(
        format!("{reason}").contains("must equal the budget cap"),
        "unexpected rejection: {reason}"
    );
    // The tender is still a draft afterwards, and the honest lock works.
    assert_eq!(info(&mut s).state, asiri_types::TenderState::Draft);
    lock(&mut s);
    assert_eq!(info(&mut s).state, asiri_types::TenderState::Open);
}

/// I2 and I6: settled money moves once, through its own claim only.
#[test]
fn i2_i6_claims_pay_once_through_their_own_paths() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 89);
    commit(&mut s, &a, 8_000);
    set_epoch(&mut s.test, 5);
    reveal(&mut s, &a, 8_000);
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);
    // Too early for every claim.
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "claim_payment", args![])
            .build_and_seal(&a.secret),
        "not settled"
    );
    let secret = s.approvers[0].2.clone();
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.circle, "collect_tender_refund", args![s.tender])
            .build_and_seal(&secret),
        "not closed"
    );
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
    // The winner claims; a second claim is rejected.
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "claim_payment", args![])
            .put_last_instruction_output_on_workspace("pay")
            .call_method(a.account, "deposit", args![Workspace("pay")])
            .build_and_seal(&a.secret),
        vec![a.proof.clone()],
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "claim_payment", args![])
            .build_and_seal(&a.secret),
        "already claimed"
    );
    // The receipt path carries the same winner guard.
    let b = make_seller(&mut s.test, 91);
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "claim_receipt", args![])
            .build_and_seal(&b.secret),
        "winning payment identity"
    );
}

/// I12: neither component has an owner key, so no upgrade or takeover
/// path exists for either.
#[test]
fn i12_components_have_no_owner() {
    let s = setup();
    for addr in [s.circle, s.tender] {
        let component = s
            .test
            .read_only_state_store()
            .get_component(addr)
            .expect("component exists");
        assert!(
            component.owner_public_key().is_none(),
            "component {addr} must have no owner"
        );
    }
}

/// A commitment whose preimage names another seller's payment identity
/// cannot be revealed by anyone: the bond poster and the payment
/// identity must be the same party.
#[test]
fn delegated_preimage_reveal_is_rejected() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 92);
    let b = make_seller(&mut s.test, 93);
    // A commits a hash over a preimage that names B as the payment
    // identity, fronting the bond for a bid B never made.
    let commitment = commitment_for(8_000, &a.salt, &b.key);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(a.account, "withdraw", args![TARI_TOKEN, Amount::new(BOND)])
            .put_last_instruction_output_on_workspace("bond")
            .call_method(s.tender, "commit_bid", args![commitment, Workspace("bond")])
            .build_and_seal(&a.secret),
        vec![a.proof.clone()],
    );
    set_epoch(&mut s.test, 5);
    // B cannot reveal it: the commitment is A's.
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.tender,
                "reveal_bid",
                args![Amount::new(8_000), a.salt.to_vec(), b.key],
            )
            .build_and_seal(&b.secret),
        "no matching commitment"
    );
    assert_eq!(info(&mut s).reveals_count, 0);
}
