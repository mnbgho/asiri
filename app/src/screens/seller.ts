// Bid and reveal: commit a sealed bid, then come back and
// reveal it. The salt is generated here, shown once, and kept
// only in this browser. Losing it forfeits the bond: the bid
// can never be revealed without it.
import { App, el, errorBox, parseTari, setAria } from "../app";
import * as B from "../builders";
import {
  decryptBidsFile,
  encryptBids,
  isEncryptedBackup,
  parseBidsFile,
  serializeBids,
} from "../backup";
import { bytesToHex, hexToBytes } from "../cbor";
import { commitmentHash } from "../hash";
import { decodeTenderState, plainAddressError, type TenderComponentState } from "../state";
import { deadlineText, revealWindowText } from "../time";
import { actionButton, box, downloadTextFile, feeNote, field, kv, money, notice, requireWallet, settleOutcome, textInput } from "./common";

export interface SavedBid {
  tender: string;
  price: string; // µT as a decimal string
  saltHex: string;
  identity: string;
  commitment: string;
}

const KEY = "asiri:bids";

export function savedBids(): SavedBid[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as SavedBid[];
  } catch {
    return [];
  }
}

/**
 * A tender substate read whose failures are reported in plain
 * language: the indexer read itself can reject (an outage, a
 * stalled read, an undecodable body), and that rejection must
 * not reach the user as raw indexer or decoder wording.
 */
async function readSubstatePlain(app: App, tenderAddr: string) {
  try {
    return await app.indexer.substate(tenderAddr);
  } catch (e) {
    throw new Error(plainAddressError(tenderAddr, e));
  }
}

/**
 * The checks a reveal must pass before the wallet opens, in
 * the commit flow's style: a connected wallet, a tender that
 * exists on this network, the tender in a state that can
 * reveal, and the current epoch inside the reveal window.
 * The template accepts a reveal while the tender is Open or
 * Reveal, from the bid deadline up to the reveal deadline,
 * and only a reveal flips Open to Reveal. The checks match
 * it exactly, so the first reveal can happen from this
 * screen instead of nowhere. Without these checks the first
 * sign of a problem was a chain rejection after signing.
 */
export async function checkRevealable(app: App, tenderAddr: string): Promise<void> {
  if (!app.wallet.account) throw new Error("Connect your wallet first");
  const sub = await readSubstatePlain(app, tenderAddr);
  if (!sub)
    throw new Error(plainAddressError(tenderAddr, new Error("That component is down")));
  let t: TenderComponentState;
  try {
    t = decodeTenderState(sub.value);
  } catch (e) {
    throw new Error(plainAddressError(tenderAddr, e));
  }
  if (t.state !== "Open" && t.state !== "Reveal")
    throw new Error(
      `This tender is ${t.state.toLowerCase()}, not in its reveal window. A bid can only be revealed while the tender is in its open or reveal state.`,
    );
  // The window is read from the chain's own clock. A failed
  // epoch read refuses the submit instead of guessing: the
  // seller is told plainly, and no fee is spent on a reveal
  // the chain would reject.
  if (t.bidDeadline !== null || t.revealDeadline !== null) {
    let epoch: number;
    try {
      epoch = await app.indexer.epoch();
    } catch {
      throw new Error(
        "The current epoch could not be read, so the reveal window cannot be checked. The reveal was not submitted. Try again when the network answers.",
      );
    }
    if (t.bidDeadline !== null && epoch < t.bidDeadline)
      throw new Error(
        `The reveal window has not opened yet. Bids close at epoch ${t.bidDeadline}.`,
      );
    if (t.revealDeadline !== null && epoch >= t.revealDeadline)
      throw new Error(
        `The reveal window closed at epoch ${t.revealDeadline}. This bid stays sealed, and its bond follows the tender's outcome.`,
      );
  }
}

/**
 * Recompute a bid's commitment from its own price, salt, and
 * identity, and refuse the reveal before the wallet opens
 * when the recomputed hash does not match the saved
 * commitment. A wrong salt costs no fee this way: the chain
 * is never asked, because the answer is already known on
 * this device.
 */
