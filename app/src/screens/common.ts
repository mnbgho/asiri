// Small DOM helpers shared by the screens. Everything rendered
// from chain data goes through textContent, never HTML strings.
import { clearErrors, cap, el, explorerLink, setAria, tari, type App } from "../app";
import { looksDeclined, waitForProvider } from "../wallet";
import type { ActionOutcome } from "../finalize";
import { feeText, type FeeAction } from "../fees";

/**
 * The wallet gate: acting needs a wallet, reading never does.
 * A visitor who tries to act without one gets a modal that
 * says so and offers the connection, instead of an error
 * banner. Returns the connected account when the action may
 * go ahead, and null when the modal opened instead. The modal
 * is guarded for the unit test fake DOM, which has no body and
 * no querySelector: in that environment the action is simply
 * refused.
 */
export function requireWallet(app: App, action: string): string | null {
  if (app.wallet.account) return app.wallet.account;
  openWalletModal(app, action);
  return null;
}

function openWalletModal(app: App, action: string): void {
  const doc = (globalThis as { document?: Document }).document;
  if (
    !doc ||
    typeof doc.createElement !== "function" ||
    typeof doc.querySelector !== "function" ||
    !doc.body ||
    typeof doc.body.append !== "function"
  ) {
    return;
  }
  const existing = doc.querySelector(".wallet-modal-overlay");
  if (existing && typeof existing.remove === "function") existing.remove();
  const overlay = el("div", "wallet-modal-overlay");
  setAria(overlay, "role", "dialog");
  setAria(overlay, "aria-modal", "true");
  const card = el("div", "wallet-modal");
  card.append(
    el("h2", undefined, "Connect your wallet"),
    el(
      "p",
      undefined,
      `Please connect your wallet to ${action}. Reading and verifying never need a wallet, but acting does: the chain needs your signature.`,
    ),
  );
  const status = el("div", "small mt");
  const connectBtn = el("button", "btn btn-blue", "Connect wallet");
  connectBtn.addEventListener("click", () => {
    void (async () => {
      connectBtn.disabled = true;
      if (!(await waitForProvider())) {
        status.textContent =
          "No wallet found. Install Sapient or open the Tari web wallet.";
        connectBtn.disabled = false;
        return;
      }
      try {
        await app.wallet.connect();
      } catch (e) {
        status.textContent = looksDeclined(e)
          ? "You declined the connection in your wallet. Approve it there to connect."
          : "The wallet did not connect. Try again.";
        connectBtn.disabled = false;
        return;
      }
      if (app.wallet.network && app.wallet.network !== app.network) {
        try {
          await app.wallet.switchNetwork(app.network);
        } catch {
          /* the wallet stayed on its own network */
        }
      }
      await app.deriveIdentity();
      // The sidebar's wallet card re-renders from this event,
      // so the connection shows there too without a reload.
      const w = globalThis as { window?: { dispatchEvent?: (e: Event) => void } };
      if (w.window && typeof w.window.dispatchEvent === "function") {
        w.window.dispatchEvent(new Event("asiri:wallet-connected"));
      }
      overlay.remove();
    })();
  });
  const cancelBtn = el("button", "btn btn-white", "Not now");
  cancelBtn.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  const row = el("div", "wallet-modal-actions");
  row.append(connectBtn, cancelBtn);
  card.append(row, status);
  overlay.append(card);
  doc.body.append(overlay);
  if (typeof connectBtn.focus === "function") connectBtn.focus();
}

/**
 * How the featured circle's tenders are labelled wherever they
 * are listed: they are the featured circle's recorded season
 * tenders, read straight from the chain.
 */
export const FEATURED_TENDERS_NOTE = "recorded on chain";

export function box(title: string, pillText?: string): { box: HTMLElement; body: HTMLElement } {
  const b = el("div", "box");
  const h = el("div", "box-h");
  // A box is a section under the screen's h1 title, so its
  // heading is an h2: the heading order never skips a level.
  h.append(el("h2", undefined, cap(title)));
  if (pillText) {
    const s = el("span", "spacer");
    h.append(s, el("span", "pill pill-tint", pillText));
  }
  const body = el("div", "box-b");
  b.append(h, body);
  return { box: b, body };
}

export function kv(body: HTMLElement, k: string, v: string, plain = false): void {
  const row = el("div", "kv");
  row.append(el("span", "k", k));
  const val = el("span", plain ? "v plain" : "v", v);
  row.append(val);
  body.append(row);
}

export function kvNode(body: HTMLElement, k: string, node: Node): void {
  const row = el("div", "kv");
  row.append(el("span", "k", k));
  const val = el("span", "v");
  val.append(node);
  row.append(val);
  body.append(row);
}

export function hashSpan(hex: string): HTMLElement {
  return el("span", "hash", hex);
}

export function money(ut: bigint): string {
  return `${tari(ut)} tari`;
}

let fieldSeq = 0;

