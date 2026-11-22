//! Attack tests for the Tender template. Each test mounts a concrete
//! attack against a live tender or circle and asserts the engine
//! rejects it, or that the tender's state and money are unchanged.
//!
//! Epoch plan with the default rules (bid 5, reveal 5, override 3,
//! delivery 5, grace 3, dispute 4), locking at epoch 0: bids close at
//! 5, reveals close at 10, the override window closes at 13, delivery
//! runs to 18 when advanced at 13, the claim grace closes at 21.

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

/// Two sellers commit and reveal, A at 8_000 and B at 9_000, and the
/// reveal window closes with A as the computed winner.
fn two_revealed(salt_a: u8, salt_b: u8) -> (Setup, Seller, Seller) {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, salt_a);
    let b = make_seller(&mut s.test, salt_b);
    commit(&mut s, &a, 8_000);
    commit(&mut s, &b, 9_000);
    set_epoch(&mut s.test, 5);
    reveal(&mut s, &a, 8_000);
    reveal(&mut s, &b, 9_000);
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);
    (s, a, b)
}

fn claim_bond(s: &mut Setup, seller: &Seller) {
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "claim_bond", args![])
            .put_last_instruction_output_on_workspace("bond")
            .call_method(seller.account, "deposit", args![Workspace("bond")])
            .build_and_seal(&seller.secret),
        vec![seller.proof.clone()],
    );
}

/// A reveal that arrives after the reveal window has closed is
/// rejected, and the tender expires with the bond returned in full.
#[test]
fn reveal_after_the_window_closes_is_rejected() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 41);
    commit(&mut s, &a, 8_000);
    set_epoch(&mut s.test, 10);
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
        "reveal window has closed"
    );
    close_reveal(&mut s);
    let inf = info(&mut s);
    assert_eq!(inf.state, asiri_types::TenderState::Expired);
    assert!(inf.award.is_none());
    claim_bond(&mut s, &a);
}

/// Replaying a successful reveal, byte for byte, finds no unrevealed
/// commitment left to match and is rejected.
#[test]
fn replayed_reveal_is_rejected() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 42);
    commit(&mut s, &a, 8_000);
    set_epoch(&mut s.test, 5);
    reveal(&mut s, &a, 8_000);
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

/// A bid committed above the cap reveals as invalid. The seller cannot
/// then reveal a lower price instead, under the same salt or a fresh
/// one: the commitment binds the price that was committed. With no
/// valid reveal the tender expires and the bond returns in full.
#[test]
fn above_cap_commit_cannot_be_revealed_at_a_lower_price() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 43);
    commit(&mut s, &a, 12_000);
    set_epoch(&mut s.test, 5);
    reveal(&mut s, &a, 12_000);
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.tender,
                "reveal_bid",
                args![Amount::new(9_000), a.salt.to_vec(), a.key],
            )
            .build_and_seal(&a.secret),
        "no matching commitment"
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.tender,
                "reveal_bid",
                args![Amount::new(9_000), vec![99u8; 32], a.key],
            )
            .build_and_seal(&a.secret),
        "no matching commitment"
    );
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);
    let inf = info(&mut s);
    assert_eq!(inf.state, asiri_types::TenderState::Expired);
    assert!(inf.award.is_none());
    claim_bond(&mut s, &a);
}

/// After settlement, a losing seller who tries to claim the payment is
/// rejected. The winner then claims it without trouble.
#[test]
fn non_winner_cannot_claim_the_payment() {
    let (mut s, a, b) = two_revealed(44, 45);
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
    assert_eq!(info(&mut s).state, asiri_types::TenderState::Settled);
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "claim_payment", args![])
            .build_and_seal(&b.secret),
        "only the winning payment identity"
    );
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "claim_payment", args![])
            .put_last_instruction_output_on_workspace("pay")
            .call_method(a.account, "deposit", args![Workspace("pay")])
            .build_and_seal(&a.secret),
        vec![a.proof.clone()],
    );
}

/// An override proposal carrying an all-zero rationale hash carries no
/// rationale at all, and is rejected at proposal time.
#[test]
fn override_without_a_rationale_is_rejected() {
    let (mut s, _a, b) = two_revealed(46, 47);
    let secret = s.approvers[0].2.clone();
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.tender,
                "propose_override",
                args![Some(b.key), Hash32::from_array([0u8; 32])],
            )
            .build_and_seal(&secret),
        "rationale"
    );
}