export async function checkSaltMatchesCommitment(bid: SavedBid): Promise<void> {
  let recomputed: string;
  try {
    recomputed = await commitmentHash(
      BigInt(bid.price),
      hexToBytes(bid.saltHex),
      bid.identity,
    );
  } catch {
    throw new Error(
      "That salt does not match this bid. Nothing was submitted. No fee was spent. Check the salt and try again.",
    );
  }
  if (recomputed !== bid.commitment) {
    throw new Error(
      "That salt does not match this bid. Nothing was submitted. No fee was spent. Check the salt and try again.",
    );
  }
}

/**
 * The manual reveal has no saved commitment to compare
 * against, so the recomputed hash is checked against the
 * commitments the tender itself holds on chain. A hash that
 * matches no committed bid cannot be revealed, and the
 * reveal is refused before the wallet opens.
 */
async function checkManualSaltMatchesTender(
  app: App,
  tenderAddr: string,
  price: bigint,
  salt: Uint8Array,
  identity: string,
): Promise<void> {
  const recomputed = await commitmentHash(price, salt, identity);
  const sub = await readSubstatePlain(app, tenderAddr);
  if (!sub)
    throw new Error(plainAddressError(tenderAddr, new Error("That component is down")));
  let t: TenderComponentState;
  try {
    t = decodeTenderState(sub.value);
  } catch (e) {
    throw new Error(plainAddressError(tenderAddr, e));
  }
  const found = t.commitments.some((c) => c.commitment === recomputed);
  if (!found) {
    throw new Error(
      "That salt, price, and payment identity do not match the commitment. Nothing was submitted. No fee was spent. Check the three values and try again. If you just committed, the indexer may not have caught up yet. Try again in a few minutes.",
    );
  }
}

function saveBid(bid: SavedBid): boolean {
  const all = savedBids().filter(
    (b) => !(b.tender === bid.tender && b.commitment === bid.commitment),
  );
  all.push(bid);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    // The bid still exists in the page until it closes, but
    // the caller must say so: a silent failure here is a lost
    // salt the seller never hears about.
    return false;
  }
}

/**
 * Remove one saved bid from this browser, by tender plus
 * commitment. Used when a commit fails on chain, so the saved
 * list never offers a reveal for a commitment that is not on
 * chain, and by the delete control on a saved bid row.
 */
export function removeBid(tender: string, commitment: string): void {
  const all = savedBids().filter(
    (b) => !(b.tender === tender && b.commitment === commitment),
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* the list stays as it was */
  }
}

/**
 * Merge imported bids into this browser's saved bids, skipping
 * any whose tender and commitment are already here. Returns
 * how many were new.
 */
export function mergeBids(incoming: readonly SavedBid[]): number {
  const seen = new Set(
    savedBids().map((b) => `${b.tender}:${b.commitment}`),
  );
  let added = 0;
  for (const bid of incoming) {
    const key = `${bid.tender}:${bid.commitment}`;
    if (!seen.has(key)) {
      seen.add(key);
      added++;
    }
    saveBid(bid);
  }
  return added;
}

