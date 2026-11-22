//! Property tests for the closing logic. Generated bid fields are run
//! through the real engine, and the outcome is checked against an
//! oracle computed in this file from first principles: the winner is
//! the lowest valid revealed price, ties broken by reveal order; a
//! committed seller with no valid reveal forfeits the bond when a
//! winner exists; with no valid reveal at all, the tender expires and
//! every bond returns. The oracle shares no code with the template.
//!
//! Every case then runs the money to ground: the winner is paid, the
//! refund reaches the treasury, returnable bonds come back, forfeited
//! bonds cannot be claimed, and outflows plus forfeits equal inflows.

mod common;

use common::*;
use tari_template_lib::prelude::*;
use tari_template_test_tooling::transaction::args;

/// A deterministic generator, so a failing case reproduces exactly.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

const PRICES: [u128; 8] = [6_000, 7_000, 8_000, 8_000, 9_000, 10_000, 11_000, 12_000];

struct Case {
    /// Committed price per seller, in seller order.
    prices: Vec<u128>,
    /// Sellers who reveal, in reveal order, as seller indices.
    reveal_order: Vec<usize>,
}

fn random_case(seed: u64) -> Case {
    let mut rng = Rng(seed);
    let n = 1 + rng.below(6) as usize;
    let prices: Vec<u128> = (0..n)
        .map(|_| PRICES[rng.below(8) as usize])
        .collect();
    let mut reveal_order: Vec<usize> = (0..n).filter(|_| rng.below(10) < 7).collect();
    // Fisher-Yates shuffle, driven by the same generator.
    for i in (1..reveal_order.len()).rev() {
        let j = rng.below(i as u64 + 1) as usize;
        reveal_order.swap(i, j);
    }
    Case {
        prices,
        reveal_order,
    }
}

struct Oracle {
    /// (seller index, price) of the winner, if any valid reveal exists.
    winner: Option<(usize, u128)>,
    /// Bond total forfeited at the close.
    forfeited: u128,
}

fn oracle(case: &Case) -> Oracle {
    let mut best: Option<(usize, u128)> = None;
    for &idx in &case.reveal_order {
        let price = case.prices[idx];
        if price > CAP {
            continue;
        }
        match best {
            Some((_, best_price)) if price >= best_price => {}
            _ => best = Some((idx, price)),
        }
    }
    let forfeited = match best {
        Some(_) => {
            let valid: Vec<usize> = case
                .reveal_order
                .iter()
                .copied()
                .filter(|&i| case.prices[i] <= CAP)
                .collect();
            (case.prices.len() - valid.len()) as u128 * BOND
        }
        None => 0,
    };
    Oracle {
        winner: best,
        forfeited,
    }
}

fn treasury(s: &mut Setup) -> Amount {
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.circle, "treasury_balance", args![])
            .build_and_seal(s.test.secret_key()),
        vec![],
    );
    s.test.expect_return(0)
}

fn claim_bond(s: &mut Setup, seller: &Seller) -> Amount {
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
    balance(&mut s.test, seller.account) - before
}

fn claim_bond_fails(s: &mut Setup, seller: &Seller) {
    let tx = s
        .test
        .transaction()
        .call_method(s.tender, "claim_bond", args![])
        .build_and_seal(&seller.secret);
    s.test.execute_expect_failure(tx, vec![]);
}

fn collect_refund_to_treasury(s: &mut Setup) -> Amount {
    let before = treasury(s);
    let secret = s.approvers[0].2.clone();
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.circle, "collect_tender_refund", args![s.tender])
            .build_and_seal(&secret),
        vec![],
    );
    treasury(s) - before
}

