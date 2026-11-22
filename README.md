# Asiri

Asiri, sealed tenders for buying circles, on Tari Ootle.

Buying circles, cooperatives, shop networks, and offices buy together to get better prices. The tender that picks the supplier is usually run on paper or in a chat group, and it can be rigged in quiet ways. The rules change after the bids are seen. A favoured supplier wins without the lowest price. Losing prices leak and get used against the losers in the next round.

Asiri runs the tender inside a Tari Ootle template instead, where those moves have no path.

## How it works

1. Lock the rules. The circle writes the specification, the budget cap, the scoring rule, and the windows into the template and escrows the budget. From that moment the rules cannot change.
2. Bid in secret. Each seller posts a sealed commitment and a bond. Nobody can open a bid early, not the circle, not rival sellers.
3. Reveal to win. When the bid window closes, sellers reveal their own bids. Only revealed bids can win. A bid nobody reveals stays sealed forever.
4. The template awards. The lowest valid revealed price wins under the locked rules. If the circle wants a different winner, payment stays blocked until the reason is written into the public record, with the price difference shown.
5. Deliver, then settle. The circle confirms delivery and the winner is paid by stealth transfer, with a receipt anyone can verify.

## What Asiri does not claim

The winner is the lowest valid revealed bid under the locked rules. Asiri never claims the winner beat bids nobody revealed. Escrow balances and the budget cap are public, as they are on any template. Privacy covers the bids that stay sealed and the payment itself.

## Security invariants

The templates are built so these properties hold by construction. Each one has an engine test named after it in the test suite.

- I1. Rules never change after the tender is locked and funded.
- I2. Escrow outflows never exceed escrow inflows, and the award payment never exceeds the cap.
- I3. A commitment can be revealed only by its own seller, only in the reveal window, and only with the exact committed price and salt.
- I4. No price is ever recorded for an unrevealed commitment.
- I5. The award always equals the lowest valid revealed price, ties broken by earliest reveal.
- I6. Money leaves a tender only through its settlement, expiry, and dispute paths.
- I7. An override cannot execute without a recorded rationale hash and approver signatures at threshold.
- I8. Delivery payment cannot execute without delivery confirmations at threshold, except through dispute resolution at its higher threshold with a recorded rationale.
- I9. Every bond is accounted for at every terminal state: returned in full, or forfeited on the recorded split. Half of a forfeited bond goes to the circle, and half stays locked in the tender forever, where no method can release it. The locked amount is part of the tender's public record.
- I10. One commitment per seller per tender, enforced by the template state.
- I11. Windows are enforced by engine epochs. No caller's arguments can move a deadline.
- I12. Neither component has an owner. No key can upgrade the code, move funds, change rules, or alter an outcome.
- I13. A tender with no valid reveals always ends expired with full refunds. It can never default to an award.
- I14. The winner paid is always the payment identity bound in the winning commitment.
- I15. Every state transition emits an event, and the events plus the tender's public record suffice to reconstruct what happened without trusting the app.

## Status

The template core is built and covered by engine tests. The web app and the network deployment come next. Nothing is live on any network yet.
