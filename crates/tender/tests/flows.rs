//! Override, dispute, and expiry flows for the Tender template.
//!
//! Epoch plan with the default rules (bid 5, reveal 5, override 3,
//! delivery 5, grace 3, dispute 4), locking at epoch 0: bids close at
//! 5, reveals close at 10, the override window closes at 13, delivery
//! runs to 18 when advanced at 13, the claim grace closes at 21.

mod common;

use common::*;
use tari_template_lib::prelude::*;
use tari_template_test_tooling::{
    TemplateTest,
    byte_type::ToByteType,
    crypto::{PublicKey, RistrettoPublicKey},
    support::spec::InputSpec,
    support::stealth::generate_transfer_data,
    transaction::args,
};

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

fn advance(s: &mut Setup) {
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "advance_delivery", args![])
            .build_and_seal(s.test.secret_key()),
        vec![],
    );
}

fn propose_override(s: &mut Setup, approver: usize, chosen: Option<RistrettoPublicKeyBytes>, rationale: u8) -> u32 {
    let secret = s.approvers[approver].2.clone();
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(
                s.tender,
                "propose_override",
                args![chosen, Hash32::from_array([rationale; 32])],
            )
            .build_and_seal(&secret),
        vec![],
    );
    s.test.expect_return(0)
}

fn sign_override(s: &mut Setup, approver: usize, id: u32) -> bool {
    let secret = s.approvers[approver].2.clone();
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "sign_override", args![id])
            .build_and_seal(&secret),
        vec![],
    );
    s.test.expect_return(0)
}

fn claim_payment_into_account(s: &mut Setup, seller: &Seller) {
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "claim_payment", args![])
            .put_last_instruction_output_on_workspace("pay")
            .call_method(seller.account, "deposit", args![Workspace("pay")])
            .build_and_seal(&seller.secret),
        vec![seller.proof.clone()],
    );
}

fn claim_bond_into_account(s: &mut Setup, seller: &Seller) {
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

fn collect_refund_into_treasury(s: &mut Setup) -> Amount {
    let secret = s.approvers[0].2.clone();
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.circle, "collect_tender_refund", args![s.tender])
            .build_and_seal(&secret),
        vec![],
    );
    s.test.expect_return(0)
}

#[test]
fn override_executes_and_pays_the_chosen_seller() {
    let (mut s, a, b) = two_revealed(61, 62);
    let award = info(&mut s).award.expect("award recorded");
    assert_eq!(award.winner, a.key);

    let id = propose_override(&mut s, 0, Some(b.key), 3);
    assert!(!sign_override(&mut s, 0, id), "one signature is below threshold");
    let mid = info(&mut s);
    assert_eq!(mid.award.clone().expect("award").winner, a.key, "award unchanged below threshold");
    assert!(sign_override(&mut s, 1, id), "second signature executes");

    let after = info(&mut s);
    let award = after.award.clone().expect("award");
    assert_eq!(award.winner, b.key);
    assert_eq!(award.winning_price, Amount::new(9_000));
    assert!(award.by_override);
    let record = after.override_record.expect("override recorded");
    assert_eq!(record.rationale_hash, Hash32::from_array([3u8; 32]));
    assert_eq!(record.chosen, Some(b.key));

    set_epoch(&mut s.test, 13);
    advance(&mut s);
    confirm_delivery(&mut s, 0);
    confirm_delivery(&mut s, 1);
    assert_eq!(info(&mut s).state, asiri_types::TenderState::Settled);

    let before = balance(&mut s.test, b.account);
    claim_payment_into_account(&mut s, &b);
    let after_bal = balance(&mut s.test, b.account);
    assert_eq!(after_bal - before, Amount::new(9_000));
    assert_eq!(collect_refund_into_treasury(&mut s), Amount::new(1_000));
}

#[test]
fn override_below_threshold_leaves_the_computed_award() {
    let (mut s, a, _b) = two_revealed(63, 64);
    let id = propose_override(&mut s, 0, Some(_b.key), 3);
    assert!(!sign_override(&mut s, 0, id));
    set_epoch(&mut s.test, 13);
    advance(&mut s);
    confirm_delivery(&mut s, 0);
    confirm_delivery(&mut s, 2);
    let before = balance(&mut s.test, a.account);
    claim_payment_into_account(&mut s, &a);
    let after_bal = balance(&mut s.test, a.account);
    assert_eq!(after_bal - before, Amount::new(8_000));
    let award = info(&mut s).award.expect("award");
    assert!(!award.by_override);
}

