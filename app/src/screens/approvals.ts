// Approvals: what is waiting for the connected approver across
// the circles and tenders this browser can see: override proposals to sign,
// deliveries to confirm, disputes to resolve, withdrawals and
// approver changes to approve.
import { App, el, errorBox } from "../app";
import * as B from "../builders";
import { bytesToHex } from "../cbor";
import { readDiscoveryCache } from "../discovery";
import { sha256 } from "../hash";
import { INBOX_SCOPE_NOTE, personalItems } from "../inbox";
import {
  decodeCircleState,
  decodeTenderState,
  type CircleComponentState,
  type TenderComponentState,
} from "../state";
import { savedBids } from "./seller";
import { actionButton, box, feeNote, field, hashSpan, kvNode, money, notice, settleOutcome, textInput } from "./common";
import { evidenceCheckControl } from "./evidence-ui";

export async function renderApprovals(
  app: App,
  root: HTMLElement,
  go: (hash: string) => void,
): Promise<void> {
  const wrap = el("div");
  root.append(wrap);

  const keyBox = box("your approver key");
  const keyIn = textInput("mono");
  keyIn.placeholder = "your public key, 64 hex characters";
  if (app.myKey) keyIn.value = app.myKey;
  keyBox.body.append(
    field(
      "public key",
      keyIn,
      "used only to find the items waiting for you. the templates check your wallet's signature, not this field.",
    ),
  );
  const showError = (e: unknown) => errorBox(wrap, e);
  const saveBtn = actionButton("save key", "btn-white", () => {
    const v = keyIn.value.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(v)) throw new Error("that is not 64 hex characters");
    app.setMyKey(v);
    go("#/app/approvals");
  }, showError);
  keyBox.body.append(saveBtn);
  wrap.append(keyBox.box);

  // The personal inbox: what needs the connected key as a
  // seller or a winner, gathered by inbox.ts from the same
  // records the approver list below reads. Its scope note
  // stands on the screen, because the gathering reaches only
  // what this browser can see.
  const inbox = box("needs you now");
  inbox.body.append(el("div", "empty", "reading the circles and tenders this browser can see…"));
  wrap.append(inbox.box);

  const list = box("waiting for you");
  list.body.append(el("div", "empty", "reading the circles and tenders this browser can see…"));
  wrap.append(list.box);

  const me = app.myKey;
  const items: HTMLElement[] = [];
  const watched = app.watched();
  // The gathered set is the overview's: the featured circle,
  // what this browser has watched, and what network discovery
  // has found in this browser. Discovery itself runs from the
  // overview, so this screen opens no streams of its own.
  const discovered = readDiscoveryCache(app.network);
  const circles = new Set<string>([
    ...(app.indexer.cfg.featuredCircle ? [app.indexer.cfg.featuredCircle] : []),
    ...watched.circles,
    ...(discovered?.circles ?? []),
  ]);
  const myBids = savedBids();
  const tenders = new Set<string>([
    ...watched.tenders,
    ...myBids.map((b) => b.tender),
    ...(discovered?.tenders ?? []),
  ]);
  const circleStates = new Map<string, CircleComponentState>();
  const tenderStates = new Map<string, TenderComponentState>();
  let epoch = 0;
  try {
    epoch = await app.indexer.epoch();
  } catch {
    /* the inbox still lists its items, with epochs alone */
  }

  const run = async (build: () => Parameters<App["wallet"]["submit"]>[0], dest: string) => {
    const { outcome } = await app.submitAction(build());
    if (!settleOutcome(app, wrap, outcome)) return;
    go(dest);
  };

  for (const cAddr of circles) {
    try {
      const sub = await app.indexer.substate(cAddr);
      if (!sub) continue;
      const c = decodeCircleState(sub.value);
      circleStates.set(cAddr, c);
      for (const t of c.tenders) tenders.add(t);
      if (!me || !c.approvers.includes(me)) continue;
      for (const w of c.withdrawals) {
        if (w.executed || w.isVoid || w.signers.includes(me)) continue;
        const item = el("div", "commit-row");
        item.append(el("span", undefined, `${c.name}: withdrawal ${w.id} of ${money(w.amount)}, ${w.signers.length} of ${c.threshold} approvals`));
        item.append(el("span", "spacer"));
        item.append(
          actionButton("approve", "btn-blue btn-sm", async () =>
            run(() => B.buildApproveWithdrawal(cAddr, w.id), `#/app/circle/${cAddr}`),
          showError),
        );
        items.push(item);
      }
      for (const p of c.approverChanges) {
        if (p.executed || p.isVoid || p.signers.includes(me)) continue;
        const item = el("div", "commit-row");
        item.append(el("span", undefined, `${c.name}: approver change ${p.id} to ${p.newApprovers.length} approvers at threshold ${p.newThreshold}, ${p.signers.length} approvals so far`));
        item.append(el("span", "spacer"));
        item.append(
          actionButton("approve", "btn-blue btn-sm", async () =>
            run(() => B.buildCircleApproveApproverChange(cAddr, p.id), `#/app/circle/${cAddr}`),
          showError),
        );
        items.push(item);
      }
    } catch {
      /* unreadable circles contribute nothing */
    }
  }

  for (const tAddr of tenders) {
    try {
      const sub = await app.indexer.substate(tAddr);
      if (!sub) continue;
      const t = decodeTenderState(sub.value);
      tenderStates.set(tAddr, t);
      const mine = me !== null && t.approvers.includes(me);
      if (mine) {
        for (const p of t.approverChanges) {
          if (p.executed || p.isVoid || p.signers.includes(me)) continue;
          const item = el("div", "commit-row");
          item.append(el("span", undefined, `${t.circleName}: approver change ${p.id} to ${p.newApprovers.length} approvers, ${p.signers.length} of ${t.rules.approvalThreshold} approvals so far`));
          item.append(el("span", "spacer"));
          item.append(
            actionButton("approve", "btn-blue btn-sm", async () =>
              run(() => B.buildTenderApproveApproverChange(tAddr, p.id), `#/app/tender/${tAddr}`),
            showError),
          );
          items.push(item, feeNote("approveTenderApproverChange"));
        }
      }
      if (t.state === "Awarded" && mine) {
        for (const p of t.overrideProposals) {
          if (p.executed || p.isVoid || p.signers.includes(me)) continue;
          const item = el("div", "commit-row");
          item.append(el("span", undefined, `${t.circleName}: override ${p.id}, ${p.signers.length} of ${t.rules.approvalThreshold} signatures`));
          item.append(el("span", "spacer"));
          item.append(
            actionButton("sign override", "btn-blue btn-sm", async () =>
              run(() => B.buildSignOverride(tAddr, p.id), `#/app/tender/${tAddr}`),
            showError),
          );
          items.push(item, feeNote("signOverride"));
        }
        const oBox = box(`propose an override on ${t.circleName || "this tender"}`);
        const chosenIn = textInput("mono");
        chosenIn.placeholder = "winner's payment identity, or blank to cancel the tender";
        const rationaleIn = el("textarea");
        rationaleIn.rows = 3;
        rationaleIn.placeholder = "why the computed winner should not win. only its hash goes on chain, so publish this exact text where your circle can read it, or nobody can check the reason.";
        oBox.body.append(
          field("chosen seller", chosenIn),
          field("rationale", rationaleIn, "the hash of this exact text is recorded. anyone with the text can prove it matches."),
        );
        const propBtn = actionButton("propose override", "btn-white", async () => {
          const chosen = chosenIn.value.trim().toLowerCase() || null;
          if (chosen && !/^[0-9a-f]{64}$/.test(chosen))
            throw new Error("the chosen seller is not 64 hex characters");
          if (!rationaleIn.value) throw new Error("an override needs a rationale");
          const digest = bytesToHex(
            await sha256(new TextEncoder().encode(rationaleIn.value)),
          );
          await run(
            () => B.buildProposeOverride(tAddr, chosen, digest),
            `#/app/tender/${tAddr}`,
          );
        }, showError);
        oBox.body.append(propBtn, feeNote("proposeOverride"));
        wrap.append(oBox.box);
      }
      if (t.state === "AwaitingDelivery" && mine && !t.deliverySigners.includes(me)) {
        const item = el("div", "commit-row");
        item.append(el("span", undefined, `${t.circleName}: delivery confirmation, ${t.deliverySigners.length} of ${t.rules.approvalThreshold} so far`));
        item.append(el("span", "spacer"));
        item.append(
          actionButton("confirm delivery", "btn-blue btn-sm", async () =>
            run(() => B.buildConfirmDelivery(tAddr), `#/app/tender/${tAddr}`),
          showError),
        );
        items.push(item, feeNote("confirmDelivery"));
      }
      if (t.state === "Disputed" && mine && t.dispute) {
        const dBox = box(`resolve the dispute on ${t.circleName || "this tender"}`);
        kvNode(dBox.body, "evidence hash", hashSpan(t.dispute.evidenceHash));
        dBox.body.append(evidenceCheckControl(t.dispute.evidenceHash));
        const votes = t.disputeVotes.filter((v) => v.signer === me);
        if (!votes.length) {
          const rationaleIn = el("textarea");
          rationaleIn.rows = 2;
          rationaleIn.placeholder = "why the dispute resolves this way. only its hash goes on chain, so publish this exact text where your circle can read it.";
          dBox.body.append(field("rationale", rationaleIn));
          const row = el("div", "srow");
          const decide = async (payWinner: boolean) => {
            if (!rationaleIn.value) throw new Error("a resolution needs a rationale");
            const digest = bytesToHex(
              await sha256(new TextEncoder().encode(rationaleIn.value)),
            );
            await run(
              () => B.buildResolveDispute(tAddr, payWinner, digest),
              `#/app/tender/${tAddr}`,
            );
          };
          row.append(
            actionButton("pay the winner", "btn-blue", () => decide(true), showError),
            actionButton("refund the circle", "btn-white", () => decide(false), showError),
          );
          dBox.body.append(row, feeNote("resolveDispute"));
        } else {
          dBox.body.append(notice("you have already voted on this dispute."));
        }
        wrap.append(dBox.box);
      }
    } catch {
      /* unreadable tenders contribute nothing */
    }
  }

  // Fill the inbox from the records just read. The scope note
  // stays under the rows: it bounds what an empty inbox means.
  const personal = personalItems({
    me,
    bids: myBids,
    tenders: tenderStates,
    circles: circleStates,
    network: app.network,
    epoch,
  });
  inbox.body.replaceChildren();
  if (!personal.length) {
    inbox.body.append(
      el(
        "div",
        "empty",
        me
          ? "nothing needs you as a seller or a winner on the circles and tenders this browser can see."
          : "save your key above, or commit a bid from bid and reveal, and this list gathers what needs you: reveals due, claims open, bonds back, refunds to collect.",
      ),
    );
  } else {
    for (const item of personal) {
      const row = el("div", "commit-row");
      const text = el("span", undefined, `${item.title}. ${item.detail}`);
      const open = el("button", "btn btn-blue btn-sm", "open");
      open.addEventListener("click", () => go(item.dest));
      row.append(text, el("span", "spacer"), open);
      inbox.body.append(row);
    }
  }
  inbox.body.append(notice(INBOX_SCOPE_NOTE));

  list.body.replaceChildren();
  if (!me) {
    list.body.append(
      el("div", "empty", "save your approver key above and this screen gathers everything waiting for your signature."),
    );
  } else if (!items.length) {
    list.body.append(
      el("div", "empty", "nothing is waiting for your signature on the circles and tenders this browser can see."),
    );
  } else {
    for (const item of items) list.body.append(item);
  }
}
