// Small DOM helpers shared by the screens. Everything rendered
// from chain data goes through textContent, never HTML strings.
import { clearErrors, el, explorerLink, setAria, tari, type App } from "../app";
import type { ActionOutcome } from "../finalize";
import { feeText, type FeeAction } from "../fees";

/**
 * How the featured circle's tenders are labelled wherever they
 * are listed, in the receipts' own provenance words: they are
 * the builders' trial runs across their own accounts, and a
 * listing must not let them read as anyone else's adoption.
 */
export const BUILDER_RUN_LABEL =
  "builder-run: run by the builders across their own accounts";

export function box(title: string, pillText?: string): { box: HTMLElement; body: HTMLElement } {
  const b = el("div", "box");
  const h = el("div", "box-h");
  // A box is a section under the screen's h1 title, so its
  // heading is an h2: the heading order never skips a level.
  h.append(el("h2", undefined, title));
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
    `this transaction failed on chain: ${outcome.reason ?? "the chain did not accept it"}.`,
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
 * Settle a submitted action's outcome the same way on every
 * screen. A chain failure is shown here and stops the flow. An
 * unconfirmed submission leaves a note for the next screen,
 * saying plainly that the transaction was submitted and is
 * awaiting finalization. A confirmed outcome simply proceeds.
 * Returns true when the flow should continue to its
 * destination.
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
  if (outcome.kind === "unconfirmed") {
    app.flash = {
      text: "your transaction was submitted and is awaiting finalization. this page may not show its effect yet.",
      txId: outcome.txId,
    };
  }
  return true;
}