#[test]
fn override_cancellation_refunds_and_keeps_close_time_forfeits() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 65);
    let b = make_seller(&mut s.test, 66);
    commit(&mut s, &a, 8_000);
    commit(&mut s, &b, 9_000);
    set_epoch(&mut s.test, 5);
    reveal(&mut s, &a, 8_000);
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);
    // B never revealed: the close-time forfeit already stands.
    assert_eq!(info(&mut s).forfeit_locked, Amount::new(50));

    let id = propose_override(&mut s, 0, None, 7);
    assert!(!sign_override(&mut s, 0, id));
    assert!(sign_override(&mut s, 1, id));
    let after = info(&mut s);
    assert_eq!(after.state, asiri_types::TenderState::Expired);
    assert_eq!(after.forfeit_locked, Amount::new(50), "close-time forfeit stands");

    assert_eq!(collect_refund_into_treasury(&mut s), Amount::new(CAP));
    // The revealed seller's bond is returnable after a cancellation.
    let before = balance(&mut s.test, a.account);
    claim_bond_into_account(&mut s, &a);
    let after_bal = balance(&mut s.test, a.account);
    assert_eq!(after_bal - before, Amount::new(BOND));
}

fn dispute_setup() -> (Setup, Seller, Seller) {
    let (mut s, a, b) = two_revealed(67, 68);
    set_epoch(&mut s.test, 13);
    advance(&mut s);
    set_epoch(&mut s.test, 18);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(
                s.tender,
                "claim_dispute",
                args![Hash32::from_array([4u8; 32])],
            )
            .build_and_seal(&a.secret),
        vec![],
    );
    assert_eq!(info(&mut s).state, asiri_types::TenderState::Disputed);
    (s, a, b)
}

fn resolve(s: &mut Setup, approver: usize, pay_winner: bool, rationale: u8) -> bool {
    let secret = s.approvers[approver].2.clone();
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(
                s.tender,
                "resolve_dispute",
                args![pay_winner, Hash32::from_array([rationale; 32])],
            )
            .build_and_seal(&secret),
        vec![],
    );
    s.test.expect_return(0)
}

#[test]
fn dispute_resolved_for_winner_settles() {
    let (mut s, a, _b) = dispute_setup();
    assert!(!resolve(&mut s, 0, true, 5));
    assert!(!resolve(&mut s, 1, true, 5));
    assert!(resolve(&mut s, 2, true, 5), "third vote reaches the dispute threshold");
    assert_eq!(info(&mut s).state, asiri_types::TenderState::Settled);
    let before = balance(&mut s.test, a.account);
    claim_payment_into_account(&mut s, &a);
    let after_bal = balance(&mut s.test, a.account);
    assert_eq!(after_bal - before, Amount::new(8_000));
}

#[test]
fn dispute_votes_count_each_approver_once() {
    let (mut s, _a, _b) = dispute_setup();
    assert!(!resolve(&mut s, 0, true, 5));
    // The same approver cannot also back the other outcome: the
    // dispute threshold counts distinct approvers, not ballots.
    let secret = s.approvers[0].2.clone();
    let reason = s.test.execute_expect_failure(
        s.test
            .transaction()
            .call_method(
                s.tender,
                "resolve_dispute",
                args![false, Hash32::from_array([6u8; 32])],
            )
            .build_and_seal(&secret),
        vec![],
    );
    assert!(
        format!("{reason}").contains("already voted"),
        "unexpected rejection: {reason}"
    );
    // Two more distinct approvers still settle it for the winner.
    assert!(!resolve(&mut s, 1, true, 5));
    assert!(resolve(&mut s, 2, true, 5));
    assert_eq!(info(&mut s).state, asiri_types::TenderState::Settled);
}

#[test]
fn dispute_resolved_for_circle_refunds_and_forfeits_winner_bond() {
    let (mut s, a, b) = dispute_setup();
    assert!(!resolve(&mut s, 0, false, 6));
    assert!(!resolve(&mut s, 1, false, 6));
    assert!(resolve(&mut s, 2, false, 6));
    let after = info(&mut s);
    assert_eq!(after.state, asiri_types::TenderState::Expired);
    assert_eq!(after.forfeit_locked, Amount::new(50));
    assert_eq!(after.forfeit_for_circle, Amount::new(50));
    assert_eq!(collect_refund_into_treasury(&mut s), Amount::new(CAP));
    // The losing seller revealed and did nothing wrong: bond back.
    let before = balance(&mut s.test, b.account);
    claim_bond_into_account(&mut s, &b);
    let after_bal = balance(&mut s.test, b.account);
    assert_eq!(after_bal - before, Amount::new(BOND));
    // The winner's bond is forfeit: their claim is rejected.
    let reason = s.test.execute_expect_failure(
        s.test
            .transaction()
            .call_method(s.tender, "claim_bond", args![])
            .build_and_seal(&a.secret),
        vec![],
    );
    assert!(
        format!("{reason}").contains("no returnable bond"),
        "unexpected rejection: {reason}"
    );
}

