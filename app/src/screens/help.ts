// Help: the questions a new circle asks in its first month,
// answered from how the shipped product actually behaves and
// what the trial season's record shows. Every answer here is
// checked against the code and the claim boundary: the winner
// is the lowest valid revealed price, an unrevealed bid stays
// sealed forever, and an unrevealed bond's locked half stays
// in the tender unspendable, never burned.
import { App, el, tari } from "../app";
import { TYPICAL_FEES } from "../fees";
import { fundingGuidance } from "../funding";
import { box, kv, notice } from "./common";

interface Qa {
  q: string;
  a: string[];
}

const QUESTIONS: Qa[] = [
  {
    q: "What is an epoch?",
    a: [
      "An epoch is one round of the network, and every deadline in Asiri is counted in epochs. An Esmeralda epoch is about an hour, and a Mainnet epoch is about twenty minutes. Wherever the app shows a deadline it shows the epoch with an approximate clock time and countdown beside it, so you can plan in hours and days. The times are approximations: the chain moves in epochs, not in minutes.",
    ],
  },
  {
    q: "What happens if I never reveal my bid?",
    a: [
      "Your bid stays sealed forever. Nobody can open it, and once the reveal window closes you cannot open it either. When the tender settles, your bond is split: half goes to the circle, and half stays locked in the tender forever, where nobody can spend it. There is one exception: if the tender expires with no award, an unrevealed bond comes back whole.",
    ],
  },
  {
    q: "How do bonds and forfeits work?",
    a: [
      "Every bid posts the bond named in the tender's locked rules, held apart from the price. If you reveal your bid, your bond comes back in full after the tender settles, win or lose, and you claim it from the tender page. If you never reveal, the split in the answer above applies: the circle collects its half through its circle page, and the locked half stays in the tender forever, unspendable by anyone.",
    ],
  },
  {
    q: "What is an override, and what does it cost the circle?",
    a: [
      "When the reveal window closes, the template awards the tender to the lowest valid revealed price. An override is the circle replacing that winner with another seller who revealed a bid, or cancelling the tender instead. It needs signatures from the circle's approval threshold of approvers, inside the override window, and the hash of a written rationale goes on chain. The circle publishes the rationale text itself, and anyone can check the text against the hash on the tender page or the verify screen.",
      "The winner is paid the chosen seller's revealed price out of the escrow, not the lowest one, so the choice costs the circle the difference between the two prices. In the Esmeralda trial season the circle once paid 16 tari where the lowest revealed price was 14 tari: the extra 2 tari is what the override cost, and the results page carries that record as the exception invoice.",
    ],
  },
  {
    q: "How does verification work, and what does could not be read mean?",
    a: [
      "Every tender can be checked two ways: the verify screen in this app, and the standalone verifier named on the results page. Both recompute the same checks from the public record: the locked rules hash, the escrow, every commitment, every reveal rehashed against its commitment, the award, the settlement, and the bonds. Nothing is taken from the tender's own claims. There are 13 checks on an ordinary tender, 15 where the circle overrode the award, and 10 on a tender that expired.",
      "Some checks read the bodies of older transactions from the public indexers, and the indexers no longer serve some of those bodies. A check that cannot read what it needs reports could not be read, which is neither a pass nor a fail. The results page carries receipts captured from the record, so the proof of the trial tenders survives that loss.",
    ],
  },
  {
    q: "I lost my salt. Can it be recovered?",
    a: [
      "No. A bid's salt exists only where you kept it: in this browser's saved bids, on paper if you wrote it down, or in a backup file you exported from bid and reveal. The commitment on chain is a one-way hash, and nobody can work the salt back out of it: not the circle, not this app, and not the network. There is no recovery path. Without the salt the bid can never be revealed, and its bond follows the never-reveal outcome above. Export a backup from bid and reveal before you need it.",
    ],
  },
  {
    q: "My transaction failed. What do I do?",
    a: [
      "Submitting and succeeding are two different events, and the app treats them that way. After you sign, the app reads the outcome back from the public record. A transaction ends confirmed, failed on chain, or submitted and still awaiting finalization. If it failed on chain, the screen shows the chain's own reason and a link to the transaction, and no escrow and no bond has moved; only the small network fee is spent.",
      "The usual reasons are acting before a window opened or after it closed, signing from a different account than the one the action belongs to, and a balance that cannot cover the amount. Fix the reason and try again. If a transaction stays awaiting finalization, give it a little time and reload the tender page: what the page shows is the chain's state, not a guess.",
    ],
  },
];

const FEE_ROWS: [string, keyof typeof TYPICAL_FEES][] = [
  ["Commit a bid", "commitBid"],
  ["Reveal a bid", "revealBid"],
  ["Close the reveal window", "closeReveal"],
  ["confirm delivery", "confirmDelivery"],
  ["Claim a dispute", "claimDispute"],
  ["Resolve a dispute, per vote", "resolveDispute"],
  ["claim payment", "claimPayment"],
  ["Claim a receipt", "claimReceipt"],
  ["Claim a bond back", "claimBond"],
  ["Collect the escrow refund", "collectRefund"],
  ["Expire a tender", "expire"],
];

export async function renderHelp(app: App, root: HTMLElement): Promise<void> {
  // The answers cover both networks and read no chain state,
  // so the app instance goes unused; the signature matches the
  // other screens for the router's sake.
  void app;
  const wrap = el("div");
  root.append(wrap);

  const intro = box("help", "Questions and answers");
  intro.body.append(
    notice(
      "Answers from how the product actually behaves, checked against the tender records and the verifier. Nothing here asks you to trust this page: the records behind each answer are on the results page and the verify screen.",
    ),
  );
  wrap.append(intro.box);

  for (const { q, a } of QUESTIONS) {
    const b = box(q);
    for (const p of a) b.body.append(el("p", undefined, p));
    wrap.append(b.box);
  }

  const funding = box("Where does Tari come from?");
  funding.body.append(
    el("p", undefined, fundingGuidance("esmeralda")),
    el("p", undefined, fundingGuidance("mainnet")),
  );
  wrap.append(funding.box);

  const fees = box("What does it cost to use Asiri?");
  fees.body.append(
    el(
      "p",
      undefined,
      "The network charges a small fee for every action, paid by whoever signs it. A fee never comes out of a tender's escrow or a bid's bond. The figures below are typical, measured across the Esmeralda trial season; a bigger tender can run higher, and your wallet shows the exact cost before you approve.",
    ),
  );
  for (const [label, action] of FEE_ROWS) {
    kv(fees.body, label, `About ${tari(TYPICAL_FEES[action])} tari`, true);
  }
  wrap.append(fees.box);
}
