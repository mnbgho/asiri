// The guided helper: a floating button that opens a panel
// asking what the visitor wants to do, then walks them
// through it step by step, so nobody gets lost in an
// interface with many steps. Each task is a short list of
// plain steps. The panel also watches the screen the
// visitor is on and names the next thing to do there, so
// after each step the visitor always knows what comes next.
import { el, setAria } from "./app";

export interface GuideStep {
  title: string;
  text: string;
  /** The screen this step happens on, when it has one. */
  route?: string;
}

export interface GuideTask {
  id: string;
  title: string;
  intro: string;
  steps: GuideStep[];
}

export const GUIDE_TASKS: GuideTask[] = [
  {
    id: "create-circle",
    title: "Create a circle",
    intro: "Form the buying group first. A tender comes after.",
    steps: [
      {
        title: "Open the start page",
        text: "Go to Start a circle or tender.",
        route: "#/app/create",
      },
      {
        title: "Name your circle",
        text: "Enter a name for your buying group.",
        route: "#/app/create",
      },
      {
        title: "Add the approvers",
        text: "Paste each approver's public key, one per line. Include your own key to be an approver yourself.",
        route: "#/app/create",
      },
      {
        title: "Set the approval threshold",
        text: "This is how many approvers must agree. It cannot be more than the number of approvers.",
        route: "#/app/create",
      },
      {
        title: "Create the circle",
        text: "Click Create circle and approve it in your wallet.",
        route: "#/app/create",
      },
      {
        title: "Next: create a tender",
        text: "Your circle is ready. Create a tender for it to start buying.",
      },
    ],
  },
  {
    id: "create-tender",
    title: "Create a tender",
    intro: "Lock the rules and the budget, then bidding opens.",
    steps: [
      {
        title: "Open your circle",
        text: "Go to Circles and tenders and open the circle.",
        route: "#/app/overview",
      },
      {
        title: "Write the specification",
        text: "Write down what you want to buy. The app hashes it, so the rules lock to it.",
        route: "#/app/create",
      },
      {
        title: "Set the budget cap and the bond",
        text: "The cap is the most the tender can pay. The bond is what each seller posts.",
        route: "#/app/create",
      },
      {
        title: "Set the windows",
        text: "Bid, reveal, override, delivery, claim grace, and dispute, in epochs. Short windows finish the loop in hours.",
        route: "#/app/create",
      },
      {
        title: "Set the thresholds",
        text: "Approval 1 and dispute 2 work for two approvers. The dispute threshold must be higher than the approval threshold.",
        route: "#/app/create",
      },
      {
        title: "Create, register, and lock",
        text: "Click Create tender, register it, and lock the escrow, and approve each step in your wallet.",
        route: "#/app/create",
      },
      {
        title: "Next: sellers bid",
        text: "Bidding is open. Sellers commit their sealed bids.",
      },
    ],
  },
  {
    id: "bid",
    title: "Bid on a tender",
    intro: "Commit a sealed bid with its bond while bidding is open.",
    steps: [
      {
        title: "Open Bid and reveal",
        text: "Go to Bid and reveal.",
        route: "#/app/seller",
      },
      {
        title: "Paste the tender address",
        text: "Paste the tender's component address.",
        route: "#/app/seller",
      },
      {
        title: "Enter your price",
        text: "Enter the price you will sell for, in tari.",
        route: "#/app/seller",
      },
      {
        title: "Save your bid details",
        text: "Click Generate my salt, then write the salt down. You cannot reveal without it.",
        route: "#/app/seller",
      },
      {
        title: "Commit your bid",
        text: "Tick the box that says you saved the salt, then click Commit this bid and approve it in your wallet. Your bond locks.",
        route: "#/app/seller",
      },
      {
        title: "Next: reveal",
        text: "Come back in the reveal window and open your bid.",
      },
    ],
  },
  {
    id: "reveal",
    title: "Reveal a bid",
    intro: "Open your bid in the reveal window. Only opened bids can win.",
    steps: [
      {
        title: "Open Bid and reveal",
        text: "Go to Bid and reveal.",
        route: "#/app/seller",
      },
      {
        title: "Find your saved bid",
        text: "Find the bid you committed. Only the bid on chain can be revealed.",
        route: "#/app/seller",
      },
      {
        title: "Reveal it",
        text: "Click Reveal and approve it in your wallet.",
        route: "#/app/seller",
      },
      {
        title: "Next: the award",
        text: "Once the reveal window closes, the buyer closes the reveal and the lowest revealed price wins.",
      },
    ],
  },
  {
    id: "award",
    title: "Award the tender",
    intro: "Close the reveal window after it ends. The lowest revealed price wins.",
    steps: [
      {
        title: "Open the tender",
        text: "Open the tender after the reveal window closes.",
        route: "#/app/tender/",
      },
      {
        title: "Close the reveal window",
        text: "Click Close the reveal window and approve it in your wallet.",
        route: "#/app/tender/",
      },
      {
        title: "Next: delivery",
        text: "The tender awards to the lowest revealed bid. After the override window, advance it to delivery.",
      },
    ],
  },
  {
    id: "delivery",
    title: "Deliver and confirm delivery",
    intro: "The seller delivers, an approver confirms, and the tender settles.",
    steps: [
      {
        title: "Advance to delivery",
        text: "After the override window passes, click Advance to delivery.",
        route: "#/app/tender/",
      },
      {
        title: "The seller delivers",
        text: "The seller delivers the goods to the buyer.",
        route: "#/app/tender/",
      },
      {
        title: "Confirm delivery",
        text: "An approver clicks confirm delivery and approves it. The tender settles and the seller is paid from escrow.",
        route: "#/app/tender/",
      },
      {
        title: "Next: claims",
        text: "The seller claims the bond and the payout. The buyer claims the receipt.",
      },
    ],
  },
  {
    id: "claim",
    title: "Claim the bond, payout, and receipt",
    intro: "After settlement, each side collects what the tender owes them.",
    steps: [
      {
        title: "Open Results",
        text: "Go to Results.",
        route: "#/app/results",
      },
      {
        title: "Seller: claim the bond",
        text: "The winner claims the bond back.",
        route: "#/app/results",
      },
      {
        title: "Seller: claim the payout",
        text: "The winner claims the winning price from escrow.",
        route: "#/app/results",
      },
      {
        title: "Buyer: claim the receipt",
        text: "The buyer claims the receipt.",
        route: "#/app/results",
      },
    ],
  },
  {
    id: "verify",
    title: "Verify a tender",
    intro: "Re-run every check on any tender yourself. No wallet needed.",
    steps: [
      {
        title: "Open Verify a tender",
        text: "Go to Verify a tender.",
        route: "#/app/verify",
      },
      {
        title: "Paste the tender address",
        text: "Paste the tender's component address.",
        route: "#/app/verify",
      },
      {
        title: "Read the checks",
        text: "The verifier re-runs every check from the public record.",
        route: "#/app/verify",
      },
    ],
  },
];

