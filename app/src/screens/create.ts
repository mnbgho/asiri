// Create: a new buying circle, and a new tender for a circle.
// The tender flow ends at the lock: create the tender, register
// it on the circle, then fund the escrow to the exact cap.
import { App, el, errorBox, parseTari, short, tari } from "../app";
import * as B from "../builders";
import { fundingGuidance } from "../funding";
import { feeNote } from "./common";
import { bytesToHex } from "../cbor";
import { sha256 } from "../hash";
import { thresholdError, type TenderRules } from "../model";
import { decodeCircleState, splitComponent } from "../state";
import { findNewComponents } from "../wallet";
import { actionButton, box, chainError, field, notice, requireWallet, textInput } from "./common";
import type { ActionOutcome } from "../finalize";

/**
 * Confirm the component a create transaction made: among the
 * unfamiliar addresses in the wallet's result, pick the one whose
 * on-chain template is the template just instantiated. The indexer
 * may lag the wallet by a few seconds, so retry briefly.
 */
async function findCreated(
  app: App,
  result: unknown,
  known: string[],
  template: string,
): Promise<string> {
  const candidates = findNewComponents(result, known);
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const addr of candidates) {
      const sub = await app.indexer.substate(addr).catch(() => null);
      if (sub && splitComponent(sub.value).template === template) return addr;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("the created component could not be confirmed on the indexer yet");
}

function keyList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[0-9a-f]{64}$/.test(s));
}