/// A funded outsider who is neither approver, member, nor seller tries
/// every privileged method on the tender and the circle. Every attempt
/// is rejected, and nothing about the tender or the treasury changes.
#[test]
fn keeper_cannot_use_any_privileged_method() {
    let mut s = setup();
    lock(&mut s);
    let keeper = make_seller(&mut s.test, 48);
    let k = &keeper.secret;

    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "update_rules", args![s.rules.clone()])
            .build_and_seal(k),
        "signer is not a circle approver"
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.tender,
                "propose_override",
                args![None::<RistrettoPublicKeyBytes>, Hash32::from_array([3u8; 32])],
            )
            .build_and_seal(k),
        "signer is not a circle approver"
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "release_forfeits", args![])
            .build_and_seal(k),
        ""
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.circle, "collect_tender_forfeits", args![s.tender])
            .build_and_seal(k),
        "signer is not a circle approver"
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "claim_payment", args![])
            .build_and_seal(k),
        "not settled"
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "release_refund", args![])
            .build_and_seal(k),
        ""
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.circle, "collect_tender_refund", args![s.tender])
            .build_and_seal(k),
        "signer is not a circle approver"
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "confirm_delivery", args![])
            .build_and_seal(k),
        ""
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "claim_dispute", args![])
            .build_and_seal(k),
        ""
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "claim_bond", args![])
            .build_and_seal(k),
        ""
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "claim_receipt", args![])
            .build_and_seal(k),
        ""
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.circle, "register_tender", args![s.tender])
            .build_and_seal(k),
        "signer is not a circle approver"
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.circle,
                "propose_withdrawal",
                args![Amount::new(100), keeper.account],
            )
            .build_and_seal(k),
        "signer is not a circle approver"
    );
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(
                s.circle,
                "propose_approver_change",
                args![vec![keeper.key], 1u32],
            )
            .build_and_seal(k),
        "signer is not a circle approver"
    );

    let inf = info(&mut s);
    assert_eq!(inf.state, asiri_types::TenderState::Open);
    assert!(inf.award.is_none());
}

/// An approver acting alone cannot take a tender's refund. The
/// tender releases it only to its circle component, so the approver's
/// direct call is refused, and when the approver collects it through
/// the circle the money lands in the treasury, not in their account.
#[test]
fn approver_cannot_take_the_refund_alone() {
    let mut s = setup();
    lock(&mut s);
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);
    assert_eq!(info(&mut s).state, asiri_types::TenderState::Expired);

    let (account, secret) = {
        let (account, _, secret, _) = &s.approvers[1];
        (*account, secret.clone())
    };
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "release_refund", args![])
            .build_and_seal(&secret),
        ""
    );
    let before = balance(&mut s.test, account);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.circle, "collect_tender_refund", args![s.tender])
            .call_method(s.circle, "treasury_balance", args![])
            .build_and_seal(&secret),
        vec![],
    );
    assert_eq!(s.test.expect_return::<Amount>(1), Amount::new(CAP));
    assert_eq!(
        balance(&mut s.test, account),
        before,
        "the collecting approver gained nothing"
    );
}

/// A copied commitment cannot block its owner. The copy is refused
/// outright, and the owner commits, reveals, and wins as if the
/// attempt never happened.
#[test]
fn copied_commitment_cannot_block_its_owner() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 51);
    let copycat = make_seller(&mut s.test, 52);
    let hash = commitment_for(8_000, &a.salt, &a.key);
    commit(&mut s, &a, 8_000);
    // The copycat posts the identical hash under their own key.
    let reason = s.test.execute_expect_failure(
        s.test
            .transaction()
            .call_method(copycat.account, "withdraw", args![TARI_TOKEN, Amount::new(BOND)])
            .put_last_instruction_output_on_workspace("bond")
            .call_method(s.tender, "commit_bid", args![hash, Workspace("bond")])
            .build_and_seal(&copycat.secret),
        vec![copycat.proof.clone()],
    );
    assert!(
        format!("{reason}").contains("already posted"),
        "unexpected rejection: {reason}"
    );
    set_epoch(&mut s.test, 5);
    reveal(&mut s, &a, 8_000);
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);
    let inf = info(&mut s);
    let award = inf.award.expect("award recorded");
    assert_eq!(award.winner, a.key);
    assert_eq!(award.winning_price, Amount::new(8_000));
}

/// The circle's tender list accepts only components of the tender
/// template it was pinned to at creation. A component of any other
/// template, offered by a genuine approver, is refused.
#[test]
fn circle_registers_only_real_tenders() {
    let mut s = setup();
    let secret = s.approvers[0].2.clone();
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.circle, "register_tender", args![s.circle])
            .build_and_seal(&secret),
        "not the tender template"
    );
}

/// The same fixed destination protects the circle's forfeit share: a
/// direct release attempt is refused, and collection through the
/// circle pays the treasury exactly the forfeited half.
#[test]
fn approver_cannot_take_the_forfeits_alone() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 49);
    let silent = make_seller(&mut s.test, 50);
    commit(&mut s, &a, 8_000);
    commit(&mut s, &silent, 9_000);
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
    confirm_delivery(&mut s, 0);
    confirm_delivery(&mut s, 1);
    assert_eq!(info(&mut s).state, asiri_types::TenderState::Settled);

    let (account, secret) = {
        let (account, _, secret, _) = &s.approvers[2];
        (*account, secret.clone())
    };
    expect_fail!(
        s,
        s.test
            .transaction()
            .call_method(s.tender, "release_forfeits", args![])
            .build_and_seal(&secret),
        ""
    );
    let before = balance(&mut s.test, account);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.circle, "collect_tender_forfeits", args![s.tender])
            .call_method(s.circle, "treasury_balance", args![])
            .build_and_seal(&secret),
        vec![],
    );
    assert_eq!(s.test.expect_return::<Amount>(1), Amount::new(50));
    assert_eq!(
        balance(&mut s.test, account),
        before,
        "the collecting approver gained nothing"
    );
}