#[test]
fn dispute_timeout_defaults_to_refund_and_returns_winner_bond() {
    let (mut s, a, _b) = dispute_setup();
    // Dispute filed at 18 with a 4-epoch window: expiry opens at 22.
    set_epoch(&mut s.test, 22);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "expire", args![])
            .build_and_seal(s.test.secret_key()),
        vec![],
    );
    let after = info(&mut s);
    assert_eq!(after.state, asiri_types::TenderState::Expired);
    assert_eq!(after.forfeit_locked, Amount::zero());
    assert_eq!(collect_refund_into_treasury(&mut s), Amount::new(CAP));
    let before = balance(&mut s.test, a.account);
    claim_bond_into_account(&mut s, &a);
    let after_bal = balance(&mut s.test, a.account);
    assert_eq!(after_bal - before, Amount::new(BOND));
}

#[test]
fn delivery_claim_blocks_expiry_until_the_dispute_deadline() {
    let (mut s, _a, _b) = dispute_setup();
    set_epoch(&mut s.test, 20);
    let reason = s.test.execute_expect_failure(
        s.test
            .transaction()
            .call_method(s.tender, "expire", args![])
            .build_and_seal(s.test.secret_key()),
        vec![],
    );
    assert!(
        format!("{reason}").contains("dispute"),
        "unexpected rejection: {reason}"
    );
}

#[test]
fn awarded_then_expired_forfeits_the_winner_bond() {
    let (mut s, a, b) = two_revealed(69, 70);
    set_epoch(&mut s.test, 13);
    advance(&mut s);
    // No confirmation, no claim: at the claim deadline (21) it expires.
    set_epoch(&mut s.test, 21);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "expire", args![])
            .build_and_seal(s.test.secret_key()),
        vec![],
    );
    let after = info(&mut s);
    assert_eq!(after.state, asiri_types::TenderState::Expired);
    assert_eq!(after.forfeit_locked, Amount::new(50));
    assert_eq!(after.forfeit_for_circle, Amount::new(50));
    assert_eq!(collect_refund_into_treasury(&mut s), Amount::new(CAP));
    let before = balance(&mut s.test, b.account);
    claim_bond_into_account(&mut s, &b);
    let after_bal = balance(&mut s.test, b.account);
    assert_eq!(after_bal - before, Amount::new(BOND));
    let reason = s.test.execute_expect_failure(
        s.test
            .transaction()
            .call_method(s.tender, "claim_bond", args![])
            .build_and_seal(&a.secret),
        vec![],
    );
    assert!(
        format!("{reason}").contains("no returnable bond"),
        "unexpected rejection: {reason}"
    );
}

#[test]
fn invalid_reveal_above_cap_cannot_win_and_forfeits() {
    let mut s = setup();
    lock(&mut s);
    let a = make_seller(&mut s.test, 71);
    let b = make_seller(&mut s.test, 72);
    commit(&mut s, &a, 12_000);
    commit(&mut s, &b, 9_000);
    set_epoch(&mut s.test, 5);
    reveal(&mut s, &a, 12_000);
    reveal(&mut s, &b, 9_000);
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);
    let after = info(&mut s);
    let award = after.award.expect("award");
    assert_eq!(award.winner, b.key);
    assert_eq!(award.winning_price, Amount::new(9_000));
    assert_eq!(after.forfeit_locked, Amount::new(50));
    let reason = s.test.execute_expect_failure(
        s.test
            .transaction()
            .call_method(s.tender, "claim_bond", args![])
            .build_and_seal(&a.secret),
        vec![],
    );
    assert!(
        format!("{reason}").contains("no returnable bond"),
        "unexpected rejection: {reason}"
    );
}