export async function renderSeller(
  app: App,
  root: HTMLElement,
  go: (hash: string) => void,
): Promise<void> {
  const wrap = el("div");
  root.append(wrap);
  wrap.append(
    notice(
      "Your bid is a hash of your price, a random salt, and your payment identity. The chain sees the hash and your bond, nothing else. The price opens only when you reveal it, and a bid nobody reveals stays sealed forever.",
      "How a sealed bid works.",
    ),
  );

  const commitBox = box("Commit a bid");
  const tenderIn = textInput("mono");
  tenderIn.placeholder = "Tender component_…";
  const priceIn = textInput();
  priceIn.placeholder = "Your price in tari";
  const identityIn = textInput("mono");
  identityIn.placeholder = "64 hex characters";
  if (app.myKey) identityIn.value = app.myKey;
  identityIn.placeholder = "The key that gets paid if you win, 64 hex characters";
  commitBox.body.append(
    field("Tender", tenderIn),
    field("Price", priceIn, "Kept sealed until you reveal. It must be at or under the budget cap."),
    field("Payment identity", identityIn, "The public key the winnings go to. It is part of the commitment, so it cannot be swapped later."),
  );
  const summary = el("div");
  // Two steps in one screen. Step one generates the salt and
  // shows it, with the commitment, the bond, and the reveal
  // window. Step two asks the seller to confirm the salt is
  // saved, and only then submits. The submit stays disabled
  // until the box is ticked. The salt is generated once, the
  // commit is submitted once, and step two submits the one
  // commitment already shown. Editing a field after step one
  // clears the pending bid, so a stale commitment can never
  // be submitted.
  let pendingBid: SavedBid | null = null;
  let pendingBond = 0n;
  // One salt per commit: actionButton re-enables its button
  // after the click, so the flag, not the disabled state, is
  // what stops a second generation. The visual disable is
  // applied after the handler returns, so it survives.
  let stepOneUsed = false;
  const stepTwo = el("div", "step-two");
  stepTwo.hidden = true;
  const confirmBox = el("input");
  confirmBox.type = "checkbox";
  const confirmLabel = el("label", undefined, "I wrote the salt down, or I saved the backup file. I know the salt cannot be recovered.");
  const confirmRow = el("div", "confirm-row");
  confirmRow.append(confirmBox, confirmLabel);
  const submitBtn = actionButton("Commit this bid", "btn-blue", async () => {
    const account = requireWallet(app, "commit this bid");
    if (!account || !pendingBid) return;
    const bid = pendingBid;
    const { outcome } = await app.submitAction(
      B.buildCommitBid(account, bid.tender, bid.commitment, pendingBond),
    );
    if (!settleOutcome(app, wrap, outcome)) {
      // A confirmed on chain failure: the bid was saved before
      // the submit, so remove it now, or the saved list would
      // offer a reveal for a commitment that is not on chain.
      // An unconfirmed outcome never reaches this branch.
      removeBid(bid.tender, bid.commitment);
      errorBox(
        wrap,
        new Error("The commit failed, so nothing was saved. No bond moved. Only the network fee was spent."),
      );
      return;
    }
    go(`#/app/tender/${bid.tender}`);
  }, (e) => errorBox(wrap, e));
  submitBtn.disabled = true;
  confirmBox.addEventListener("change", () => {
    submitBtn.disabled = !confirmBox.checked;
  });
  stepTwo.append(confirmRow, submitBtn);
  const resetPending = () => {
    pendingBid = null;
    stepOneUsed = false;
    stepOneBtn.disabled = false;
    stepTwo.hidden = true;
    submitBtn.disabled = true;
    confirmBox.checked = false;
    summary.replaceChildren();
  };
  for (const input of [tenderIn, priceIn, identityIn]) {
    input.addEventListener("input", resetPending);
  }
  const stepOneBtn = actionButton("Generate my salt", "btn-blue", async () => {
    if (stepOneUsed) return;
    const account = requireWallet(app, "commit this bid");
    if (!account) return;
    const tenderAddr = tenderIn.value.trim();
    const sub = await readSubstatePlain(app, tenderAddr);
    if (!sub)
      throw new Error(plainAddressError(tenderAddr, new Error("That component is down")));
    let t: TenderComponentState;
    try {
      t = decodeTenderState(sub.value);
    } catch (e) {
      throw new Error(plainAddressError(tenderAddr, e));
    }
    if (t.state !== "Open") throw new Error(`This tender is ${t.state.toLowerCase()}, not open for bids`);
    const price = parseTari(priceIn.value);
    if (price > t.rules.budgetCap) throw new Error("The price is over the budget cap");
    const identity = identityIn.value.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(identity))
      throw new Error("The payment identity is not 64 hex characters");
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const commitment = await commitmentHash(price, salt, identity);
    const bid: SavedBid = {
      tender: tenderAddr,
      price: price.toString(),
      saltHex: bytesToHex(salt),
      identity,
      commitment,
    };
    summary.replaceChildren();
    const warn = el("div", "warn");
    warn.append(
      el("b", undefined, "Your salt. "),
      document.createTextNode(
        "Write it down now. This browser keeps a copy, but a browser copy alone is not enough. If you lose the salt, your bid can never be revealed. Your bond follows the never reveal outcome.",
      ),
    );
    const saltEl = el("div", "hash", bytesToHex(salt));
    const kvBox = el("div");
    kv(kvBox, "Commitment hash", commitment);
    kv(kvBox, "Bond to post", money(t.rules.bondAmount));
    // The reveal deadline, stated at commitment time in epochs
    // and approximate wall-clock terms, as the plan promised:
    // this is the moment the seller must come back for, and a
    // missed reveal forfeits the bond. An epoch that cannot be
    // read leaves the epochs alone, with no invented time.
    let epoch = 0;
    try {
      epoch = await app.indexer.epoch();
    } catch {
      /* the deadlines still render as epochs */
    }
    if (t.bidDeadline !== null)
      kv(kvBox, "Bids close", deadlineText(app.network, t.bidDeadline, epoch));
    const windowText = revealWindowText(
      app.network,
      t.bidDeadline,
      t.revealDeadline,
      epoch,
    );
    if (windowText) kv(kvBox, "Reveal window", windowText);
    summary.append(warn, saltEl, kvBox);
    // Persist the bid before submitting: if the wallet accepts
    // the transaction but the response is lost, the salt must
    // still be recoverable, or the bond is forfeited.
    const saved = saveBid(bid);
    if (!saved) {
      const saveWarn = el(
        "div",
        "warn",
        "This browser could not save the bid. Write the salt down before you continue. Closing this tab now would lose it.",
      );
      summary.append(saveWarn);
    }
    pendingBid = bid;
    pendingBond = t.rules.bondAmount;
    stepOneUsed = true;
    setTimeout(() => {
      stepOneBtn.disabled = true;
    }, 0);
    stepTwo.hidden = false;
  }, (e) => errorBox(wrap, e));
  commitBox.body.append(stepOneBtn, feeNote("commitBid"), summary, stepTwo);
  wrap.append(commitBox.box);

  const revealBox = box("Reveal a bid");
  const mine = savedBids();
  if (!mine.length) {
    revealBox.body.append(
      el("div", "empty", "No bids saved in this browser. If you committed from another browser, paste the details below."),
    );
  }
  // A saved bid whose salt does not recompute to its own
  // commitment cannot be revealed. The check runs when this
  // screen loads, so a damaged saved bid is marked here
  // instead of offering a reveal the chain would reject.
  const bidValid = new Map<string, boolean>();
  for (const bid of mine) {
    try {
      bidValid.set(
        `${bid.tender}:${bid.commitment}`,
        (await commitmentHash(
          BigInt(bid.price),
          hexToBytes(bid.saltHex),
          bid.identity,
        )) === bid.commitment,
      );
    } catch {
      bidValid.set(`${bid.tender}:${bid.commitment}`, false);
    }
  }
  for (const bid of mine) {
    const valid = bidValid.get(`${bid.tender}:${bid.commitment}`) ?? true;
    const row = el("div", "commit-row");
    row.append(el("span", undefined, `${bid.tender.slice(0, 18)}…`));
    row.append(el("span", "hash", bid.commitment.slice(0, 16) + "…"));
    row.append(el("span", "spacer"));
    // The salt is hidden by default. A seller who missed the
    // commit moment can ask for it again, one bid at a time,
    // with a warning and a copy button. The salt is already
    // in plaintext in this browser, so showing it creates no
    // new copy. It only makes an existing copy visible.
    const saltPanel = el("div", "salt-panel");
    saltPanel.hidden = true;
    const saltEl = el("div", "hash", bid.saltHex);
    const saltWarn = el(
      "div",
      "warn",
      "Keep this salt private. Anyone who sees it can work out your price. Do not share your screen while it is visible.",
    );
    const copyBtn = actionButton("Copy salt", "btn-white btn-sm", async () => {
      try {
        await navigator.clipboard.writeText(bid.saltHex);
        copyBtn.textContent = "Copied";
      } catch {
        copyBtn.textContent = "Copy failed. Select the salt and copy it by hand.";
      }
    });
    saltPanel.append(saltEl, saltWarn, copyBtn);
    const showBtn = actionButton("Show salt", "btn-white btn-sm", () => {
      saltPanel.hidden = !saltPanel.hidden;
      showBtn.textContent = saltPanel.hidden ? "Show salt" : "Hide salt";
    });
    row.append(showBtn);
    const btn = actionButton("reveal", "btn-blue btn-sm", async () => {
      if (!requireWallet(app, "reveal this bid")) return;
      await checkSaltMatchesCommitment(bid);
      await checkRevealable(app, bid.tender);
      const { outcome } = await app.submitAction(
        B.buildRevealBid(
          bid.tender,
          BigInt(bid.price),
          hexToBytes(bid.saltHex),
          bid.identity,
        ),
      );
      if (!settleOutcome(app, wrap, outcome)) return;
      go(`#/app/tender/${bid.tender}`);
    }, (e) => errorBox(wrap, e));
    row.append(btn);
    // A shared browser needs a way to remove a bid. Delete
    // asks first, and names the consequence before anything
    // is removed. There is no undo inside the app: the only
    // way back is reimporting a backup.
    const deletePanel = el("div", "salt-panel");
    deletePanel.hidden = true;
    const deleteWarn = el(
      "div",
      "warn",
      "Delete this saved bid from this browser. If this is the only copy of the salt, the bid can never be revealed. Delete it only if you have a backup, or if the bid was never committed.",
    );
    const deleteConfirmBtn = actionButton("Delete this bid", "btn-white btn-sm", () => {
      removeBid(bid.tender, bid.commitment);
      go("#/app/seller");
    });
    const deleteKeepBtn = actionButton("Keep it", "btn-white btn-sm", () => {
      deletePanel.hidden = true;
    });
    deletePanel.append(deleteWarn, deleteConfirmBtn, deleteKeepBtn);
    const deleteBtn = actionButton("Delete", "btn-white btn-sm", () => {
      deletePanel.hidden = !deletePanel.hidden;
    });
    row.append(deleteBtn);
    if (!valid) {
      btn.disabled = true;
      const badNote = el(
        "div",
        "warn",
        "This saved bid does not match its commitment. It cannot be revealed.",
      );
      revealBox.body.append(row, badNote, saltPanel, deletePanel);
    } else {
      revealBox.body.append(row, saltPanel, deletePanel);
    }
  }
  if (mine.length) revealBox.body.append(feeNote("revealBid"));
  const mTender = textInput("mono");
  mTender.placeholder = "Tender component_…";
  const mPrice = textInput();
  mPrice.placeholder = "Price in tari";
  const mSalt = textInput("mono");
  mSalt.placeholder = "The 32 byte salt, 64 hex characters";
  const mIdentity = textInput("mono");
  mIdentity.placeholder = "Payment identity, 64 hex characters";
  revealBox.body.append(
    field("Tender", mTender),
    field("Price", mPrice),
    field("Salt", mSalt),
    field("Payment identity", mIdentity),
  );
  const mBtn = actionButton("Reveal with pasted details", "btn-white", async () => {
    if (!requireWallet(app, "reveal a bid")) return;
    const salt = hexToBytes(mSalt.value.trim().toLowerCase());
    if (salt.length !== 32) throw new Error("The salt must be 32 bytes");
    await checkManualSaltMatchesTender(
      app,
      mTender.value.trim(),
      parseTari(mPrice.value),
      salt,
      mIdentity.value.trim().toLowerCase(),
    );
    await checkRevealable(app, mTender.value.trim());
    const { outcome } = await app.submitAction(
      B.buildRevealBid(
        mTender.value.trim(),
        parseTari(mPrice.value),
        salt,
        mIdentity.value.trim().toLowerCase(),
      ),
    );
    if (!settleOutcome(app, wrap, outcome)) return;
    go(`#/app/tender/${mTender.value.trim()}`);
  }, (e) => errorBox(wrap, e));
  revealBox.body.append(mBtn, feeNote("revealBid"));
  wrap.append(revealBox.box);

  // The backup box. The saved bids above live only in this
  // browser, and a lost salt cannot be recovered by anyone:
  // the export and import here are prevention, offered before
  // the loss, and the copy says plainly that no recovery path
  // exists.
  const backupBox = box("Back up your bids");
  backupBox.body.append(
    notice(
      "Your saved bids live only in this browser. A backup file holds each bid's tender, price, salt, payment identity, and commitment. Whoever holds the file can reveal those bids, so keep it somewhere private. If you lose a salt and have no backup, that bid can never be revealed: the app cannot recover a salt, and there is no recovery path.",
      "Backups are prevention, not recovery.",
    ),
  );
  const passIn = textInput();
  passIn.type = "password";
  passIn.placeholder = "A passphrase only you know";
  const passRepeatIn = textInput();
  passRepeatIn.type = "password";
  passRepeatIn.placeholder = "Repeat the passphrase";
  backupBox.body.append(
    field(
      "Passphrase",
      passIn,
      "For an encrypted backup, or to open an encrypted one below. The app does not keep it: if you forget it, the encrypted file cannot be opened, and there is still no recovery path. Use a long passphrase you will remember. A short passphrase can be guessed.",
    ),
    field(
      "Repeat the passphrase",
      passRepeatIn,
      "For an encrypted backup. The two must match before the download starts.",
    ),
  );
  if (mine.length) {
    // The encrypted backup comes first, labelled as the
    // recommended form. The plain backup comes second, with
    // its warning beside it. Both files hold the same bids.
    // The reminder stands while saved bids exist: the file
    // is the seller's own copy, kept where the seller
    // chooses, and it is the only way the salt survives a
    // lost browser.
    backupBox.body.append(
      el(
        "div",
        "warn",
        "Your bid is committed. Back it up now, before you close this tab.",
      ),
    );
    const encBtn = actionButton("Download an encrypted backup", "btn-white", async () => {
      if (passIn.value !== passRepeatIn.value)
        throw new Error("The two passphrases do not match. Check them and try again.");
      const text = await encryptBids(savedBids(), passIn.value);
      downloadTextFile("asiri-bids-encrypted.json", text);
    }, (e) => errorBox(wrap, e));
    const plainBtn = actionButton("Download a plain backup", "btn-white", () => {
      downloadTextFile("asiri-bids.json", serializeBids(savedBids()));
    }, (e) => errorBox(wrap, e));
    backupBox.body.append(
      el("div", "small", "Recommended. An encrypted backup opens only with your passphrase."),
      encBtn,
      el("div", "small", "Plain text. Anyone who opens this file can read every salt in it. Use it only on a device you control."),
      plainBtn,
    );
  }
  const importIn = el("input");
  importIn.type = "file";
  const importStatus = el("div", "small mt");
  // The import's answer is a status: announced when it lands.
  setAria(importStatus, "role", "status");
  const importBtn = actionButton("Import the chosen file", "btn-white", async () => {
    const file = importIn.files?.[0];
    if (!file) throw new Error("Choose a backup file first");
    const text = await file.text();
    const bids = isEncryptedBackup(text)
      ? await decryptBidsFile(text, passIn.value)
      : await parseBidsFile(text);
    const added = mergeBids(bids);
    if (added) {
      app.flash = {
        text: `Imported ${added} ${added === 1 ? "bid" : "bids"} from the backup file. They are saved in this browser now.`,
        txId: null,
      };
      go("#/app/seller");
    } else {
      importStatus.textContent =
        "That file added no new bids. Its bids were already saved in this browser.";
    }
  }, (e) => errorBox(wrap, e));
  backupBox.body.append(
    field("Import a backup file", importIn, "An encrypted file opens with the passphrase above."),
    importBtn,
    importStatus,
  );
  wrap.append(backupBox.box);
}
