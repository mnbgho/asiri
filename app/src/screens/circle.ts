// The circle view: members, approvers, treasury, its tenders,
// and the circle-level actions (funding, withdrawals, tender
// registration, collecting what finished tenders owe it).
import { App, el, errorBox, explorerLink, parseTari, setAria, short } from "../app";
import * as B from "../builders";
import { buildCircleRecord } from "../circle-record";
import { gatherCircleRecord } from "../circle-export";
import { withdrawalError } from "../model";
import { decodeCircleState, decodeVaultBalance } from "../state";
import type { Instruction } from "../wallet";
import { actionButton, box, downloadTextFile, feeNote, field, hashSpan, kv, kvNode, money, notice, settleOutcome, textInput } from "./common";

export async function renderCircle(
  app: App,
  root: HTMLElement,
  address: string,
  go: (hash: string) => void,
): Promise<void> {
  const wrap = el("div");
  root.append(wrap);
  try {
    const sub = await app.indexer.substate(address);
    if (!sub) throw new Error("this circle's substate is down");
    const c = decodeCircleState(sub.value);
    app.watch("circles", address);

    // Every circle action settles the same way: a chain failure
    // is shown here and stops the flow, an unconfirmed
    // submission leaves a note for the next screen.
    const act = async (instructions: Instruction[]): Promise<void> => {
      const { outcome } = await app.submitAction(instructions);
      if (!settleOutcome(app, wrap, outcome)) return;
      go(`#/app/circle/${address}`);
    };
    const showError = (e: unknown) => errorBox(wrap, e);

    const head = box(c.name, "buying circle");
    kv(head.body, "circle", address);
    kv(head.body, "template", c.template);
    kv(head.body, "approvers", `${c.approvers.length}, threshold ${c.threshold}`, true);
    if (c.auditor) kvNode(head.body, "auditor", hashSpan(c.auditor));
    for (const a of c.approvers) kvNode(head.body, "approver", hashSpan(a));
    wrap.append(head.box);

    const treasury = box("treasury");
    let treasuryBalance: bigint | null = null;
    try {
      const vsub = await app.indexer.substate(c.treasuryVault);
      if (vsub) {
        treasuryBalance = decodeVaultBalance(vsub.value);
        kv(treasury.body, "balance", money(treasuryBalance));
      }
    } catch {
      /* the balance row below reports the read as unreadable */
    }
    if (treasuryBalance === null)
      kv(treasury.body, "balance", "unreadable");
    const amountIn = textInput();
    amountIn.placeholder = "amount in tari";
    treasury.body.append(field("fund the treasury from your account", amountIn));
    const fundBtn = actionButton("deposit", "btn-blue", async () => {
      if (!app.wallet.account) throw new Error("connect your wallet first");
      await act(
        B.buildDepositTreasury(app.wallet.account, address, parseTari(amountIn.value)),
      );
    }, showError);
    treasury.body.append(fundBtn);
    wrap.append(treasury.box);

    const tenders = box("its tenders", `${c.tenders.length}`);
    if (!c.tenders.length)
      tenders.body.append(el("div", "empty", "no tenders yet. create one from start a circle or tender, then register it here."));
    for (const t of c.tenders) {
      const row = el("button", "trow");
      row.append(el("span", undefined, short(t)));
      row.append(el("span", "pill pill-tint", "open the record"));
      row.addEventListener("click", () => go(`#/app/tender/${t}`));
      tenders.body.append(row);
    }
    const regIn = textInput("mono");
    regIn.placeholder = "tender component_… to register";
    tenders.body.append(field("register a tender created for this circle", regIn));
    const regBtn = actionButton("register tender", "btn-white", async () => {
      await act(B.buildRegisterTender(address, regIn.value.trim()));
    }, showError);
    tenders.body.append(regBtn);
    wrap.append(tenders.box);

    const collect = box("collect from finished tenders");
    const colIn = textInput("mono");
    colIn.placeholder = "tender component_…";
    collect.body.append(field("tender to collect from", colIn));
    const row = el("div", "srow");
    row.append(
      actionButton("collect refund", "btn-white", async () => {
        await act(B.buildCollectRefund(address, colIn.value.trim()));
      }, showError),
      actionButton("collect forfeits", "btn-white", async () => {
        await act(B.buildCollectForfeits(address, colIn.value.trim()));
      }, showError),
    );
    collect.body.append(row);
    collect.body.append(
      feeNote("collectRefund", "collect refund"),
      feeNote("collectForfeits", "collect forfeits"),
    );
    wrap.append(collect.box);

    const gov = box("governance");
    if (!c.withdrawals.length && !c.approverChanges.length)
      gov.body.append(el("div", "empty", "no open proposals."));
    for (const w of c.withdrawals) {
      const row = el("div", "commit-row");
      row.append(el("span", undefined, `withdrawal ${w.id}: ${money(w.amount)} to ${short(w.to)}`));
      row.append(el("span", "spacer"));
      row.append(el("span", "pill pill-line", w.executed ? "executed" : w.isVoid ? "void" : `${w.signers.length} approvals`));
      gov.body.append(row);
    }
    for (const p of c.approverChanges) {
      const row = el("div", "commit-row");
      row.append(el("span", undefined, `approver change ${p.id}: ${p.newApprovers.length} approvers, threshold ${p.newThreshold}`));
      row.append(el("span", "spacer"));
      row.append(el("span", "pill pill-line", p.executed ? "executed" : p.isVoid ? "void" : `${p.signers.length} approvals`));
      gov.body.append(row);
    }
    if (treasuryBalance === null) {
      gov.body.append(
        notice(
          "the treasury balance could not be read, so a withdrawal cannot be proposed yet: the form cannot check the amount against what the treasury holds. read it again, and the form opens when the balance answers.",
        ),
      );
      const retryBtn = el("button", "btn btn-white btn-sm", "read the balance again");
      retryBtn.addEventListener("click", () => go(`#/app/circle/${address}`));
      gov.body.append(retryBtn);
    }
    const wdAmountIn = textInput();
    wdAmountIn.placeholder = "amount in tari";
    gov.body.append(field("propose a withdrawal, the amount", wdAmountIn));
    const wdToIn = textInput("mono");
    wdToIn.placeholder = "component_… to receive it";
    gov.body.append(
      field(
        "propose a withdrawal, the destination account",
        wdToIn,
        "an approver proposes. the other approvers approve it from the approvals screen, and it executes at the threshold, paid straight from the treasury to this account.",
      ),
    );
    const wdBtn = actionButton("propose withdrawal", "btn-white", async () => {
      if (!app.wallet.account) throw new Error("connect your wallet first");
      const amount = parseTari(wdAmountIn.value);
      const to = wdToIn.value.trim().toLowerCase();
      const err = withdrawalError(amount, to, treasuryBalance);
      if (err) throw new Error(err);
      await act(B.buildProposeWithdrawal(address, amount, to));
    }, showError);
    if (treasuryBalance === null) wdBtn.disabled = true;
    gov.body.append(wdBtn, feeNote("proposeWithdrawal"));
    const newApproversIn = el("textarea");
    newApproversIn.rows = c.approvers.length + 1;
    newApproversIn.className = "mono";
    newApproversIn.value = c.approvers.join("\n");
    gov.body.append(
      field("propose an approver change, the new approver keys, one per line", newApproversIn),
    );
    const newThresholdIn = textInput();
    newThresholdIn.value = String(c.threshold);
    gov.body.append(field("the new approval threshold", newThresholdIn));
    gov.body.append(
      actionButton("propose approver change", "btn-white", async () => {
        try {
          const keys = newApproversIn.value
            .split(/[\s,]+/)
            .map((s) => s.trim().toLowerCase())
            .filter((s) => /^[0-9a-f]{64}$/.test(s));
          if (!keys.length) throw new Error("add at least one approver key");
          const threshold = Number(newThresholdIn.value);
          if (!Number.isInteger(threshold) || threshold < 1 || threshold > keys.length)
            throw new Error("the threshold must sit between 1 and the number of approvers");
          const { outcome } = await app.submitAction(
            B.buildCircleApproverChange(address, keys, threshold),
          );
          if (!settleOutcome(app, wrap, outcome)) return;
          go(`#/app/circle/${address}`);
        } catch (e) {
          errorBox(wrap, e);
        }
      }),
    );
    kvNode(gov.body, "explorer", explorerLink(app, "component", address));
    wrap.append(gov.box);

    // The record export: one file with the circle's whole
    // record, gathered live at the moment of the export. Reads
    // only, no wallet needed. A tender that cannot be read is
    // carried in the file as unreadable with the reason, and a
    // tender whose checks cannot be computed says so: nothing
    // is dropped in silence (see circle-record.ts). The gather
    // is bounded and reports its progress, so the click always
    // ends (see circle-export.ts).
    const recordBox = box("the circle's record");
    recordBox.body.append(
      notice(
        "one file holding this circle's full record: its state and treasury, every tender's decoded state, and the verification summary for each tender, counting the same checks the verify screen runs. everything is read from the chain when you export, and the export reports what it is reading as it goes. it always finishes: a tender whose reads stall stands in the file as unreadable, with the reason, rather than holding the export open.",
      ),
    );
    const exportStatus = el("div", "small mt", "");
    setAria(exportStatus, "role", "status");
    const exportBtn = actionButton("export the record as a file", "btn-white", async () => {
      exportStatus.textContent = "reading the circle's record from the chain…";
      const gathered = await gatherCircleRecord(app.indexer, address, c, {
        onProgress: (message) => {
          exportStatus.textContent = message;
        },
      });
      const rec = buildCircleRecord(gathered.input);
      downloadTextFile(
        `asiri-circle-record-${address.slice(0, 22)}.json`,
        JSON.stringify(rec, null, 2),
      );
      const parts = ["the record was exported."];
      if (gathered.unreadable)
        parts.push(
          `${gathered.unreadable} of ${c.tenders.length} tenders could not be read and stand in the file as unreadable, with the reason.`,
        );
      if (gathered.unchecked)
        parts.push(
          `${gathered.unchecked} tenders carry no verification summary, because their checks could not be completed. the reason stands with each tender in the file.`,
        );
      exportStatus.textContent = parts.join(" ");
    }, showError);
    recordBox.body.append(exportBtn, exportStatus);
    wrap.append(recordBox.box);
  } catch (e) {
    errorBox(wrap, e);
  }
}
