// The results screen: what the verifiers found when they read
// the season tenders. The screen follows the app's network.
// On mainnet it shows the mainnet season: the structured
// facts of the season's evidence record from
// mainnet-results-data.ts, with both verifiers' counts, and
// under each tender the standalone verifier's own receipt
// for it, its check rows and the file itself, from
// mainnet-receipts-data.ts. On esmeralda it shows the
// esmeralda record below, unchanged: the rows in
// results-data.ts are the standalone verifier's own output,
// captured on the date shown, never retyped, and any tender
// there can be rechecked live in the verify screen, in the
// browser, against the same public record.
//
// Below the check rows, each tender on either network offers
// its receipt as a download: the receipt file itself, byte
// for byte (esmeralda's from receipts-data.ts, mainnet's
// from mainnet-receipts-data.ts). The exception invoice and
// the zero-extraction ledger follow on the esmeralda view,
// as data generated from the published documents in
// proof-data.ts. The screen closes, on esmeralda, with the
// falsification cards from falsification-data.ts: labelled
// tampers of the records above, rejected by both verifiers
// at the quoted checks.
import { App, el, explorerLink, setAria } from "../app";
import {
  FALSIFICATION_CARDS,
  FALSIFICATION_CARDS_FILENAME,
  FALSIFICATION_CARDS_JSON,
  FALSIFICATION_META,
  type FalsificationRejection,
} from "../falsification-data";
import {
  MAINNET_TENDER_RECEIPTS,
} from "../mainnet-receipts-data";
import {
  MAINNET_RESULTS_META,
  MAINNET_TENDER_RECORDS,
} from "../mainnet-results-data";
import { EXCEPTION_INVOICE, LEDGER } from "../proof-data";
import { TENDER_RECEIPTS, TenderReceipt } from "../receipts-data";
import { RESULTS_META, TENDER_RESULTS } from "../results-data";
import { box, downloadTextFile, kv, kvNode, money, notice } from "./common";

function micro(n: number): string {
  return `${n.toLocaleString("en-US")} microtari`;
}

