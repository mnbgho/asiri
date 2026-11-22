//! Scale test: a tender with twenty-four bidders committing, fifteen
//! revealing, and nine staying silent. The award, every bond outcome,
//! the payment, the refund, and the forfeit split are all asserted,
//! at the scale the design targets for a real buying circle.

mod common;

use common::*;
use tari_template_lib::prelude::*;
use tari_template_test_tooling::transaction::args;

const BIDDERS: usize = 24;
const REVEALERS: usize = 15;

fn price_of(i: usize) -> u128 {
    5_000 + i as u128 * 150
}

#[test]
fn twenty_four_bidders_close_and_settle() {
    let mut s = setup();
    lock(&mut s);

    let mut sellers = Vec::new();
    for i in 0..BIDDERS {
        let seller = make_seller(&mut s.test, 60 + i as u8);
        commit(&mut s, &seller, price_of(i));
        sellers.push(seller);
    }

    // Fifteen reveal, in reverse order, so the lowest price (seller 0)
    // is the last one opened.
    set_epoch(&mut s.test, 5);
    for i in (0..REVEALERS).rev() {
        reveal(&mut s, &sellers[i], price_of(i));
    }
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);

    let inf = info(&mut s);
    assert_eq!(inf.state, asiri_types::TenderState::Awarded);
    let award = inf.award.expect("an award is recorded");
    assert_eq!(award.winner, sellers[0].key);
    assert_eq!(award.winning_price, Amount::new(price_of(0)));
    // Nine silent bonds forfeit: half locked, half to the circle.
    assert_eq!(inf.forfeit_locked, Amount::new(450));
    assert_eq!(inf.forfeit_for_circle, Amount::new(450));

    // Settle and pay the winner.
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
    let winner = &sellers[0];
    let before = balance(&mut s.test, winner.account);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "claim_payment", args![])
            .put_last_instruction_output_on_workspace("pay")
            .call_method(winner.account, "deposit", args![Workspace("pay")])
            .build_and_seal(&winner.secret),
        vec![winner.proof.clone()],
    );
    assert_eq!(
        balance(&mut s.test, winner.account) - before,
        Amount::new(price_of(0))
    );

    // Every revealer's bond comes back in full.
    for seller in sellers.iter().take(REVEALERS) {
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
        assert_eq!(
            balance(&mut s.test, seller.account) - before,
            Amount::new(BOND)
        );
    }

    // No silent seller can claim a forfeited bond.
    for seller in sellers.iter().skip(REVEALERS) {
        let tx = s
            .test
            .transaction()
            .call_method(s.tender, "claim_bond", args![])
            .build_and_seal(&seller.secret);
        s.test.execute_expect_failure(tx, vec![]);
    }

    // The circle collects its forfeit half and the refund; the locked
    // half stays recorded and unclaimable in the tender.
    let secret = s.approvers[0].2.clone();
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.circle, "collect_tender_forfeits", args![s.tender])
            .call_method(s.circle, "collect_tender_refund", args![s.tender])
            .call_method(s.circle, "treasury_balance", args![])
            .build_and_seal(&secret),
        vec![],
    );
    assert_eq!(
        s.test.expect_return::<Amount>(2),
        Amount::new(450 + (CAP - price_of(0)))
    );
    assert_eq!(info(&mut s).forfeit_locked, Amount::new(450));
}