export async function renderCreate(
  app: App,
  root: HTMLElement,
  go: (hash: string) => void,
): Promise<void> {
  const wrap = el("div");
  root.append(wrap);
  const cfg = app.indexer.cfg;

  // ---------- circle ----------
  const cBox = box("new buying circle");
  if (!cfg.circleTemplate) {
    cBox.body.append(
      notice(
        `the circle template is not published on ${cfg.label} yet, so circles cannot be created here. the esmeralda testnet has it live.`,
      ),
    );
    const switchBtn = actionButton("switch to the esmeralda testnet", "btn-white", () => {
      app.setNetwork("esmeralda");
      go("#/app/create");
    });
    cBox.body.append(switchBtn);
  }
  const nameIn = textInput();
  nameIn.placeholder = "Uyo Shopkeepers Circle";
  const approversIn = el("textarea");
  approversIn.rows = 3;
  approversIn.className = "mono";
  approversIn.placeholder = "one public key per line, 64 hex characters each";
  if (app.myKey) approversIn.value = app.myKey;
  const thresholdIn = textInput();
  thresholdIn.value = "2";
  const auditorIn = textInput("mono");
  auditorIn.placeholder = "optional, 64 hex characters";
  // On a network with no circle template, the notice and the
  // switch are the whole box: the form does not render under
  // them, so nothing on the screen invites an action that can
  // only fail.
  if (cfg.circleTemplate) {
    cBox.body.append(
      field("circle name", nameIn),
      field("approvers", approversIn, "the people who confirm deliveries and sign overrides. each approver copies their public key from their own wallet card after connecting and sends it to you. your own key is filled in, keep it in the list if you will approve too."),
      field("approval threshold", thresholdIn, "how many approvers must sign. a threshold of 1 means any single approver can confirm a delivery or execute an override on their own. most circles want at least 2."),
      field("auditor (optional)", auditorIn, "a read-only overseer key, if the circle wants one."),
    );
  }
  const createCircleBtn = actionButton("create circle", "btn-blue", async () => {
    if (!cfg.circleTemplate) throw new Error("template not published on this network");
    const account = requireWallet(app, "create a circle");
    if (!account) return;
    const approvers = keyList(approversIn.value);
    if (!approvers.length) throw new Error("add at least one approver key");
    const threshold = Number(thresholdIn.value);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > approvers.length)
      throw new Error("the threshold must be between 1 and the approver count");
    const auditor = auditorIn.value.trim().toLowerCase() || null;
    if (auditor && !/^[0-9a-f]{64}$/.test(auditor))
      throw new Error("the auditor key is not 64 hex characters");
    await app.guardWalletNetwork();
    const { result } = await app.wallet.submit(
      B.buildCreateCircle(cfg.circleTemplate, nameIn.value.trim(), approvers, threshold, auditor, cfg.tenderTemplate),
    );
    const addr = await findCreated(app, result, [account], cfg.circleTemplate);
    app.watch("circles", addr);
    await app.deriveIdentity();
    go(`#/app/circle/${addr}`);
  }, (e) => errorBox(wrap, e));
  if (cfg.circleTemplate) cBox.body.append(createCircleBtn, feeNote("createCircle"));
  wrap.append(cBox.box);

  // ---------- tender ----------
  const tBox = box("new tender");
  if (!cfg.tenderTemplate) {
    tBox.body.append(
      notice(`the tender template is not published on ${cfg.label} yet. the esmeralda testnet has it live.`),
    );
    const switchBtn2 = actionButton("switch to the esmeralda testnet", "btn-white", () => {
      app.setNetwork("esmeralda");
      go("#/app/create");
    });
    tBox.body.append(switchBtn2);
  }
  // The form renders into its own container, appended only
  // when the tender template is published here: on an
  // unconfigured network the notice and the switch above are
  // the whole box, as with the circle form.
  const tForm = el("div");
  tForm.append(
    notice(
      "costs, in plain words: creating and locking costs a small fee each time. the escrow is funded with exactly the budget cap from your account, and every seller needs the bond amount in theirs before they can bid.",
    ),
  );
  tForm.append(notice(fundingGuidance(app.network)));
  const circleIn = textInput("mono");
  circleIn.placeholder = "component_…";
  // Circles this browser can offer by name instead of a paste:
  // the featured circle and every watched circle, read best
  // effort with a short leash (a stalled read leaves the short
  // address as the label, and pasting the address below works
  // either way). Picking one fills the address field.
  const knownCircles: { address: string; label: string }[] = [];
  if (cfg.tenderTemplate) {
    const candidates = new Set<string>([
      ...(cfg.featuredCircle ? [cfg.featuredCircle] : []),
      ...app.watched().circles,
    ]);
    for (const addr of candidates) {
      let label = short(addr);
      try {
        const sub = await Promise.race([
          app.indexer.substate(addr),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        if (sub) label = `${decodeCircleState(sub.value).name} · ${short(addr)}`;
      } catch {
        /* the short address stands as the label */
      }
      knownCircles.push({ address: addr, label });
    }
  }
  const circlePick = el("select");
  const pickDefault = el("option", undefined, "choose a circle this browser knows, or paste the address below");
  pickDefault.value = "";
  circlePick.append(pickDefault);
  for (const kc of knownCircles) {
    const o = el("option", undefined, kc.label);
    o.value = kc.address;
    circlePick.append(o);
  }
  circlePick.addEventListener("change", () => {
    if (circlePick.value) circleIn.value = circlePick.value;
  });
  const specFile = el("input");
  specFile.type = "file";
  const specIn = textInput("mono");
  specIn.placeholder = "or paste the hash, 64 hex characters";
  const capIn = textInput();
  capIn.placeholder = "10000";
  const bondIn = textInput();
  bondIn.placeholder = "100";
  const win = (label: string, value: string, hint: string) => {
    const i = textInput();
    i.value = value;
    return { node: field(label, i, hint), input: i };
  };
  const bidW = win("bid window (epochs)", "24", "how long sellers can commit. an esmeralda epoch is about an hour, a mainnet epoch about twenty minutes.");
  const revealW = win("reveal window (epochs)", "24", "how long sellers can reveal after bids close.");
  const overrideW = win("override window (epochs)", "12", "how long the circle can replace the computed winner, with a published reason.");
  const deliveryW = win("delivery window (epochs)", "48", "how long the winner has to deliver.");
  const graceW = win("claim grace (epochs)", "24", "extra time after delivery for claims before the tender can expire.");
  const disputeW = win("dispute window (epochs)", "24", "how long a delivery dispute can be resolved.");
  const apprIn = textInput();
  apprIn.value = "2";
  const dispIn = textInput();
  dispIn.value = "3";
  tForm.append(
    ...(knownCircles.length
      ? [field("circle, from this browser", circlePick, "the featured circle and the circles this browser has opened. choosing one fills the address below.")]
      : []),
    field("circle", circleIn, "the tender is created for this circle and registered on it in the next step."),
    field("specification document", specFile, "the document that says exactly what is being bought. its sha-256 hash is locked into the rules. the document itself stays with the circle."),
    field("specification hash", specIn),
    field("budget cap (tari)", capIn, "the escrow is funded with exactly this much. it is the most the tender can pay."),
    field("bond per bid (tari)", bondIn, "every seller posts this with their commitment. revealing returns it. staying silent forfeits it, half to the circle and half locked forever. if the tender expires with no award, an unrevealed bond returns whole instead."),
    bidW.node, revealW.node, overrideW.node, deliveryW.node, graceW.node, disputeW.node,
    field("approval threshold", apprIn, "approver signatures needed to confirm delivery or execute an override. a threshold of 1 gives a single approver full power. choose with care."),
    field("dispute threshold", dispIn, "approver signatures needed to resolve a dispute. must be higher than the approval threshold and no higher than the circle's number of approvers."),
  );
  specFile.addEventListener("change", () => {
    void (async () => {
      const file = specFile.files?.[0];
      if (!file) return;
      const digest = await sha256(new Uint8Array(await file.arrayBuffer()));
      specIn.value = bytesToHex(digest);
    })();
  });

  const status = el("div");
  // A step that failed on chain stops the flow where it
  // stands, with the chain's reason shown and nothing further
  // submitted. An unconfirmed step does not stop the flow: the
  // next step's own confirmation catches a step that never
  // landed, and the last step leaves its note for the tender
  // page instead.
  const stepFailed = (outcome: ActionOutcome, step: string): boolean => {
    if (outcome.kind !== "failed") return false;
    chainError(app, wrap, outcome);
    status.textContent = `${step} failed on chain. nothing further was submitted.`;
    return true;
  };
  const createTenderBtn = actionButton("create tender, register it, and lock the escrow", "btn-blue", async () => {
    if (!cfg.tenderTemplate) throw new Error("template not published on this network");
    const account = requireWallet(app, "create a tender, register it, and lock the escrow");
    if (!account) return;
    const circle = circleIn.value.trim();
    if (!circle.startsWith("component_")) throw new Error("enter the circle address");
    const sub = await app.indexer.substate(circle);
    if (!sub) throw new Error("that circle is down");
    const circleState = decodeCircleState(sub.value);
    const spec = specIn.value.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(spec)) throw new Error("the specification hash is not 64 hex characters");
    const rules: TenderRules = {
      specificationHash: spec,
      budgetCap: parseTari(capIn.value),
      bondAmount: parseTari(bondIn.value),
      bidWindowEpochs: Number(bidW.input.value),
      revealWindowEpochs: Number(revealW.input.value),
      overrideWindowEpochs: Number(overrideW.input.value),
      deliveryWindowEpochs: Number(deliveryW.input.value),
      claimGraceEpochs: Number(graceW.input.value),
      disputeWindowEpochs: Number(disputeW.input.value),
      approvalThreshold: Number(apprIn.value),
      disputeThreshold: Number(dispIn.value),
    };
    const tErr = thresholdError(
      rules.approvalThreshold,
      rules.disputeThreshold,
      circleState.approvers.length,
    );
    if (tErr) throw new Error(tErr);
    // The balance pre-check, before anything is submitted:
    // the lock funds the escrow with the full cap from this
    // account, so an account short of the cap would otherwise
    // learn at step 3 of 3, after two approved transactions.
    // A balance that cannot be read blocks nothing: the
    // wallet and the chain still check, and their word is
    // final.
    await app.deriveIdentity();
    if (app.balance !== null && app.balance < rules.budgetCap)
      throw new Error(
        `your account holds ${tari(app.balance)} tari, and locking this tender funds the escrow with the full budget cap of ${tari(rules.budgetCap)} tari, before fees. nothing was submitted. top up the account, or lower the cap.`,
      );
    status.textContent = "step 1 of 3: creating the tender. approve it in your wallet.";
    await app.guardWalletNetwork();
    const created = await app.wallet.submit(B.buildCreateTender(cfg.tenderTemplate, circle, rules));
    const tender = await findCreated(app, created.result, [account, circle], cfg.tenderTemplate);
    app.watch("tenders", tender);
    status.textContent = "step 2 of 3: registering the tender on its circle. approve it in your wallet.";
    const reg = await app.submitAction(B.buildRegisterTender(circle, tender));
    if (stepFailed(reg.outcome, "step 2 of 3: registering the tender")) return;
    status.textContent = "step 3 of 3: locking the rules and funding the escrow to the cap. approve it in your wallet.";
    const lock = await app.submitAction(
      B.buildLockAndFund(account, tender, rules.budgetCap),
    );
    if (stepFailed(lock.outcome, "step 3 of 3: locking the tender")) return;
    if (lock.outcome.kind === "unconfirmed") {
      app.flash = {
        text: "your tender was created and its lock was submitted, awaiting finalization. this page may not show the locked rules yet.",
        txId: lock.outcome.txId,
      };
    }
    go(`#/app/tender/${tender}`);
  }, (e) => errorBox(wrap, e));
  tForm.append(
    createTenderBtn,
    feeNote("createTender", "create tender"),
    feeNote("registerTender", "register tender"),
    feeNote("lockAndFund", "lock and fund"),
    status,
  );
  tForm.append(
    notice(
      "locking is the point of no return for the rules. after the lock transaction, the rules hash is fixed and the escrow holds exactly the cap, and anyone can check both from the tender record.",
    ),
  );
  if (cfg.tenderTemplate) tBox.body.append(tForm);
  wrap.append(tBox.box);
}