fn run_case(case_no: usize, case: &Case) {
    let expected = oracle(case);
    let mut s = setup();
    lock(&mut s);
    let mut sellers = Vec::new();
    for (i, price) in case.prices.iter().enumerate() {
        let seller = make_seller(&mut s.test, (case_no * 16 + i) as u8);
        commit(&mut s, &seller, *price);
        sellers.push(seller);
    }
    set_epoch(&mut s.test, 5);
    for &idx in &case.reveal_order {
        reveal(&mut s, &sellers[idx], case.prices[idx]);
    }
    set_epoch(&mut s.test, 10);
    close_reveal(&mut s);

    let inf = info(&mut s);
    assert_eq!(
        inf.forfeit_for_circle + inf.forfeit_locked,
        Amount::new(expected.forfeited),
        "case {case_no}: forfeit total"
    );
    assert_eq!(
        inf.forfeit_locked,
        Amount::new(expected.forfeited / 2),
        "case {case_no}: locked half"
    );

    let mut outflows: u128 = 0;
    match expected.winner {
        Some((winner_idx, price)) => {
            assert_eq!(
                inf.state,
                asiri_types::TenderState::Awarded,
                "case {case_no}: state"
            );
            let award = inf.award.expect("an award is recorded");
            assert_eq!(award.winner, sellers[winner_idx].key, "case {case_no}: winner");
            assert_eq!(
                award.winning_price,
                Amount::new(price),
                "case {case_no}: winning price"
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

            let winner = &sellers[winner_idx];
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
            let paid = balance(&mut s.test, winner.account) - before;
            assert_eq!(paid, Amount::new(price), "case {case_no}: payment");
            outflows += price;

            let refund = CAP - price;
            if refund > 0 {
                let got = collect_refund_to_treasury(&mut s);
                assert_eq!(got, Amount::new(refund), "case {case_no}: refund");
                outflows += refund;
            }

            // Bonds: valid revealers get theirs back, the rest cannot
            // claim at all.
            let valid: Vec<usize> = case
                .reveal_order
                .iter()
                .copied()
                .filter(|&i| case.prices[i] <= CAP)
                .collect();
            for (i, seller) in sellers.iter().enumerate() {
                if valid.contains(&i) {
                    let back = claim_bond(&mut s, seller);
                    assert_eq!(back, Amount::new(BOND), "case {case_no}: bond back");
                    outflows += BOND;
                } else {
                    claim_bond_fails(&mut s, seller);
                }
            }
        }
        None => {
            assert_eq!(
                inf.state,
                asiri_types::TenderState::Expired,
                "case {case_no}: state"
            );
            assert!(inf.award.is_none(), "case {case_no}: no award");
            let got = collect_refund_to_treasury(&mut s);
            assert_eq!(got, Amount::new(CAP), "case {case_no}: full refund");
            outflows += CAP;
            for seller in &sellers {
                let back = claim_bond(&mut s, seller);
                assert_eq!(back, Amount::new(BOND), "case {case_no}: bond back");
                outflows += BOND;
            }
        }
    }

    let inflows = CAP + case.prices.len() as u128 * BOND;
    assert_eq!(
        outflows + expected.forfeited,
        inflows,
        "case {case_no}: conservation"
    );
}

#[test]
fn closing_matches_the_oracle_over_generated_fields() {
    for case_no in 0..12 {
        let case = random_case(0xA511_0001 + case_no as u64 * 7_919);
        run_case(case_no, &case);
    }
}

#[test]
fn closing_matches_the_oracle_on_shaped_fields() {
    // A tie at the lowest price: the earliest revealer wins, the
    // silent seller forfeits.
    run_case(
        100,
        &Case {
            prices: vec![8_000, 8_000, 9_000],
            reveal_order: vec![1, 0],
        },
    );
    // Nobody reveals: expiry, every bond back.
    run_case(
        101,
        &Case {
            prices: vec![7_000, 8_000],
            reveal_order: vec![],
        },
    );
    // Only invalid reveals: expiry under the no-valid-reveal rule,
    // every bond back.
    run_case(
        102,
        &Case {
            prices: vec![11_000, 12_000],
            reveal_order: vec![0, 1],
        },
    );
    // One seller, revealing exactly at the cap: wins at the cap.
    run_case(
        103,
        &Case {
            prices: vec![10_000],
            reveal_order: vec![0],
        },
    );
}