export function field(
  label: string,
  input: HTMLElement,
  hint?: string,
): HTMLElement {
  const f = el("div", "field");
  const lab = el("label", undefined, label);
  // The label names its input for real: clicking it focuses the
  // input, and a screen reader reads the label as the input's
  // name. An input that already carries an id keeps it.
  if (!input.id) input.id = `field-${++fieldSeq}`;
  lab.htmlFor = input.id;
  f.append(lab, input);
  if (hint) f.append(el("div", "hint", hint));
  return f;
}

export function textInput(cls = ""): HTMLInputElement {
  const i = el("input");
  i.type = "text";
  if (cls) i.className = cls;
  return i;
}

export function notice(text: string, boldPrefix?: string): HTMLElement {
  const n = el("div", "notice");
  if (boldPrefix) {
    const b = el("b", undefined, boldPrefix + " ");
    n.append(b, document.createTextNode(text));
  } else {
    n.textContent = text;
  }
  return n;
}

export function actionButton(
  label: string,
  cls: string,
  onClick: () => Promise<void> | void,
  onError?: (e: unknown) => void,
): HTMLButtonElement {
  const b = el("button", `btn ${cls}`, label);
  b.addEventListener("click", () => {
    void (async () => {
      b.disabled = true;
      // Say the action is running, on the button itself: the
      // wallet prompt and the chain confirmation take seconds,
      // and a button that only greys out reads as dead.
      const original = b.textContent;
      b.textContent = "Working…";
      try {
        await onClick();
      } catch (e) {
        // A failed action must say so on its own screen: the
        // caller passes its error box as onError. Without one
        // the rejection stays unhandled, as visible as a crash,
        // rather than being swallowed here in silence. If the
        // error box itself fails, synchronously or by returning
        // a rejected promise, the action's own error is what
        // surfaces, never the box's.
        if (!onError) throw e;
        try {
          await onError(e);
        } catch {
          throw e;
        }
      } finally {
        b.textContent = original;
        b.disabled = false;
      }
    })();
  });
  return b;
}

/**
 * Offer a text file as a download, the results screen's
 * pattern: the blob url is revoked a few seconds late, because
 * some browsers resolve the download after the click handler
 * returns and an immediate revoke can cancel it.
 */
export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * A chain failure, rendered where the action happened: the
 * chain's own reason, and the transaction's explorer link so
 * the user can see the record themselves.
 */
export function chainError(
  app: App,
  root: HTMLElement,
  outcome: ActionOutcome,
): void {
  clearErrors(root);
  const box = el(
    "div",
    "err",
    `This transaction failed on chain: ${outcome.reason ?? "The chain did not accept it"}.`,
  );
  setAria(box, "role", "alert");
  if (outcome.txId) {
    box.append(document.createTextNode(" transaction "));
    box.append(explorerLink(app, "tx", outcome.txId));
    box.append(document.createTextNode("."));
  }
  root.prepend(box);
}

/**
 * The typical-fee line for an action, shown before the wallet
 * opens. Only actions with a measured figure in the season
 * record get one (see fees.ts); the rest show nothing.
 */
export function feeNote(action: FeeAction, prefix?: string): HTMLElement {
  const text = feeText(action);
  return el("div", "small mt", prefix ? `${prefix}: ${text}` : text);
}

/**
 * Ask the app frame to re-render the current screen, so its
 * numbers come from the chain as it stands now. The frame
 * listens for this event and re-renders, unless the visitor
 * is typing. A no-op where there is no frame to ask.
 */
export function requestRefresh(): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    window.dispatchEvent(new Event("asiri:refresh"));
  }
}

/** Re-render the current screen after a delay, so the indexer
 * has time to record a transaction the wallet just submitted. */
export function refreshAfter(ms: number): void {
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
    window.setTimeout(() => requestRefresh(), ms);
  }
}

/**
 * Settle a submitted action's outcome the same way on every
 * screen. A chain failure is shown here and stops the flow.
 * A confirmed outcome leaves a note for the next screen
 * saying so, with the transaction link, and asks the screen
 * to re-render shortly after, so the numbers it shows come
 * from the chain after the action, not from before it. An
 * unconfirmed submission leaves a note saying plainly that
 * the transaction was submitted and is awaiting
 * finalization, and asks for two re-renders, so the page
 * updates by itself when the indexer catches up, instead of
 * the visitor having to refresh to see it. Returns true when
 * the flow should continue to its destination.
 */
export function settleOutcome(
  app: App,
  root: HTMLElement,
  outcome: ActionOutcome,
): boolean {
  if (outcome.kind === "failed") {
    chainError(app, root, outcome);
    return false;
  }
  if (outcome.kind === "confirmed") {
    app.flash = {
      text: "Confirmed on chain.",
      txId: outcome.txId,
    };
    refreshAfter(2000);
    return true;
  }
  app.flash = {
    text: "Your transaction was submitted and is awaiting finalization. This page may not show its effect yet.",
    txId: outcome.txId,
  };
  refreshAfter(2000);
  refreshAfter(15000);
  return true;
}
