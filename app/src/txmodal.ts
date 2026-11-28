// The transaction status modal: one overlay that narrates
// every action while it runs, so the visitor is never left
// staring at a still page wondering whether anything
// happened. The app reports each transaction's stages as
// events (see app.ts, TxStage); this modal is the screen
// that answers them. Waiting stages show a spinner and say
// what is happening and how long it usually takes. Done
// stages say the ending, link the transaction, and close
// themselves, except a failure or an error, which stays
// until the visitor dismisses it.
import { App, el, explorerLink, setAria } from "./app";
import type { TxStage } from "./app";

export class TxModal {
  private overlay: HTMLElement;
  private spin: HTMLElement;
  private title: HTMLElement;
  private msg: HTMLElement;
  private link: HTMLElement;
  private closeBtn: HTMLButtonElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.overlay = el("div", "tx-overlay");
    this.overlay.hidden = true;
    const card = el("div", "tx-card");
    setAria(card, "role", "status");
    this.spin = el("div", "tx-spin");
    this.title = el("div", "tx-title");
    this.msg = el("div", "tx-msg");
    this.link = el("div", "tx-link");
    this.closeBtn = el("button", "btn btn-white btn-sm tx-close", "Close");
    this.closeBtn.addEventListener("click", () => this.hide());
    card.append(this.spin, this.title, this.msg, this.link, this.closeBtn);
    this.overlay.append(card);
    if (typeof document !== "undefined" && document.body) {
      document.body.append(this.overlay);
    }
  }

  /** Show the stage. Waiting stages spin with no close
   * button; done stages stop the spinner and, except a
   * failure or an error, close themselves after a few
   * seconds. A new stage always replaces the last, and its
   * own timer replaces the last timer. */
  show(app: App, detail: TxStage): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.overlay.hidden = false;
    this.link.replaceChildren();
    const done = (title: string, msg: string, autoHide: boolean) => {
      this.spin.hidden = true;
      this.title.textContent = title;
      this.msg.textContent = msg;
      this.closeBtn.hidden = false;
      if (autoHide) {
        this.hideTimer = setTimeout(() => this.hide(), 5000);
      }
    };
    const waiting = (title: string, msg: string) => {
      this.spin.hidden = false;
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
          "The page will update by itself when the chain records it.",
          true,
        );
        break;
      case "confirmed":
        done("Confirmed on chain.", "The page has updated.", true);
        if (detail.txId) this.link.append(explorerLink(app, "tx", detail.txId));
        break;
      case "failed":
        done(
          "This transaction failed on chain.",
          detail.reason ?? "The chain did not accept it.",
          false,
        );
        if (detail.txId) this.link.append(explorerLink(app, "tx", detail.txId));
        break;
      case "unconfirmed":
        done(
          "Submitted, still confirming.",
          "The chain has not recorded it yet. The page will update by itself when it does.",
          true,
        );
        if (detail.txId) this.link.append(explorerLink(app, "tx", detail.txId));
        break;
      case "error":
        done("Nothing was submitted.", detail.message, false);
        break;
    }
  }

  hide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.overlay.hidden = true;
  }
}
