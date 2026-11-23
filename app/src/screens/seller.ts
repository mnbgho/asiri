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
import { actionButton, box, downloadTextFile, feeNote, field, kv, money, notice, settleOutcome, textInput } from "./common";

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
 * exists on this network, the tender in its reveal state, and
 * the reveal window still open. Without them the first sign
 * of a problem was a chain rejection after signing.
 */
export async function checkRevealable(app: App, tenderAddr: string): Promise<void> {
  if (!app.wallet.account) throw new Error("connect your wallet first");
  const sub = await readSubstatePlain(app, tenderAddr);
  if (!sub)
    throw new Error(plainAddressError(tenderAddr, new Error("that component is down")));
  let t: TenderComponentState;
  try {
    t = decodeTenderState(sub.value);
  } catch (e) {
    throw new Error(plainAddressError(tenderAddr, e));
  }
  if (t.state !== "Reveal")
    throw new Error(
      `this tender is ${t.state.toLowerCase()}, not in its reveal window. a bid can only be revealed while the tender is in its reveal state.`,
    );
  if (t.revealDeadline !== null) {
    let epoch = 0;
    try {
      epoch = await app.indexer.epoch();
    } catch {
      /* the state check above stands on its own */
    }
    if (epoch && epoch > t.revealDeadline)
      throw new Error(
        `the reveal window closed at epoch ${t.revealDeadline}. this bid stays sealed, and its bond follows the tender's outcome.`,
      );
  }
}

