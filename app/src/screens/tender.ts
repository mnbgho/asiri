// The tender record: everything the chain publishes about one
// tender, with the id of every transaction that touched it,
// and the actions its state allows.
import { App, el, errorBox, explorerLink, short, tari } from "../app";
import * as B from "../builders";
import { disputeWindowOpen } from "../model";
import { decodeTenderState, decodeVaultBalance, plainAddressError } from "../state";
import { deadlineSpan } from "../time";
import { actionButton, box, feeNote, field, hashSpan, kv, kvNode, money, notice, requireWallet, settleOutcome, textInput } from "./common";
import { evidenceCheckControl, hashFileControl } from "./evidence-ui";
import type { FeeAction } from "../fees";

export async function renderTender(
  app: App,
  root: HTMLElement,
  address: string,
  go: (hash: string) => void,
): Promise<void> {
  const wrap = el("div");
  root.append(wrap);
  try {
    const sub = await app.indexer.substate(address);
    if (!sub) throw new Error("This tender's substate is down");
    const t = decodeTenderState(sub.value);
    app.watch("tenders", address);
    let epoch = 0;
    try {
      epoch = await app.indexer.epoch();
    } catch {
      /* deadlines still render */
    }

    const head = box(t.circleName || "sealed tender", `${t.state} · epoch ${epoch || "?"}`);
    kv(head.body, "Tender", address);
    kvNode(head.body, "Circle", explorerLink(app, "component", t.circle));
    kv(head.body, "Bound to its circle", t.bound ? "Yes" : "Not yet");
    kv(head.body, "Template", t.template);
    wrap.append(head.box);

    const rules = box("locked rules", t.rulesHash ? "Hash locked at funding" : "Not locked yet");
    kv(rules.body, "What is being bought", "specification " + short(t.rules.specificationHash));
    kvNode(rules.body, "Specification hash", hashSpan(t.rules.specificationHash));
    kv(rules.body, "Budget cap", money(t.rules.budgetCap));
    kv(rules.body, "Bond per bid", money(t.rules.bondAmount));
    kv(
      rules.body,
      "Windows in epochs",
      `Bid ${t.rules.bidWindowEpochs} · Reveal ${t.rules.revealWindowEpochs} · Override ${t.rules.overrideWindowEpochs} · Delivery ${t.rules.deliveryWindowEpochs} · Claim grace ${t.rules.claimGraceEpochs} · Dispute ${t.rules.disputeWindowEpochs}`,
      true,
    );
    kv(
      rules.body,
      "Approval thresholds",
      `${t.rules.approvalThreshold} of ${t.approvers.length} approvers · Disputes need ${t.rules.disputeThreshold}`,
      true,
    );
    if (t.rulesHash) kvNode(rules.body, "Rules hash", hashSpan(t.rulesHash));
    wrap.append(rules.box);

    const moneyBox = box("money");
    try {
      const escrowSub = await app.indexer.substate(t.escrowVault);
      if (escrowSub)
        kv(moneyBox.body, "Escrow now", money(decodeVaultBalance(escrowSub.value)));
    } catch {
      kv(moneyBox.body, "Escrow now", "Unreadable");
    }
    try {
      const bondsSub = await app.indexer.substate(t.bondsVault);
      if (bondsSub)
        kv(moneyBox.body, "Bonds held now", money(decodeVaultBalance(bondsSub.value)));
    } catch {
      kv(moneyBox.body, "Bonds held now", "Unreadable");
    }
    if (t.forfeitLocked > 0n)
      kv(moneyBox.body, "Forfeited, locked forever", money(t.forfeitLocked));
    if (t.forfeitForCircle > 0n)
      kv(moneyBox.body, "Forfeited, owed to the circle", money(t.forfeitForCircle));
    if (t.settlement)
      kv(
        moneyBox.body,
        "Settled",
        `${money(t.settlement.price)} at epoch ${t.settlement.epoch}`,
      );
    wrap.append(moneyBox.box);

    const timeline = box("timeline");
    // Deadlines render as live spans (see time.ts): the epoch,
    // plus an approximate wall-clock reading and countdown the
    // periodic refresh keeps current. The deadlines whose
    // passing opens an action on this screen are gates, so the
    // refresh re-renders and the action appears.
    const line = (k: string, v: number | null, gate = false) => {
      if (v !== null)
        kvNode(timeline.body, k, deadlineSpan(app.network, v, epoch, { gate }));
    };
    line("locked", t.lockEpoch);
    line("bids close", t.bidDeadline);
    line("reveals close", t.revealDeadline, true);
    line("override window closes", t.overrideDeadline, true);
    line("Delivery by", t.deliveryDeadline, true);
    line("claims close", t.claimDeadline, true);
    if (!timeline.body.children.length)
      timeline.body.append(el("div", "empty", "Not locked yet. The timeline appears when the circle funds the escrow."));
    wrap.append(timeline.box);

    const bids = box("bids", `${t.commitments.length} committed · ${t.reveals.length} revealed`);
    if (!t.commitments.length) {
      bids.body.append(el("div", "empty", "No bids committed yet. A committed bid is a hash: the price stays sealed until its owner reveals it."));
    }
    for (const c of t.commitments) {
      const row = el("div", "commit-row");
      row.append(el("span", "who", short(c.seller)));
      row.append(hashSpan(c.commitment));
      row.append(el("span", "spacer"));
      const reveal = t.reveals.find((r) => r.commitment === c.commitment);
      row.append(
        el(
          "span",
          undefined,
          reveal
            ? `Revealed at ${tari(reveal.price)} tari`
            : c.revealed
              ? "revealed"
              : "sealed",
        ),
      );
      row.append(el("span", "pill pill-line", c.bond.toLowerCase()));
      bids.body.append(row);
    }
    if (t.award) {
      const a = box("award");
      kv(a.body, "Winning price", money(t.award.winningPrice));
      kvNode(a.body, "Winning commitment", hashSpan(t.award.winningCommitment));
      kvNode(a.body, "Winner payment identity", hashSpan(t.award.winner));
      wrap.append(a.box);
    }
    wrap.append(bids.box);

    if (t.overrideRecord) {
      const o = box("override", "The circle replaced the computed award");
      kvNode(o.body, "Chosen seller", t.overrideRecord.chosen ? hashSpan(t.overrideRecord.chosen) : el("span", undefined, "None, the tender was cancelled"));
      kvNode(o.body, "Rationale hash", hashSpan(t.overrideRecord.rationaleHash));
      o.body.append(evidenceCheckControl(t.overrideRecord.rationaleHash));
      kv(o.body, "Executed at epoch", String(t.overrideRecord.epoch), true);
      o.body.append(
        notice(
          "The rationale text itself is published by the circle off chain. On the verify page, anyone can check that the published text hashes to the value above.",
        ),
      );
      wrap.append(o.box);
    }

    if (t.dispute) {
      const d = box(
        "dispute",
        t.dispute.resolvedForWinner === null
          ? "Waiting for the circle to resolve it"
          : "resolved",
      );
      kvNode(d.body, "Evidence hash", hashSpan(t.dispute.evidenceHash));
      d.body.append(evidenceCheckControl(t.dispute.evidenceHash));
      kv(d.body, "Filed at epoch", String(t.dispute.epoch), true);
      kvNode(d.body, "Votes close", deadlineSpan(app.network, t.dispute.deadline, epoch));
      const forWinner = t.disputeVotes.filter((v) => v.payWinner).length;
      kv(
        d.body,
        "Votes so far",
        `${forWinner} to pay the winner · ${t.disputeVotes.length - forWinner} to refund the circle`,
        true,
      );
      if (t.dispute.resolvedForWinner !== null) {
        kv(
          d.body,
          "Outcome",
          t.dispute.resolvedForWinner
            ? "Resolved for the winner"
            : "Resolved for the circle",
        );
        if (t.dispute.rationaleHash) {
          kvNode(d.body, "Resolution rationale hash", hashSpan(t.dispute.rationaleHash));
          d.body.append(evidenceCheckControl(t.dispute.rationaleHash));
        }
      } else {
        d.body.append(
          notice(
            `The circle's approvers vote from the approvals screen. A resolution needs ${t.rules.disputeThreshold} votes for the same outcome with the same rationale, and the winning vote settles the tender or refunds the circle.`,
          ),
        );
      }
      wrap.append(d.box);
    }

    // actions
    const actions = box("actions");
    const act = actions.body;
    const needWallet = () => {
      if (!app.wallet.account) throw new Error("Connect your wallet first");
      return app.wallet.account;
    };
    const run = async (build: () => ReturnType<typeof B.buildCloseReveal>) => {
      const { outcome } = await app.submitAction(build());
      if (!settleOutcome(app, wrap, outcome)) return;
      go(`#/app/tender/${address}`);
    };
    const addBtn = (label: string, cls: string, fn: () => Promise<void>, fee?: FeeAction) => {
      const b = actionButton(label, cls, async () => {
        // Acting needs a wallet: the gate opens the connect
        // modal, and the action does not run until the visitor
        // connects and taps again.
        if (!requireWallet(app, label.toLowerCase())) return;
        try {
          await fn();
        } catch (e) {
          errorBox(wrap, e);
        }
      });
      b.classList.add("mt");
      act.append(b);
      if (fee) act.append(feeNote(fee));
    };
    if (t.state === "Draft" && t.bound) {
      addBtn("Lock the rules and fund the escrow", "btn-blue", async () =>
        run(() => B.buildLockAndFund(needWallet(), address, t.rules.budgetCap)),
      "lockAndFund");
    }
    if (t.state === "Reveal" && epoch && t.revealDeadline !== null && epoch > t.revealDeadline) {
      addBtn("Close the reveal window", "btn-blue", async () =>
        run(() => B.buildCloseReveal(address)),
      "closeReveal");
    }
    if (t.state === "Awarded" && epoch && t.overrideDeadline !== null && epoch > t.overrideDeadline) {
      addBtn("Advance to delivery", "btn-blue", async () =>
        run(() => B.buildAdvanceDelivery(address)),
      "advanceDelivery");
    }
    if (t.state === "AwaitingDelivery") {
      addBtn("confirm delivery (approvers)", "btn-blue", async () => {
        needWallet();
        return run(() => B.buildConfirmDelivery(address));
      }, "confirmDelivery");
      // The winner's dispute claim, offered only inside the
      // window the template enforces: delivery deadline passed,
      // claim grace still open, and the connected key is the
      // award's winner, the only signer the chain accepts.
      if (
        disputeWindowOpen(t.state, t.deliveryDeadline, t.claimDeadline, epoch) &&
        app.myKey &&
        t.award &&
        app.myKey === t.award.winner
      ) {
        const evidenceIn = textInput("mono");
        evidenceIn.placeholder = "SHA-256 of your evidence, 64 hex characters";
        act.append(
          field(
            "Claim a dispute: the delivery did not happen, or did not match what was bought",
            evidenceIn,
            "Only this hash goes on chain. Publish the evidence document where your circle can read it, so anyone can check it hashes to the value above. The circle then votes on the approvals screen.",
          ),
          hashFileControl(
            (hex) => {
              evidenceIn.value = hex;
            },
            (e) => errorBox(wrap, e),
          ),
        );
        addBtn("claim dispute (winner)", "btn-white", async () => {
          needWallet();
          const evidence = evidenceIn.value.trim().toLowerCase();
          if (!/^[0-9a-f]{64}$/.test(evidence))
            throw new Error("The evidence hash is not 64 hex characters");
          return run(() => B.buildClaimDispute(address, evidence));
        }, "claimDispute");
      }
      if (epoch && t.claimDeadline !== null && epoch > t.claimDeadline) {
        addBtn("Expire the tender", "btn-white", async () =>
          run(() => B.buildExpire(address)),
        "expire");
      }
    }
    if (t.state === "Settled" || t.state === "Expired") {
      // Offer only claims that can still succeed. Payment and
      // receipt exist only on a settled tender, and each closes
      // once claimed; on an expired tender both could only fail.
      // The bond claim stays on both states, and closes for a
      // seller whose own bond already came back.
      if (t.state === "Settled" && !t.payoutClaimed) {
        addBtn("claim payment (winner)", "btn-blue", async () =>
          run(() => B.buildClaimPayment(needWallet(), address)),
        "claimPayment");
      }
      if (t.state === "Settled" && !t.receiptIssued) {
        addBtn("claim receipt (winner)", "btn-white", async () =>
          run(() => B.buildClaimReceipt(needWallet(), address)),
        "claimReceipt");
      }
      const myCommitment = app.myKey
        ? t.commitments.find((c) => c.seller === app.myKey)
        : undefined;
      if (!myCommitment || myCommitment.bond !== "Returned") {
        addBtn("claim bond back", "btn-white", async () =>
          run(() => B.buildClaimBond(needWallet(), address)),
        "claimBond");
      }
    }
    if (!act.children.length) {
      if (t.state === "Open")
        act.append(el("div", "empty", "Bidding is open. Sellers commit their bids on the bid and reveal screen."));
      else if (t.state === "Reveal")
        act.append(el("div", "empty", "Reveals are open. Sellers reveal on the bid and reveal screen."));
      else if (t.state === "Disputed")
        act.append(el("div", "empty", "This tender is disputed. The circle's approvers resolve it from the approvals screen, and the outcome settles here."));
      else if (t.state === "Settled" || t.state === "Expired")
        act.append(el("div", "empty", "No action is open on this tender right now."));
    }
    if (t.state !== "Settled" && t.state !== "Expired") {
      const tenderApproversIn = el("textarea");
      tenderApproversIn.rows = t.approvers.length + 1;
      tenderApproversIn.className = "mono";
      tenderApproversIn.value = t.approvers.join("\n");
      act.append(
        field("Propose an approver change, the new approver keys, one per line", tenderApproversIn),
      );
      addBtn("propose approver change", "btn-white", async () => {
        const keys = tenderApproversIn.value
          .split(/[\s,]+/)
          .map((s) => s.trim().toLowerCase())
          .filter((s) => /^[0-9a-f]{64}$/.test(s));
        if (!keys.length) throw new Error("Add at least one approver key");
        await run(() => B.buildTenderApproverChange(address, keys));
      }, "proposeTenderApproverChange");
    }
    wrap.append(actions.box);

    // events
    const evBox = box("transactions");
    try {
      const events = await app.indexer.events(address);
      if (!events.length) {
        evBox.body.append(el("div", "empty", "No events recorded yet."));
      }
      const seen = new Set<string>();
      const byTopic = new Map<string, string[]>();
      for (const ev of events.slice(0, 40)) {
        const txId = ev.txId;
        const topic = ev.topic;
        if (!txId || seen.has(txId + topic)) continue;
        seen.add(txId + topic);
        const list = byTopic.get(topic) ?? [];
        list.push(txId);
        byTopic.set(topic, list);
      }
      const txRow = (topic: string, txId: string): HTMLElement => {
        const row = el("div", "commit-row");
        row.append(el("span", undefined, topic.replaceAll("_", " ")));
        row.append(el("span", "spacer"));
        // The transaction id itself is the record. It is shown
        // in full with a copy button, not hidden behind an
        // explorer link: the explorer's transaction pages read
        // the same indexers this app does, and for older
        // transactions those indexers no longer serve the
        // bodies, so the explorer page cannot load them. The
        // links below land on records that do load: this
        // tender's own page on the explorer, which reads the
        // component state the indexers still serve, and the
        // in-app checks for this tender.
        row.append(el("span", "hash", txId));
        const copyBtn = el("button", "btn btn-white btn-sm", "copy id");
        copyBtn.addEventListener("click", () => {
          void (async () => {
            try {
              await navigator.clipboard.writeText(txId);
              copyBtn.textContent = "copied";
            } catch {
              copyBtn.textContent = txId;
            }
          })();
        });
        row.append(copyBtn);
        return row;
      };
      for (const [topic, txIds] of byTopic) {
        if (txIds.length === 1) {
          evBox.body.append(txRow(topic, txIds[0]));
          continue;
        }
        // A repeated event type folds behind one line naming
        // the type and the count, so thirty near-identical
        // rows read as one line until opened. Every
        // transaction id stays listed, nothing is hidden
        // for good.
        const group = el("details", "tx-group");
        const summary = el("summary");
        summary.append(
          document.createTextNode(topic.replaceAll("_", " ")),
          el("span", "cnt", `${txIds.length} events`),
        );
        group.append(summary);
        for (const txId of txIds) group.append(txRow(topic, txId));
        evBox.body.append(group);
      }
      if (events.length) {
        const links = el("div", "srow mt");
        const onExplorer = explorerLink(app, "component", address);
        onExplorer.textContent = "This tender on the explorer";
        const verifyLink = el("a", undefined, "Run the checks on this tender");
        verifyLink.href = `#/app/verify/${address}`;
        verifyLink.className = "hash";
        links.append(onExplorer, verifyLink);
        evBox.body.append(links);
      }
    } catch {
      evBox.body.append(el("div", "empty", "The event feed could not be read right now."));
    }
    wrap.append(evBox.box);
  } catch (e) {
    errorBox(wrap, new Error(plainAddressError(address, e)));
  }
}
