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

## Verify a tender yourself

Every tender's public record can be checked without trusting this app or its operator. `scripts/verify.py` reads one tender and its circle from the network's public indexer and checks the record end to end:

- the component runs the published template code,
- the rules hash recomputes from the displayed rules,
- the escrow funding matches the budget cap,
- every reveal verifies against its commitment,
- the award is the lowest valid revealed price under the locked rules, or a threshold-approved override whose chosen bid is itself a valid revealed bid and whose rationale hash matches the published text when you supply it,
- the settlement equals the award, was reached only after delivery confirmation at threshold or a dispute resolved for the winner at its higher threshold, and honours the winning commitment's payment identity,
- every bond reached a recorded outcome, the forfeit split is recorded, and the bond vault reconciles.

It needs Python 3 and nothing else: no packages to install, no wallet, no account, no keys. It does need network access to the network's public indexer.

Run it from the repo root:

```
python3 scripts/verify.py component_<tender address>
python3 scripts/verify.py component_<tender address> --network esmeralda
```

Mainnet is the default network; pass `--network esmeralda` for a testnet tender. Add `--receipt` to print the full receipt as JSON instead of the check list, `--json` for the check list as JSON, and `--rationale <path>` to check an override's published rationale text against its recorded hash. For an override tender, run with `--rationale`: without the text, that one check reports a fail marked unverifiable, because the run was never given the text to check.

Each check prints one line, pass, fail, or could not be read, and the run ends with a count. The exit code is zero only when every check passes. Could not be read means a reveal's transaction could not be read from any indexer, so that reveal cannot be recomputed against its commitment today, for example when an indexer has pruned old transaction bodies. It is neither a pass nor a failure, and the tender is not fully verified until every check has run, so the exit code stays non-zero.

## Status

The templates are published on Tari mainnet: circle template `template_b86a46241753b8b8e4c2e9571c0db727925d77e1274009175e4f0b0e18cf466b`, tender template `template_267d1d73da73ec990e8711e492bccb9112076051d396922bdef2b9d667c684eb`. The bytes published were the exact esmeralda template bytes. The mainnet network recompiled the code at publish time, so the stored code hashes differ from esmeralda's while the template interface is identical.

The Heartland Provisions Circle is live on mainnet at `component_46237d52379c5d9289814c67ca840f5fa2aad2b12ed2291acf0e74a5091aca71`, three approvers, threshold 2. A season of six tenders ran against it: a plain award, a tie, an override, a dispute, an expiry, and a ten-seller tender. Each one settled or expired and was verified in full by both the standalone script and the app's verifier, with identical readings. The same product ran a seven-tender season on the esmeralda testnet before mainnet.

The web app is live at https://asiri-libg.netlify.app and defaults to mainnet, with an esmeralda switch kept. Its results page carries the esmeralda season's recorded receipts and the mainnet season's records, each under its own network's view. Every tender on either network can be re-checked with the verifier above.