function saveBid(bid: SavedBid): void {
  const all = savedBids().filter(
    (b) => !(b.tender === bid.tender && b.commitment === bid.commitment),
  );
  all.push(bid);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* the bid still exists in the page until it closes */
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
      "your bid is a hash of your price, a random salt, and your payment identity. the chain sees the hash and your bond, nothing else. the price opens only when you reveal it, and a bid nobody reveals stays sealed forever.",
      "how a sealed bid works.",
    ),
  );

  const commitBox = box("commit a bid");
  const tenderIn = textInput("mono");
  tenderIn.placeholder = "tender component_…";
  const priceIn = textInput();
  priceIn.placeholder = "your price in tari";
  const identityIn = textInput("mono");
  identityIn.placeholder = "64 hex characters";
  if (app.myKey) identityIn.value = app.myKey;
  identityIn.placeholder = "the key that gets paid if you win, 64 hex characters";
  commitBox.body.append(
    field("tender", tenderIn),
    field("price", priceIn, "kept sealed until you reveal. it must be at or under the budget cap."),
    field("payment identity", identityIn, "the public key the winnings go to. it is part of the commitment, so it cannot be swapped later."),
  );
  const summary = el("div");
  const commitBtn = actionButton("commit this bid", "btn-blue", async () => {
    if (!app.wallet.account) throw new Error("connect your wallet first");
    const tenderAddr = tenderIn.value.trim();
    const sub = await readSubstatePlain(app, tenderAddr);
    if (!sub)
      throw new Error(plainAddressError(tenderAddr, new Error("that component is down")));
    let t: TenderComponentState;
    try {
      t = decodeTenderState(sub.value);
    } catch (e) {
      throw new Error(plainAddressError(tenderAddr, e));
    }
    if (t.state !== "Open") throw new Error(`this tender is ${t.state.toLowerCase()}, not open for bids`);
    const price = parseTari(priceIn.value);
    if (price > t.rules.budgetCap) throw new Error("the price is over the budget cap");
    const identity = identityIn.value.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(identity))
      throw new Error("the payment identity is not 64 hex characters");
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
      el("b", undefined, "your salt. "),
      document.createTextNode(
        "write it down now. it is shown once. this browser keeps a copy, but if you lose both, your bond is forfeited and the bid can never be opened.",
      ),
    );
    const saltEl = el("div", "hash", bytesToHex(salt));
    const kvBox = el("div");
    kv(kvBox, "commitment hash", commitment);
    kv(kvBox, "bond to post", money(t.rules.bondAmount));
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
      kv(kvBox, "bids close", deadlineText(app.network, t.bidDeadline, epoch));
    const windowText = revealWindowText(
      app.network,
      t.bidDeadline,
      t.revealDeadline,
      epoch,
    );
    if (windowText) kv(kvBox, "reveal window", windowText);
    summary.append(warn, saltEl, kvBox);
    commitBox.body.append(summary);
    // Persist the bid before submitting: if the wallet accepts
    // the transaction but the response is lost, the salt must
    // still be recoverable, or the bond is forfeited.
    saveBid(bid);
    const { outcome } = await app.submitAction(
      B.buildCommitBid(app.wallet.account, tenderAddr, commitment, t.rules.bondAmount),
    );
    if (!settleOutcome(app, wrap, outcome)) return;
    go(`#/app/tender/${tenderAddr}`);
  }, (e) => errorBox(wrap, e));
  commitBox.body.append(commitBtn, feeNote("commitBid"), summary);
  wrap.append(commitBox.box);

  const revealBox = box("reveal a bid");
  const mine = savedBids();
  if (!mine.length) {
    revealBox.body.append(
      el("div", "empty", "no bids saved in this browser. if you committed from another browser, paste the details below."),
    );
  }
  for (const bid of mine) {
    const row = el("div", "commit-row");
    row.append(el("span", undefined, `${bid.tender.slice(0, 18)}…`));
    row.append(el("span", "hash", bid.commitment.slice(0, 16) + "…"));
    row.append(el("span", "spacer"));
    const btn = actionButton("reveal", "btn-blue btn-sm", async () => {
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
    revealBox.body.append(row);
  }
  if (mine.length) revealBox.body.append(feeNote("revealBid"));
  const mTender = textInput("mono");
  mTender.placeholder = "tender component_…";
  const mPrice = textInput();
  mPrice.placeholder = "price in tari";
  const mSalt = textInput("mono");
  mSalt.placeholder = "the 32 byte salt, 64 hex characters";
  const mIdentity = textInput("mono");
  mIdentity.placeholder = "payment identity, 64 hex characters";
  revealBox.body.append(
    field("tender", mTender),
    field("price", mPrice),
    field("salt", mSalt),
    field("payment identity", mIdentity),
  );
  const mBtn = actionButton("reveal with pasted details", "btn-white", async () => {
    const salt = hexToBytes(mSalt.value.trim().toLowerCase());
    if (salt.length !== 32) throw new Error("the salt must be 32 bytes");
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
  const backupBox = box("back up your bids");
  backupBox.body.append(
    notice(
      "your saved bids live only in this browser. a backup file holds each bid's tender, price, salt, payment identity, and commitment. whoever holds the file can reveal those bids, so keep it somewhere private. if you lose a salt and have no backup, that bid can never be revealed: the app cannot recover a salt, and there is no recovery path.",
      "backups are prevention, not recovery.",
    ),
  );
  const passIn = textInput();
  passIn.type = "password";
  passIn.placeholder = "a passphrase only you know";
  backupBox.body.append(
    field(
      "passphrase",
      passIn,
      "for an encrypted backup, or to open an encrypted one below. the app does not keep it: if you forget it, the encrypted file cannot be opened, and there is still no recovery path.",
    ),
  );
  if (mine.length) {
    const plainBtn = actionButton("download a plain backup", "btn-white", () => {
      downloadTextFile("asiri-bids.json", serializeBids(savedBids()));
    }, (e) => errorBox(wrap, e));
    const encBtn = actionButton("download an encrypted backup", "btn-white", async () => {
      const text = await encryptBids(savedBids(), passIn.value);
      downloadTextFile("asiri-bids-encrypted.json", text);
    }, (e) => errorBox(wrap, e));
    backupBox.body.append(plainBtn, encBtn);
  }
  const importIn = el("input");
  importIn.type = "file";
  const importStatus = el("div", "small mt");
  // The import's answer is a status: announced when it lands.
  setAria(importStatus, "role", "status");
  const importBtn = actionButton("import the chosen file", "btn-white", async () => {
    const file = importIn.files?.[0];
    if (!file) throw new Error("choose a backup file first");
    const text = await file.text();
    const bids = isEncryptedBackup(text)
      ? await decryptBidsFile(text, passIn.value)
      : parseBidsFile(text);
    const added = mergeBids(bids);
    if (added) {
      app.flash = {
        text: `imported ${added} ${added === 1 ? "bid" : "bids"} from the backup file. they are saved in this browser now.`,
        txId: null,
      };
      go("#/app/seller");
    } else {
      importStatus.textContent =
        "that file added no new bids. its bids were already saved in this browser.";
    }
  }, (e) => errorBox(wrap, e));
  backupBox.body.append(
    field("import a backup file", importIn, "an encrypted file opens with the passphrase above."),
    importBtn,
    importStatus,
  );
  wrap.append(backupBox.box);
}