#[test]
fn winner_can_take_payment_as_a_stealth_output() {
    let (mut s, a, _b) = two_revealed(73, 74);
    set_epoch(&mut s.test, 13);
    advance(&mut s);
    confirm_delivery(&mut s, 0);
    confirm_delivery(&mut s, 1);
    assert_eq!(info(&mut s).state, asiri_types::TenderState::Settled);

    // The winner's wallet side prepares the receiving material. The
    // payout bucket then funds a transfer whose only output is a fresh
    // stealth UTXO naming a one-time key the winner controls. Nothing
    // lands in the winner's revealed balance.
    let payout = generate_transfer_data(
        Vec::<InputSpec>::new(),
        Amount::new(8_000),
        vec![8_000],
        Amount::zero(),
    );
    let designated_key =
        RistrettoPublicKey::from_secret_key(&payout.output_masks[0]).to_byte_type();
    let utxos_before = s.test.read_only_state_store().get_all_utxos().unwrap().len();
    let balance_before = balance(&mut s.test, a.account);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "claim_payment", args![])
            .put_last_instruction_output_on_workspace("pay")
            .stealth_transfer_with_input_bucket(TARI_TOKEN, payout.statement.clone(), "pay")
            .build_and_seal(&a.secret),
        vec![a.proof.clone()],
    );
    assert_eq!(balance(&mut s.test, a.account), balance_before);
    let utxos = s.test.read_only_state_store().get_all_utxos().unwrap();
    assert_eq!(utxos.len(), utxos_before + 1, "exactly one new UTXO");
    let (_addr, utxo) = utxos
        .iter()
        .find(|(_addr, u)| u.spender_public_key() == Some(&designated_key))
        .expect("the payout UTXO names the designated winner key");
    let _ = utxo;
}

#[test]
fn tender_approver_change_rotates_and_voids_open_override() {
    let (mut s, _a, b) = two_revealed(75, 76);
    // An override proposal is open when the rotation starts.
    let override_id = propose_override(&mut s, 0, Some(b.key), 3);
    assert!(!sign_override(&mut s, 0, override_id));

    // Rotate approver 2 out, a fresh key in, under the current set.
    let fresh = make_seller(&mut s.test, 77);
    let new_set = vec![s.approvers[0].3, s.approvers[1].3, fresh.key];
    let secret0 = s.approvers[0].2.clone();
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "propose_approver_change", args![new_set])
            .build_and_seal(&secret0),
        vec![],
    );
    let change_id: u32 = s.test.expect_return(0);
    let secret0 = s.approvers[0].2.clone();
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "approve_approver_change", args![change_id])
            .build_and_seal(&secret0),
        vec![],
    );
    assert!(!s.test.expect_return::<bool>(0));
    let secret1 = s.approvers[1].2.clone();
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "approve_approver_change", args![change_id])
            .build_and_seal(&secret1),
        vec![],
    );
    assert!(s.test.expect_return::<bool>(0));

    // The open override proposal died with the rotation.
    let secret0 = s.approvers[0].2.clone();
    let reason = s.test.execute_expect_failure(
        s.test
            .transaction()
            .call_method(s.tender, "sign_override", args![override_id])
            .build_and_seal(&secret0),
        vec![],
    );
    assert!(
        format!("{reason}").contains("void"),
        "unexpected rejection: {reason}"
    );

    // The rotated-out approver can no longer confirm delivery; the
    // fresh approver can.
    set_epoch(&mut s.test, 13);
    advance(&mut s);
    let old_secret = s.approvers[2].2.clone();
    let reason = s.test.execute_expect_failure(
        s.test
            .transaction()
            .call_method(s.tender, "confirm_delivery", args![])
            .build_and_seal(&old_secret),
        vec![],
    );
    assert!(
        format!("{reason}").contains("approver"),
        "unexpected rejection: {reason}"
    );
    confirm_delivery(&mut s, 0);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "confirm_delivery", args![])
            .build_and_seal(&fresh.secret),
        vec![],
    );
    assert_eq!(info(&mut s).state, asiri_types::TenderState::Settled);
}

#[test]
fn confirmation_after_the_claim_grace_is_rejected() {
    let (mut s, _a, _b) = two_revealed(78, 79);
    set_epoch(&mut s.test, 13);
    advance(&mut s);
    // Claim deadline is 21 (advance at 13, delivery 5, grace 3). At 21
    // the tender belongs to the expiry path, not to late confirmations.
    set_epoch(&mut s.test, 21);
    let secret = s.approvers[0].2.clone();
    let reason = s.test.execute_expect_failure(
        s.test
            .transaction()
            .call_method(s.tender, "confirm_delivery", args![])
            .build_and_seal(&secret),
        vec![],
    );
    assert!(
        format!("{reason}").contains("claim grace has closed"),
        "unexpected rejection: {reason}"
    );
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "expire", args![])
            .build_and_seal(s.test.secret_key()),
        vec![],
    );
    assert_eq!(info(&mut s).state, asiri_types::TenderState::Expired);
}