/**
 * The plain next thing to do on a screen, from its route
 * alone. This is the line the panel shows under "Where am
 * I", so a visitor who opens the helper on any screen is
 * told what comes next there, without picking a task first.
 */
export function nextForRoute(hash: string): string {
  if (hash === "#/" || hash === "" || hash.startsWith("#how") || hash.startsWith("#proof")) {
    return "This is the front page. Open the app to see the circles and tenders, or start a circle.";
  }
  if (hash.startsWith("#/app/create")) {
    return "You are starting a circle or a tender. Fill the form, then create it and approve it in your wallet.";
  }
  if (hash.startsWith("#/app/seller")) {
    return "You are bidding and revealing. Commit a sealed bid while bidding is open, then come back in the reveal window to open it.";
  }
  if (hash.startsWith("#/app/approvals")) {
    return "These are the things waiting for your signature: overrides, deliveries to confirm, and disputes.";
  }
  if (hash.startsWith("#/app/results")) {
    return "These are the finished tenders and their proof. After settlement, the seller claims the bond and the payout, and the buyer claims the receipt.";
  }
  if (hash.startsWith("#/app/verify")) {
    return "Paste a tender address to re-run every check on it. No wallet needed.";
  }
  if (hash.startsWith("#/app/tender/")) {
    return "This is one tender's whole record. Read its state, then use the action its state allows: lock, close the reveal, advance to delivery, or confirm delivery.";
  }
  if (hash.startsWith("#/app/circle/")) {
    return "This is one buying circle. Read its approvers and tenders, then start a tender for it, or change its approvers.";
  }
  if (hash.startsWith("#/app/overview")) {
    return "These are the circles and tenders. Open one to read it, or start a new circle.";
  }
  if (hash.startsWith("#/app/help")) {
    return "This is the help page. Pick a task below in the guide to walk through it step by step.";
  }
  return "Pick a task in the guide to walk through it step by step.";
}

