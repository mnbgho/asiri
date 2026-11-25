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
    if (!sub) throw new Error("this tender's substate is down");
    const t = decodeTenderState(sub.value);
    app.watch("tenders", address);
    let epoch = 0;
    try {
      epoch = await app.indexer.epoch();
    } catch {
      /* deadlines still render */
    }

    const head = box(t.circleName || "sealed tender", `${t.state.toLowerCase()} · epoch ${epoch || "?"}`);
    kv(head.body, "tender", address);
    kvNode(head.body, "circle", explorerLink(app, "component", t.circle));
    kv(head.body, "bound to its circle", t.bound ? "yes" : "not yet");
    kv(head.body, "template", t.template);
    wrap.append(head.box);

    const rules = box("locked rules", t.rulesHash ? "hash locked at funding" : "not locked yet");
    kv(rules.body, "what is being bought", "specification " + short(t.rules.specificationHash));
    kvNode(rules.body, "specification hash", hashSpan(t.rules.specificationHash));
    kv(rules.body, "budget cap", money(t.rules.budgetCap));
    kv(rules.body, "bond per bid", money(t.rules.bondAmount));
    kv(
      rules.body,
      "windows in epochs",
      `bid ${t.rules.bidWindowEpochs} · reveal ${t.rules.revealWindowEpochs} · override ${t.rules.overrideWindowEpochs} · delivery ${t.rules.deliveryWindowEpochs} · claim grace ${t.rules.claimGraceEpochs} · dispute ${t.rules.disputeWindowEpochs}`,
      true,
    );
    kv(
      rules.body,
      "approval thresholds",
      `${t.rules.approvalThreshold} of ${t.approvers.length} approvers · disputes need ${t.rules.disputeThreshold}`,
      true,
    );
    if (t.rulesHash) kvNode(rules.body, "rules hash", hashSpan(t.rulesHash));
    wrap.append(rules.box);

    const moneyBox = box("money");
    try {
      const escrowSub = await app.indexer.substate(t.escrowVault);
      if (escrowSub)
        kv(moneyBox.body, "escrow now", money(decodeVaultBalance(escrowSub.value)));
    } catch {
      kv(moneyBox.body, "escrow now", "unreadable");
    }
    try {
      const bondsSub = await app.indexer.substate(t.bondsVault);
      if (bondsSub)
        kv(moneyBox.body, "bonds held now", money(decodeVaultBalance(bondsSub.value)));
    } catch {
      kv(moneyBox.body, "bonds held now", "unreadable");
    }
    if (t.forfeitLocked > 0n)
      kv(moneyBox.body, "forfeited, locked forever", money(t.forfeitLocked));
    if (t.forfeitForCircle > 0n)
      kv(moneyBox.body, "forfeited, owed to the circle", money(t.forfeitForCircle));
    if (t.settlement)
      kv(
        moneyBox.body,
        "settled",
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
    line("delivery by", t.deliveryDeadline, true);
    line("claims close", t.claimDeadline, true);
    if (!timeline.body.children.length)
      timeline.body.append(el("div", "empty", "not locked yet. the timeline appears when the circle funds the escrow."));
    wrap.append(timeline.box);

    const bids = box("bids", `${t.commitments.length} committed · ${t.reveals.length} revealed`);
    if (!t.commitments.length) {
      bids.body.append(el("div", "empty", "no bids committed yet. a committed bid is a hash: the price stays sealed until its owner reveals it."));
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
            ? `revealed at ${tari(reveal.price)} tari`
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
      kv(a.body, "winning price", money(t.award.winningPrice));
      kvNode(a.body, "winning commitment", hashSpan(t.award.winningCommitment));
      kvNode(a.body, "winner payment identity", hashSpan(t.award.winner));
      wrap.append(a.box);
    }
    wrap.append(bids.box);

    if (t.overrideRecord) {
      const o = box("override", "the circle replaced the computed award");
      kvNode(o.body, "chosen seller", t.overrideRecord.chosen ? hashSpan(t.overrideRecord.chosen) : el("span", undefined, "none, the tender was cancelled"));
      kvNode(o.body, "rationale hash", hashSpan(t.overrideRecord.rationaleHash));
      o.body.append(evidenceCheckControl(t.overrideRecord.rationaleHash));
      kv(o.body, "executed at epoch", String(t.overrideRecord.epoch), true);
      o.body.append(
        notice(
          "the rationale text itself is published by the circle off chain. on the verify page, anyone can check that the published text hashes to the value above.",
        ),
      );
      wrap.append(o.box);
    }

    if (t.dispute) {
      const d = box(
        "dispute",
        t.dispute.resolvedForWinner === null
          ? "waiting for the circle to resolve it"
          : "resolved",
      );
      kvNode(d.body, "evidence hash", hashSpan(t.dispute.evidenceHash));
      d.body.append(evidenceCheckControl(t.dispute.evidenceHash));
      kv(d.body, "filed at epoch", String(t.dispute.epoch), true);
      kvNode(d.body, "votes close", deadlineSpan(app.network, t.dispute.deadline, epoch));
      const forWinner = t.disputeVotes.filter((v) => v.payWinner).length;
      kv(
        d.body,
        "votes so far",
        `${forWinner} to pay the winner · ${t.disputeVotes.length - forWinner} to refund the circle`,
        true,
      );
      if (t.dispute.resolvedForWinner !== null) {
        kv(
          d.body,
          "outcome",
          t.dispute.resolvedForWinner
            ? "resolved for the winner"
            : "resolved for the circle",
        );
        if (t.dispute.rationaleHash) {
          kvNode(d.body, "resolution rationale hash", hashSpan(t.dispute.rationaleHash));
          d.body.append(evidenceCheckControl(t.dispute.rationaleHash));
        }
      } else {
        d.body.append(
          notice(
            `the circle's approvers vote from the approvals screen. a resolution needs ${t.rules.disputeThreshold} votes for the same outcome with the same rationale, and the winning vote settles the tender or refunds the circle.`,
          ),
        );
      }
      wrap.append(d.box);
    }

    // actions
    const actions = box("actions");
    const act = actions.body;
    const needWallet = () => {
      if (!app.wallet.account) throw new Error("connect your wallet first");
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
      addBtn("lock the rules and fund the escrow", "btn-blue", async () =>
        run(() => B.buildLockAndFund(needWallet(), address, t.rules.budgetCap)),
      "lockAndFund");
    }
    if (t.state === "Reveal" && epoch && t.revealDeadline !== null && epoch > t.revealDeadline) {
      addBtn("close the reveal window", "btn-blue", async () =>
        run(() => B.buildCloseReveal(address)),
      "closeReveal");
    }
    if (t.state === "Awarded" && epoch && t.overrideDeadline !== null && epoch > t.overrideDeadline) {
      addBtn("advance to delivery", "btn-blue", async () =>
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
        evidenceIn.placeholder = "sha-256 of your evidence, 64 hex characters";
        act.append(
          field(
            "claim a dispute: the delivery did not happen, or did not match what was bought",
            evidenceIn,
            "only this hash goes on chain. publish the evidence document where your circle can read it, so anyone can check it hashes to the value above. the circle then votes on the approvals screen.",
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
            throw new Error("the evidence hash is not 64 hex characters");
          return run(() => B.buildClaimDispute(address, evidence));
        }, "claimDispute");
      }
      if (epoch && t.claimDeadline !== null && epoch > t.claimDeadline) {
        addBtn("expire the tender", "btn-white", async () =>
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
        act.append(el("div", "empty", "bidding is open. sellers commit their bids on the bid and reveal screen."));
      else if (t.state === "Reveal")
        act.append(el("div", "empty", "reveals are open. sellers reveal on the bid and reveal screen."));
      else if (t.state === "Disputed")
        act.append(el("div", "empty", "this tender is disputed. the circle's approvers resolve it from the approvals screen, and the outcome settles here."));
      else if (t.state === "Settled" || t.state === "Expired")
        act.append(el("div", "empty", "no action is open on this tender right now."));
    }
    if (t.state !== "Settled" && t.state !== "Expired") {
      const tenderApproversIn = el("textarea");
      tenderApproversIn.rows = t.approvers.length + 1;
      tenderApproversIn.className = "mono";
      tenderApproversIn.value = t.approvers.join("\n");
      act.append(
        field("propose an approver change, the new approver keys, one per line", tenderApproversIn),
      );
      addBtn("propose approver change", "btn-white", async () => {
        const keys = tenderApproversIn.value
          .split(/[\s,]+/)
          .map((s) => s.trim().toLowerCase())
          .filter((s) => /^[0-9a-f]{64}$/.test(s));
        if (!keys.length) throw new Error("add at least one approver key");
        await run(() => B.buildTenderApproverChange(address, keys));
      }, "proposeTenderApproverChange");
    }
    wrap.append(actions.box);

    // events
    const evBox = box("transactions");
    try {
      const events = await app.indexer.events(address);
      if (!events.length) {
        evBox.body.append(el("div", "empty", "no events recorded yet."));
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
        onExplorer.textContent = "this tender on the explorer";
        const verifyLink = el("a", undefined, "run the checks on this tender");
        verifyLink.href = `#/app/verify/${address}`;
        verifyLink.className = "hash";
        links.append(onExplorer, verifyLink);
        evBox.body.append(links);
      }
    } catch {
      evBox.body.append(el("div", "empty", "the event feed could not be read right now."));
    }
    wrap.append(evBox.box);
  } catch (e) {
    errorBox(wrap, new Error(plainAddressError(address, e)));
  }
}
