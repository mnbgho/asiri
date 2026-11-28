// The transaction status modal: one overlay that narrates
// every action while it runs, so the visitor is never left
// staring at a still page wondering whether anything
// happened. The app reports each transaction's stages as
// events (see app.ts, TxStage); this modal is the screen
// that answers them. Waiting stages show a spinner and say
// what is happening and how long it usually takes. A
// confirmed transaction shows a receipt: a tick, the words
// Transaction successful, and the transaction link. The
// modal never closes on its own: the visitor closes it,
// so the receipt is still there to read when they look.
import { App, el, explorerLink, setAria } from "./app";
import type { TxStage } from "./app";

export class TxModal {
  private overlay: HTMLElement;
  private spin: HTMLElement;
  private tick: HTMLElement;
  private title: HTMLElement;
  private msg: HTMLElement;
  private link: HTMLElement;
  private closeBtn: HTMLButtonElement;

  constructor() {
    this.overlay = el("div", "tx-overlay");
    this.overlay.hidden = true;
    const card = el("div", "tx-card");
    setAria(card, "role", "status");
    this.spin = el("div", "tx-spin");
    this.tick = el("div", "tx-tick", "✓");
    this.title = el("div", "tx-title");
    this.msg = el("div", "tx-msg");
    this.link = el("div", "tx-link");
    this.closeBtn = el("button", "btn btn-white btn-sm tx-close", "Close");
    this.closeBtn.addEventListener("click", () => this.hide());
    card.append(this.spin, this.tick, this.title, this.msg, this.link, this.closeBtn);
    this.overlay.append(card);
    if (typeof document !== "undefined" && document.body) {
      document.body.append(this.overlay);
    }
  }

  /** Show the stage. Waiting stages spin with no close
   * button. Done stages stop the spinner and show a Close
   * button, and stay open until the visitor closes them:
   * the receipt must still be there to read when they look,
   * not gone because a timer ran out. A new stage always
   * replaces the last. */
  show(app: App, detail: TxStage): void {
    this.overlay.hidden = false;
    this.link.replaceChildren();
    const done = (title: string, msg: string) => {
      this.spin.hidden = true;
      this.tick.hidden = true;
      this.title.textContent = title;
      this.msg.textContent = msg;
      this.closeBtn.hidden = false;
    };
    const waiting = (title: string, msg: string) => {
      this.spin.hidden = false;
      this.tick.hidden = true;
      this.title.textContent = title;
      this.msg.textContent = msg;
      this.closeBtn.hidden = true;
    };
    switch (detail.stage) {
      case "wallet":
        waiting(
          "Waiting for your wallet",
          "Approve the transaction in your wallet to continue.",
        );
        break;
      case "confirming":
        waiting(
          "Waiting for the chain",
          "Your transaction was submitted. The chain usually confirms it in under a minute.",
        );
        break;
      case "submitted":
        done(
          "Submitted.",
          "Your transaction was submitted. It will show on chain once the network records it.",
        );
        break;
      case "confirmed":
        this.spin.hidden = true;
        this.tick.hidden = false;
        this.title.textContent = "Transaction successful";
        this.msg.textContent = "Confirmed on chain.";
        this.closeBtn.hidden = false;
        if (detail.txId) this.link.append(explorerLink(app, "tx", detail.txId));
        break;
      case "failed":
        done(
          "This transaction failed on chain.",
          detail.reason ?? "The chain did not accept it.",
        );
        if (detail.txId) this.link.append(explorerLink(app, "tx", detail.txId));
        break;
      case "unconfirmed":
        done(
          "Submitted, still confirming.",
          "The chain has not confirmed it yet. Check the transaction link, or wait and the page will update.",
        );
        if (detail.txId) this.link.append(explorerLink(app, "tx", detail.txId));
        break;
      case "error":
        done("Nothing was submitted.", detail.message);
        break;
    }
  }

  hide(): void {
    this.overlay.hidden = true;
  }
}