/** Does this step happen on the screen the visitor is on? */
export function stepMatchesRoute(step: GuideStep, hash: string): boolean {
  if (!step.route) return false;
  return step.route.endsWith("/")
    ? hash.startsWith(step.route)
    : hash === step.route;
}

export class GuidePanel {
  private button: HTMLButtonElement;
  private panel: HTMLElement;
  private body: HTMLElement;
  private task: GuideTask | null = null;
  private stepIndex = 0;

  constructor() {
    this.button = el("button", "guide-btn", "?");
    setAria(this.button, "aria-label", "Open the guide");
    setAria(this.button, "title", "Guide: what do you want to do?");
    this.button.addEventListener("click", () => {
      this.panel.hidden = !this.panel.hidden;
      if (!this.panel.hidden) this.render();
    });
    this.panel = el("div", "guide-panel");
    this.panel.hidden = true;
    this.body = el("div", "guide-body");
    this.panel.append(this.body);
    if (typeof document !== "undefined" && document.body) {
      document.body.append(this.button, this.panel);
    }
    if (
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function"
    ) {
      // The visitor moved to another screen: refresh the
      // "where am I" line and the "you are here" step, so
      // the guide follows them instead of going stale.
      window.addEventListener("hashchange", () => {
        if (!this.panel.hidden) this.render();
      });
    }
  }

  private currentHash(): string {
    return typeof location !== "undefined" ? location.hash || "#/" : "#/";
  }

  private render(): void {
    this.body.replaceChildren();
    const where = el("div", "guide-where");
    where.append(el("div", "guide-where-label", "Where am I"));
    where.append(el("div", "guide-where-text", nextForRoute(this.currentHash())));
    this.body.append(where);
    if (!this.task) {
      this.body.append(el("div", "guide-title", "What do you want to do?"));
      for (const t of GUIDE_TASKS) {
        const b = el("button", "guide-task", t.title);
        b.addEventListener("click", () => {
          this.task = t;
          this.stepIndex = 0;
          this.render();
        });
        this.body.append(b);
      }
      return;
    }
    const t = this.task;
    const head = el("div", "guide-head");
    const back = el("button", "guide-back", "All tasks");
    back.addEventListener("click", () => {
      this.task = null;
      this.render();
    });
    head.append(back, el("div", "guide-title", t.title));
    this.body.append(head);
    this.body.append(el("div", "guide-intro", t.intro));
    const hash = this.currentHash();
    t.steps.forEach((s, i) => {
      const row = el("div", "guide-step" + (i === this.stepIndex ? " on" : ""));
      const num = el("span", "guide-num", String(i + 1));
      const text = el("div", "guide-step-text");
      text.append(el("div", "guide-step-title", s.title));
      text.append(el("div", "guide-step-body", s.text));
      if (stepMatchesRoute(s, hash)) {
        text.append(el("div", "guide-here", "You are here"));
      }
      row.append(num, text);
      this.body.append(row);
    });
    const nav = el("div", "guide-nav");
    const prev = el("button", "btn btn-white btn-sm", "Back");
    prev.disabled = this.stepIndex === 0;
    prev.addEventListener("click", () => {
      if (this.stepIndex > 0) {
        this.stepIndex -= 1;
        this.render();
      }
    });
    const next = el("button", "btn btn-blue btn-sm", "Next");
    next.disabled = this.stepIndex >= t.steps.length - 1;
    next.addEventListener("click", () => {
      if (this.stepIndex < t.steps.length - 1) {
        this.stepIndex += 1;
        this.render();
      }
    });
    const close = el("button", "btn btn-white btn-sm", "Close");
    close.addEventListener("click", () => {
      this.panel.hidden = true;
    });
    nav.append(prev, next, close);
    this.body.append(nav);
  }
}
