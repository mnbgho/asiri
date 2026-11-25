# asiri-verify

Verify one Asiri sealed tender from public indexer data alone. Asiri is a
sealed tender product for buying circles on Tari Ootle: rules and budget lock
before bidding, bids are hash commitments backed by bonds, only revealed bids
can win, and the template awards the lowest valid revealed price.

The verifier reads the tender and its circle from the network's public
indexer, plus the tender's transaction history, and checks the public record
end to end: the component runs the published template code, the rules hash
recomputes from the displayed rules, the escrow funding matches the budget
cap, every reveal verifies against its commitment, the award is the lowest
valid revealed price under the locked rules (or a threshold-approved override
with a rationale hash whose published text hashes to the same value), the
settlement equals the award, and every bond reached a recorded outcome.

It proves the winner is the lowest revealed bid under locked rules. A bid
nobody reveals stays sealed forever and cannot win, so the verifier never
claims the winner is lower than bids nobody revealed.

## Install

```
pip install asiri-verify
```

Python 3.9 or later, standard library only, nothing else to install. No
wallet, no account, no keys. It needs network access to the network's public
indexer: indexer-a.ootle.tari.com on mainnet, and ootle-indexer-a.tari.com
with esme-indexer-a.ootle.tari.com as fallback on Esmeralda.

## Use

```
asiri-verify component_<tender address>
asiri-verify component_<tender address> --network esmeralda
```

Mainnet is the default network; pass `--network esmeralda` for a testnet
tender. Add `--receipt` to print the full receipt as JSON instead of the
check list, `--json` for the check list as JSON, and `--rationale <path>` to
check an override's published rationale text against its recorded hash.

Each check prints one line, pass, fail, or could not be read, and the run
ends with a count. The exit code is zero only when every check passes. Could
not be read means a reveal's transaction could not be read from any indexer,
so that reveal cannot be recomputed against its commitment today, for
example when an indexer has pruned old transaction bodies. It is neither a
pass nor a failure, and the tender is not fully verified until every check
has run, so the exit code stays non-zero.

## From the repo

The same verifier ships in the Asiri repo, where it runs with no install:

```
python3 scripts/verify.py component_<tender address>
```

Source: https://github.com/mnbgho/asiri
Live app: https://asiri-libg.netlify.app
