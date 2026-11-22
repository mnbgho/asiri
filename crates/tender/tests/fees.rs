//! A full tender lifecycle with transaction fees enabled in the
//! harness. Every lifecycle transaction carries its own fee payment
//! from its signer's account, and the tender must still complete with
//! the same award, the same refund, and the same bond outcomes as the
//! fee-free runs. The fees the engine actually charges are printed by
//! the harness and measured from the test log.

mod common;

use common::*;
use tari_template_lib::prelude::*;
use tari_template_test_tooling::transaction::args;

/// Generous per-transaction fee allocation. The measured charge is
/// what the engine meters, and unused allocation is refunded.
const MAX_FEE: u128 = 1_000_000;

#[test]
fn full_lifecycle_with_fees_enabled() {
    let mut s = setup();
    let a = make_seller(&mut s.test, 71);
    let b = make_seller(&mut s.test, 72);
    s.test.enable_fees();

    // Lock and fund, fees paid by the funding approver.
    let (funder_account, funder_proof, funder_secret) = {
        let (account, proof, secret, _) = &s.approvers[0];
        (*account, proof.clone(), secret.clone())
    };
    s.test.execute_expect_success(
        s.test
            .transaction()
            .pay_fee_from_component(funder_account, Amount::new(MAX_FEE))
            .call_method(funder_account, "withdraw", args![TARI_TOKEN, Amount::new(CAP)])
            .put_last_instruction_output_on_workspace("escrow")
            .call_method(s.tender, "lock_and_fund", args![Workspace("escrow")])
            .build_and_seal(&funder_secret),
        vec![funder_proof],
    );

    // Both sellers commit and reveal, each paying their own fees.
    for (seller, price) in [(&a, 8_000u128), (&b, 9_000u128)] {
        let commitment = commitment_for(price, &seller.salt, &seller.key);
        s.test.execute_expect_success(
            s.test
                .transaction()
                .pay_fee_from_component(seller.account, Amount::new(MAX_FEE))
                .call_method(seller.account, "withdraw", args![TARI_TOKEN, Amount::new(BOND)])
                .put_last_instruction_output_on_workspace("bond")
                .call_method(s.tender, "commit_bid", args![commitment, Workspace("bond")])
                .build_and_seal(&seller.secret),
            vec![seller.proof.clone()],
        );
    }
    set_epoch(&mut s.test, 5);
    for (seller, price) in [(&a, 8_000u128), (&b, 9_000u128)] {
        s.test.execute_expect_success(
            s.test
                .transaction()
                .pay_fee_from_component(seller.account, Amount::new(MAX_FEE))
                .call_method(
                    s.tender,
                    "reveal_bid",
                    args![Amount::new(price), seller.salt.to_vec(), seller.key],
                )
                .build_and_seal(&seller.secret),
            vec![],
        );
    }

    // Close, advance, and confirm, fees paid by the first approver.
    set_epoch(&mut s.test, 10);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .pay_fee_from_component(funder_account, Amount::new(MAX_FEE))
            .call_method(s.tender, "close_reveal", args![])
            .build_and_seal(&funder_secret),
        vec![],
    );
    set_epoch(&mut s.test, 13);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .pay_fee_from_component(funder_account, Amount::new(MAX_FEE))
            .call_method(s.tender, "advance_delivery", args![])
            .build_and_seal(&funder_secret),
        vec![],
    );
    for idx in 0..2 {
        let (account, secret) = {
            let (account, _, secret, _) = &s.approvers[idx];
            (*account, secret.clone())
        };
        s.test.execute_expect_success(
            s.test
                .transaction()
                .pay_fee_from_component(account, Amount::new(MAX_FEE))
                .call_method(s.tender, "confirm_delivery", args![])
                .build_and_seal(&secret),
            vec![],
        );
    }

    // The winner claims the payment and both bonds come back, each
    // claim paying its own fee.
    s.test.execute_expect_success(
        s.test
            .transaction()
            .pay_fee_from_component(a.account, Amount::new(MAX_FEE))
            .call_method(s.tender, "claim_payment", args![])
            .put_last_instruction_output_on_workspace("pay")
            .call_method(a.account, "deposit", args![Workspace("pay")])
            .build_and_seal(&a.secret),
        vec![a.proof.clone()],
    );
    for seller in [&a, &b] {
        s.test.execute_expect_success(
            s.test
                .transaction()
                .pay_fee_from_component(seller.account, Amount::new(MAX_FEE))
                .call_method(s.tender, "claim_bond", args![])
                .put_last_instruction_output_on_workspace("bond")
                .call_method(seller.account, "deposit", args![Workspace("bond")])
                .build_and_seal(&seller.secret),
            vec![seller.proof.clone()],
        );
    }

    // The refund is collected into the treasury.
    s.test.execute_expect_success(
        s.test
            .transaction()
            .pay_fee_from_component(funder_account, Amount::new(MAX_FEE))
            .call_method(s.circle, "collect_tender_refund", args![s.tender])
            .build_and_seal(&funder_secret),
        vec![],
    );

    // Reads run fee-free. The outcomes match the fee-free runs exactly.
    s.test.disable_fees();
    let inf = info(&mut s);
    assert_eq!(inf.state, asiri_types::TenderState::Settled);
    let award = inf.award.expect("an award is recorded");
    assert_eq!(award.winner, a.key);
    assert_eq!(award.winning_price, Amount::new(8_000));
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.circle, "treasury_balance", args![])
            .build_and_seal(s.test.secret_key()),
        vec![],
    );
    assert_eq!(
        s.test.expect_return::<Amount>(0),
        Amount::new(CAP - 8_000),
        "the refund reached the treasury in full"
    );
}
