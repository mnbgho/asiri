# Asiri Roadmap

Asiri is live on Tari mainnet today. The app is at https://asiri-libg.netlify.app. This file says what is already done and what comes next. Dates are by month only.

## What Is Already Done

- Seven tenders have settled on mainnet against the Heartland Provisions Circle. Six ran as a season. The seventh ran purely to be attacked.
- The shipped receipts carry 90 of 90 checks. Two independent verifiers recomputed them with identical readings on every tender.
- Eighteen attacks were refused by the chain. Each refusal is recorded in the chain's own words.
- 465 tests pass from a clean checkout. 51 cover the engine. 342 cover the app. 72 cover the standalone verifier.
- Both mainnet templates match the hashes pinned in this repo. The match was checked on both public indexers. A fresh rebuild reproduces the template definition exactly.
- A seven-tender season ran on the Esmeralda testnet first, with the same full verification. The full record is in [evidence/mainnet.md](evidence/mainnet.md) and [evidence/esmeralda.md](evidence/esmeralda.md).

## What Comes Next

### December

**A real circle, run by people outside the project.**

What changes: a group that is not part of this project runs a circle with its own keys and makes a real purchase through the app, from the first bid to the final payment.
Why: it shows the product works for the people it was built for.

**The full journey, made smooth end to end.**

What changes: the app guides a circle from the first bid to the final payment without a step that cannot be finished. The first reveal works from the app. Confirmation after each step reads correctly on mainnet.
Today the first reveal of a tender cannot be done from the app. The app only offers a reveal once the tender is already in its reveal state, and only a reveal moves it there. The change makes the app accept the tender in its open state once bids have closed, exactly as the template does. Today the app can also show "unconfirmed" after a step that landed, because the indexer no longer serves the transaction bodies the app reads to confirm. The change confirms by reading the change on chain, and says plainly which way the confirmation was reached.
Why: a circle should never stall on a step it cannot see how to finish.

**Evidence that is easy to reproduce.**

What changes: every component, template, and transaction in the record links to the public indexer. A rebuild route ships with a pinned toolchain, so anyone can rebuild the templates and compare them with what is on chain.
Why: proof that cannot be rechecked is only a claim. The record should be checkable by anyone, from the repo alone.
The comparison is honest about what matches. The template definition matches exactly. The stored code differs, because the network recompiles code when it is published.

### January

**Safer salt handling.**

What changes: a seller checks the salt on the device before the wallet opens, so a wrong salt costs no fee. The commit asks the seller to confirm the salt is saved before the bond moves. A saved salt can be shown again, on demand, with a copy button. The encrypted backup comes first, with the plain backup behind a warning. A backup file is checked against its own commitment at import, so a damaged file fails before any fee is spent. A restore from a backup is proven on a test tender before it ships.
Why: the salt is the one secret a seller must keep. Losing it loses the bid. The app should make keeping it easy and losing it hard.

**Deeper testing of disputes and overrides, then an independent security review.**

What changes: new tests cover disputes, overrides, expiry, claims, and approver changes, including the cases where votes split and where an approver changes mid-dispute. The attack tool gains dispute and expiry steps. An independent security review follows, with a scope limited to the template code.
Why: the paths that move money under disagreement deserve the hardest testing. An outside review brings fresh eyes to the code that moves money.