function downloadReceipt(r: TenderReceipt): void {
  const blob = new Blob([r.json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = r.filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke late: some browsers resolve the download after the
  // click handler returns, and an immediate revoke can cancel
  // it. The url stays valid for a few seconds, then goes away.
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function failRow(r: FalsificationRejection): HTMLElement {
  const row = el("div", "check-row fail");
  row.append(el("span", "tick", "!"));
  const text = el("div");
  text.append(
    el("div", undefined, r.check),
    el("div", "detail", r.detail),
  );
  row.append(text);
  return row;
}

function renderMainnetResults(
  app: App,
  wrap: HTMLElement,
  go: (hash: string) => void,
): void {
  const meta = MAINNET_RESULTS_META;
  const intro = box("verification results", "tari mainnet");
  intro.body.append(
    notice(
      "these are tari mainnet records. six tenders ran on mainnet against the heartland provisions circle, and both verifiers, the standalone script and the app's own verifier, read each tender from the public indexer and passed it in full with identical readings. open any tender in the verify screen to re-run the same checks live in your browser.",
    ),
    notice(
      "the records below carry the season's structured facts: addresses, epochs, amounts, fees, and the two verifiers' counts. under each record sits that tender's receipt: the standalone verifier's own output from a live run against the public mainnet indexer, its check rows shown in full and the file itself offered as a download, byte for byte. the command printed under each record reproduces the receipt from a clean checkout of the repo.",
    ),
  );
  kvNode(intro.body, "circle", explorerLink(app, "component", meta.circle));
  kv(intro.body, "network fees, six tenders", micro(meta.totalFeesMicro));
  wrap.append(intro.box);

  const receiptByTender = new Map(
    MAINNET_TENDER_RECEIPTS.map((r) => [r.tender, r]),
  );

  for (const t of MAINNET_TENDER_RECORDS) {
    const b = box(t.title, t.state);
    kvNode(b.body, "tender", explorerLink(app, "component", t.tender));
    kv(
      b.body,
      "result",
      `${t.standalonePass} of ${t.standaloneTotal} checks passed in the standalone verifier, ${t.appPass} of ${t.appTotal} in the app verifier`,
    );
    const receipt = receiptByTender.get(t.tender);
    if (receipt) {
      for (const row of receipt.checks) {
        const state = row.ok === null ? " unknown" : row.ok ? "" : " fail";
        const r = el("div", `check-row${state}`);
        r.append(el("span", "tick", row.ok === null ? "?" : row.ok ? "✓" : "!"));
        const text = el("div");
        text.append(
          el("div", undefined, row.check),
          el("div", "detail", row.detail),
        );
        r.append(text);
        b.body.append(r);
      }
    }
    const proves = el("div", "detail");
    proves.append(document.createTextNode(t.proves));
    b.body.append(proves);
    kv(
      b.body,
      "bids",
      `${t.commitments} committed, ${t.reveals} revealed` +
        (t.reveals < t.commitments
          ? `, ${t.commitments - t.reveals} stayed sealed`
          : ""),
    );
    if (t.paidMicro !== null) {
      kv(
        b.body,
        "paid",
        `${money(BigInt(t.paidMicro))} to ${t.paidTo}, settled at epoch ${t.closedEpoch}`,
      );
    } else {
      kv(
        b.body,
        "outcome",
        `nothing paid, expired at epoch ${t.closedEpoch}`,
      );
    }
    if (
      t.provenLowestMicro !== null &&
      t.paidMicro !== null &&
      t.rationaleHash !== null
    ) {
      kv(
        b.body,
        "proven lowest revealed price",
        `${money(BigInt(t.provenLowestMicro))}, by ${t.provenLowestBy}`,
      );
      kv(
        b.body,
        "the override",
        `the circle paid ${money(BigInt(t.paidMicro))} instead, by threshold approval, with a published rationale`,
      );
      kv(b.body, "rationale hash", t.rationaleHash);
    }
    if (t.disputeEvidenceHash !== null) {
      kv(b.body, "dispute evidence hash", t.disputeEvidenceHash);
    }
    kv(
      b.body,
      "escrow",
      `${money(BigInt(t.capMicro))} locked, ` +
        (t.paidMicro !== null
          ? `${money(BigInt(t.paidMicro))} paid, `
          : "nothing paid, ") +
        `${money(BigInt(t.refundMicro))} refunded`,
    );
    kv(b.body, "network fees", micro(t.feesMicro));
    const recheck = el(
      "button",
      "btn btn-white btn-sm mt",
      "recheck this tender live",
    );
    recheck.addEventListener("click", () => {
      // These records live on mainnet; the live recheck has to
      // read that network's indexer, whichever network is shown.
      if (app.network !== "mainnet") app.setNetwork("mainnet");
      go(`#/app/verify/${t.tender}`);
    });
    b.body.append(recheck);
    const cmd = el("div", "detail mt");
    cmd.append(
      document.createTextNode("or run it yourself: "),
      el(
        "span",
        "hash",
        `python3 scripts/verify.py ${t.tender} --network ${meta.network}`,
      ),
    );
    b.body.append(cmd);
    if (receipt) {
      const total = receipt.pass + receipt.fail + receipt.couldNotRead;
      kv(
        b.body,
        "receipt",
        `${receipt.pass} of ${total} checks passed` +
          (receipt.fail ? `, ${receipt.fail} failed` : "") +
          (receipt.couldNotRead
            ? `, ${receipt.couldNotRead} could not be read`
            : ""),
      );
      const prov = el("div", "detail");
      prov.append(
        document.createTextNode(
          `receipt provenance: ${receipt.revealProvenance}`,
        ),
      );
      b.body.append(prov);
      const hash = el("div", "detail");
      hash.append(
        document.createTextNode(`receipt sha256: ${receipt.sha256}`),
      );
      b.body.append(hash);
      const dl = el(
        "button",
        "btn btn-white btn-sm mt",
        "download the receipt (json)",
      );
      dl.addEventListener("click", () =>
        downloadTextFile(receipt.filename, receipt.json),
      );
      b.body.append(dl);
    }
    wrap.append(b.box);
  }
}

export async function renderResults(
  app: App,
  root: HTMLElement,
  go: (hash: string) => void,
): Promise<void> {
  const wrap = el("div");
  root.append(wrap);

  if (app.network === "mainnet") {
    renderMainnetResults(app, wrap, go);
    return;
  }

  const intro = box("verification results", "esmeralda testnet");
  intro.body.append(
    notice(
      "these are esmeralda testnet records. the standalone verifier read each tender from the public indexer and recomputed every value from the record itself. open any tender in the verify screen to re-run the same checks live in your browser.",
    ),
    notice(RESULTS_META.note),
  );
  kv(
    intro.body,
    "produced by",
    `${RESULTS_META.tool}, run on ${RESULTS_META.runDate}`,
  );
  intro.body.append(
    notice(
      "check any tender here yourself, from a clean checkout of the repo, with one command: python3 scripts/verify.py <the tender address> --network esmeralda. the script is python 3, standard library only, nothing to install, and it exits non-zero if any check fails. the exact command for each tender is printed under its record below.",
    ),
  );
  wrap.append(intro.box);

  const receiptByTender = new Map(
    TENDER_RECEIPTS.map((r) => [r.tender, r]),
  );

  for (const t of TENDER_RESULTS) {
    const b = box(t.title, t.state);
    kvNode(b.body, "tender", explorerLink(app, "component", t.tender));
    if (t.runError !== null) {
      const errEl = el("div", "err", t.runError);
      setAria(errEl, "role", "alert");
      b.body.append(errEl);
    } else {
      const passed = t.checks.filter((c) => c.ok === true).length;
      const unread = t.checks.filter((c) => c.ok === null).length;
      kv(
        b.body,
        "result",
        `${passed} of ${t.checks.length} checks passed` +
          (unread ? `, ${unread} could not be read` : ""),
      );
      for (const row of t.checks) {
        const state = row.ok === null ? " unknown" : row.ok ? "" : " fail";
        const r = el("div", `check-row${state}`);
        r.append(el("span", "tick", row.ok === null ? "?" : row.ok ? "✓" : "!"));
        const text = el("div");
        text.append(
          el("div", undefined, row.check),
          el("div", "detail", row.detail),
        );
        r.append(text);
        b.body.append(r);
      }
    }
    const recheck = el("button", "btn btn-white btn-sm mt", "recheck this tender live");
    recheck.addEventListener("click", () => {
      // These records live on esmeralda; the live recheck has to
      // read that network's indexer, whichever network is shown.
      if (app.network !== "esmeralda") app.setNetwork("esmeralda");
      go(`#/app/verify/${t.tender}`);
    });
    b.body.append(recheck);
    // The judge's own run, printed exactly: the standalone
    // script against this tender, from the repo root. The
    // address and the network come from the results data
    // itself, so the printed command cannot drift from the
    // record it checks.
    const cmd = el("div", "detail mt");
    cmd.append(
      document.createTextNode("or run it yourself: "),
      el(
        "span",
        "hash",
        `python3 scripts/verify.py ${t.tender} --network ${RESULTS_META.network}`,
      ),
    );
    b.body.append(cmd);

    const receipt = receiptByTender.get(t.tender);
    if (receipt) {
      const total = receipt.pass + receipt.fail + receipt.couldNotRead;
      kv(
        b.body,
        "receipt",
        `${receipt.pass} of ${total} checks passed` +
          (receipt.fail ? `, ${receipt.fail} failed` : "") +
          (receipt.couldNotRead
            ? `, ${receipt.couldNotRead} could not be read`
            : ""),
      );
      const prov = el("div", "detail");
      prov.append(
        document.createTextNode(
          `receipt provenance: ${receipt.revealProvenance}`,
        ),
      );
      b.body.append(prov);
      const dl = el(
        "button",
        "btn btn-white btn-sm mt",
        "download the receipt (json)",
      );
      dl.addEventListener("click", () => downloadReceipt(receipt));
      b.body.append(dl);
    }
    wrap.append(b.box);
  }

  const inv = EXCEPTION_INVOICE;
  const invoice = box("the exception invoice", "esmeralda testnet");
  invoice.body.append(
    notice(
      "one tender, one public decision, three checked facts. the override tender above is the one tender where the circle's approvers set the computed award aside, and this is what that decision cost, measured exactly.",
    ),
  );
  kv(
    invoice.body,
    "proven lowest revealed price",
    `${money(BigInt(inv.provenLowest.priceMicro))}, by ${inv.provenLowest.sellerName}`,
  );
  kv(
    invoice.body,
    "price actually paid",
    `${money(BigInt(inv.pricePaid.priceMicro))}, to ${inv.pricePaid.sellerName}, settled at epoch ${inv.settledEpoch}`,
  );
  kv(
    invoice.body,
    "the difference",
    money(BigInt(inv.differenceMicro)),
  );
  kv(
    invoice.body,
    "the override",
    `proposal ${inv.proposalId}, signed by ${inv.signers} approvers against a threshold of ${inv.threshold}, executed at epoch ${inv.executedEpoch}`,
  );
  kv(invoice.body, "rationale hash", inv.rationaleHash);
  const rationale = el("div", "detail");
  rationale.append(
    document.createTextNode(
      `the published rationale text, which hashes to that value: "${inv.rationaleText}"`,
    ),
  );
  invoice.body.append(rationale);
  invoice.body.append(notice(inv.boundary));
  wrap.append(invoice.box);

  const led = LEDGER;
  const ledger = box("zero-extraction ledger", "seven tenders");
  ledger.body.append(
    notice(
      "every tender the builders have run on esmeralda, accounted to the microtari. for each tender the escrow identity must close: the locked cap equals the winner paid, plus the refund the circle collected, plus what still sits in the escrow vault. the operator column is computed from every recorded outflow destination, not asserted.",
    ),
  );
  for (const row of led.rows) {
    kv(
      ledger.body,
      row.title,
      `escrow ${money(BigInt(row.escrowIn))} in, ` +
        (row.paid === null
          ? "nothing paid, no settlement, "
          : `${money(BigInt(row.paid))} paid, `) +
        `${money(BigInt(row.refunded))} refunded, ` +
        `${money(BigInt(row.inVault))} still in the vault, ` +
        `operator ${money(BigInt(row.operatorPaid))}`,
    );
  }
  kv(
    ledger.body,
    "locked in a tender forever",
    `${money(BigInt(led.totals.lockedForever))}, unspendable, not burned`,
  );
  kv(
    ledger.body,
    "network fees, seven tenders",
    micro(led.totals.feesMicro),
  );
  kv(
    ledger.body,
    "paid to the operator, in total",
    money(BigInt(led.totals.operatorPaid)),
  );
  ledger.body.append(
    notice(
      `one fee figure does not match between the two records: the dispute tender's collect-forfeits fee, transaction ${led.discrepancy.tx}, is written as ${micro(led.discrepancy.evidenceMicro)} in the evidence record and ${micro(led.discrepancy.historyMicro)} in the wallet history. it stands as printed in both, uncorrected.`,
    ),
  );
  wrap.append(ledger.box);

  const fm = FALSIFICATION_META;
  const falsification = box("falsification cards", "esmeralda testnet");
  falsification.body.append(
    notice(
      "a results page that only shows passes asks to be trusted. these cards ask the opposite: each one takes the real record of a tender above, changes exactly one labelled thing, and runs both verifiers against the tampered copy. every card is rejected by both verifiers, at the checks quoted below, in the verifiers' own words. the originals were never edited, and anyone can repeat the experiment: take a tender's record, change one field, and watch the same checks fail.",
    ),
    notice(fm.methodNote),
  );
  for (const c of fm.controls) {
    kv(
      falsification.body,
      `control, ${c.label}`,
      `${c.standalone.pass} of ${c.standalone.total} checks passed in both verifiers, nothing failed, nothing unread`,
    );
  }
  const dlCards = el(
    "button",
    "btn btn-white btn-sm mt",
    "download the cards (json)",
  );
  dlCards.addEventListener("click", () =>
    downloadTextFile(FALSIFICATION_CARDS_FILENAME, FALSIFICATION_CARDS_JSON),
  );
  falsification.body.append(dlCards);

  for (const card of FALSIFICATION_CARDS) {
    falsification.body.append(el("h3", "mt", card.title));
    kvNode(
      falsification.body,
      "tender",
      explorerLink(app, "component", card.tender),
    );
    kv(falsification.body, "the lie", card.lie);
    kv(falsification.body, "the change", card.field);
    kv(falsification.body, "original", card.originalText);
    kv(falsification.body, "tampered", card.tamperedText);
    falsification.body.append(
      el("div", "detail mt", `standalone verifier: ${card.passedText.standalone}, the failing checks:`),
    );
    for (const r of card.rejections.standalone) {
      falsification.body.append(failRow(r));
    }
    falsification.body.append(
      el("div", "detail mt", `app verifier: ${card.passedText.app}, the failing checks:`),
    );
    for (const r of card.rejections.app) {
      falsification.body.append(failRow(r));
    }
    if (card.note !== null) {
      falsification.body.append(notice(card.note));
    }
  }
  wrap.append(falsification.box);
}