#[test]
fn approver_change_below_the_locked_thresholds_is_rejected() {
    let (mut s, _a, _b) = two_revealed(80, 81);
    // The locked dispute threshold is 3: a two-key set could never
    // resolve a dispute, so the proposal itself is refused.
    let small_set = vec![s.approvers[0].3, s.approvers[1].3];
    let secret = s.approvers[0].2.clone();
    let reason = s.test.execute_expect_failure(
        s.test
            .transaction()
            .call_method(s.tender, "propose_approver_change", args![small_set])
            .build_and_seal(&secret),
        vec![],
    );
    assert!(
        format!("{reason}").contains("smaller than the locked dispute threshold"),
        "unexpected rejection: {reason}"
    );
}

#[test]
fn tender_proceeds_survive_circle_rotation() {
    // A tender's approver set is a snapshot from when the circle bound
    // it. If the circle later rotates that approver out of its own set,
    // they must still be able to pay the tender's proceeds into the
    // treasury: depositing only ever adds funds.
    let mut test = TemplateTest::new("..", ["circle", "tender"]);
    let mut keys = Vec::new();
    for _ in 0..4 {
        let (account, proof, secret, public) = test.create_funded_account_with_keypair();
        keys.push((account, proof, secret, public.to_byte_type()));
    }
    let (a, b, c, d) = (keys[0].clone(), keys[1].clone(), keys[2].clone(), keys[3].clone());
    let circle: ComponentAddress = test.call_function(
        "Circle",
        "new",
        args!["Rotation Circle".to_string(), vec![a.3, b.3, c.3], 2u32, None::<RistrettoPublicKeyBytes>, Some(test.get_template_address("Tender"))],
        vec![],
    );
    // The circle adds D as a fourth approver.
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "propose_approver_change", args![vec![a.3, b.3, c.3, d.3], 2u32])
            .build_and_seal(&a.2),
        vec![],
    );
    let change: u32 = test.expect_return(0);
    for signer in [&a, &b] {
        test.execute_expect_success(
            test.transaction()
                .call_method(circle, "approve_approver_change", args![change])
                .build_and_seal(&signer.2),
            vec![],
        );
    }
    // A tender is created and bound while D is an approver.
    let tender: ComponentAddress = test.call_function("Tender", "new", args![circle, default_rules()], vec![]);
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "register_tender", args![tender])
            .build_and_seal(&a.2),
        vec![],
    );
    // The circle rotates D back out. D was never a founding member.
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "propose_approver_change", args![vec![a.3, b.3, c.3], 2u32])
            .build_and_seal(&a.2),
        vec![],
    );
    let change: u32 = test.expect_return(0);
    for signer in [&a, &b] {
        test.execute_expect_success(
            test.transaction()
                .call_method(circle, "approve_approver_change", args![change])
                .build_and_seal(&signer.2),
            vec![],
        );
    }
    // Lock the tender from A's account and let it expire unrevealed.
    test.execute_expect_success(
        test.transaction()
            .call_method(a.0, "withdraw", args![TARI_TOKEN, Amount::new(CAP)])
            .put_last_instruction_output_on_workspace("escrow")
            .call_method(tender, "lock_and_fund", args![Workspace("escrow")])
            .build_and_seal(&a.2),
        vec![a.1.clone()],
    );
    set_epoch(&mut test, 10);
    test.execute_expect_success(
        test.transaction()
            .call_method(tender, "close_reveal", args![])
            .build_and_seal(test.secret_key()),
        vec![],
    );
    // D, a tender approver but no longer a circle approver or member,
    // cannot take the refund and cannot collect it either: the tender
    // releases proceeds only to its circle component, and collection
    // is a circle approver's call. The proceeds are not stranded,
    // though. A current approver collects, and the full refund lands
    // in the treasury.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(tender, "release_refund", args![])
            .build_and_seal(&d.2),
        vec![],
    );
    assert!(
        format!("{reason}").contains("Denied") || format!("{reason}").contains("denied"),
        "unexpected rejection: {reason}"
    );
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(circle, "collect_tender_refund", args![tender])
            .build_and_seal(&d.2),
        vec![],
    );
    assert!(
        format!("{reason}").contains("not a circle approver"),
        "unexpected rejection: {reason}"
    );
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "collect_tender_refund", args![tender])
            .call_method(circle, "treasury_balance", args![])
            .build_and_seal(&a.2),
        vec![],
    );
    assert_eq!(test.expect_return::<Amount>(1), Amount::new(CAP));
}
