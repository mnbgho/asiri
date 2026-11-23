// Entry point and hash router. Two views: the landing page and
// the app frame (sidebar, network switch, wallet card, screens).
import { App, el, explorerLink, setAria, short, tari } from "./app";
import { fundingApplies, fundingGuidance } from "./funding";
import { networkPill } from "./indexer";
import { updateDeadlineSpans } from "./time";
import { hasProvider, looksDeclined, waitForProvider } from "./wallet";
import { renderLanding } from "./screens/landing";
import { renderOverview } from "./screens/overview";
import { renderTender } from "./screens/tender";
import { renderCircle } from "./screens/circle";
import { renderCreate } from "./screens/create";
import { renderSeller } from "./screens/seller";
import { renderApprovals } from "./screens/approvals";
import { renderVerify } from "./screens/verify";
import { renderResults } from "./screens/results";
import { renderHelp } from "./screens/help";
import "./style.css";

const app = new App();
const root = document.getElementById("root")!;

function go(hash: string): void {
  if (location.hash === hash) void route();
  else location.hash = hash;
}

// The deadline refresh. Screens render once and the chain
// keeps moving: without this, a window opening while a page
// sits open changes nothing on screen until the visitor
// navigates away and back. Every minute the current epoch is
// re-read and every deadline span on the page re-renders its
// countdown from it. When a gate deadline crosses (the moment
// an action like close reveal or expire opens), the screen
// re-renders once so the action appears, unless the visitor
// is typing in a field, in which case the next tick retries.
// The timer belongs to one rendering: route() clears it and
// an app screen starts a fresh one, so nothing outlives its
// page. One minute is the interval: epochs here run twenty
// minutes to an hour, so a minute's staleness costs nothing a
// person could act on, and the indexer is read once a minute
// at most.
let deadlineTimer: ReturnType<typeof setInterval> | null = null;
let lastTickEpoch = 0;

function stopDeadlineTimer(): void {
  if (deadlineTimer) {
    clearInterval(deadlineTimer);
    deadlineTimer = null;
  }
  lastTickEpoch = 0;
}

async function tickDeadlines(): Promise<void> {
  let epoch: number;
  try {
    epoch = await app.indexer.epoch();
  } catch {
    return; // an unread epoch leaves the rendered text standing
  }
  const prev = lastTickEpoch;
  lastTickEpoch = epoch;
  const crossed = updateDeadlineSpans(root, app.network, epoch, prev);
  if (!crossed) return;
  const active = document.activeElement;
  const typing =
    active !== null &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT");
  if (!typing) void route();
}

function startDeadlineTimer(): void {
  stopDeadlineTimer();
  // A baseline read up front, so the first tick a minute in
  // can already tell a crossing from a standing state.
  void (async () => {
    try {
      lastTickEpoch = await app.indexer.epoch();
    } catch {
      /* the baseline stays unknown and no crossing is claimed */
    }
  })();
  deadlineTimer = setInterval(() => void tickDeadlines(), 60_000);
}

// The screens' titles, keyed by route. The tender and circle
// routes are records: they are opened from a list or by
// address, not from the sidebar, so they carry a title and a
// purpose line but no nav entry of their own.
const TITLES: Record<string, string> = {
  overview: "circles and tenders",
  tender: "tender record",
  circle: "circle record",
  create: "start a circle or tender",
  seller: "bid and reveal",
  approvals: "approvals",
  verify: "verify a tender",
  results: "results",
  help: "help",
};

// The sidebar, in the order a tender actually runs: see the
// circles and tenders, start one, bid on it, approve what it
// needs, then read the proof, with the self-check and the
// help behind the proof. Each entry carries one plain line
// saying what the visitor does or finds there, so the
// navigation alone decodes the product.
const NAV: { key: string; label: string; helper: string }[] = [
  {
    key: "overview",
    label: "circles and tenders",
    helper: "every circle and tender this browser can see, with its live state",
  },
  {
    key: "create",
    label: "start a circle or tender",
    helper: "form the buying group, then lock its tender's rules and budget",
  },
  {
    key: "seller",
    label: "bid and reveal",
    helper: "sellers: commit a sealed bid, then open it in the reveal window",
  },
  {
    key: "approvals",
    label: "approvals",
    helper: "what is waiting for your signature: overrides, deliveries, disputes",
  },
  {
    key: "results",
    label: "results",
    helper: "the proof: finished tenders, checked by two verifiers, with receipts",
  },
  {
    key: "verify",
    label: "verify a tender",
    helper: "re-run the checks on any tender yourself, live, no wallet needed",
  },
  {
    key: "help",
    label: "help",
    helper: "the questions every new circle asks, answered plainly",
  },
];

// One plain line at the top of every screen, saying what the
// screen is for, so no screen needs guessing at.
const PURPOSES: Record<string, string> = {
  overview:
    "every circle and tender this browser can see, each with its live state. open a tender to read its whole record and act on it.",
  tender:
    "one tender's whole record: its locked rules, its money, every bid and reveal, and the actions its state allows.",
  circle:
    "one buying circle: its approvers, its treasury, its tenders, and what the circle can do.",
  create:
    "form a buying circle first, then create a tender for it. the rules and the budget lock before bidding opens, and the budget is escrowed in the same step.",
  seller:
    "commit a sealed bid with its bond while bidding is open, then come back in the reveal window and open it. only opened bids can win, and a bid nobody opens stays sealed.",
  approvals:
    "everything waiting for your signature: override proposals, deliveries to confirm, disputes to settle, and what needs you as a seller or a winner.",
  verify:
    "check any tender yourself. the verifier recomputes every check from the public record, in your browser. no wallet needed.",
  results:
    "the proof: the finished season tenders, each checked by two verifiers, with its receipt, the money ledger, and the attacks the chain refused.",
  help: "the questions a new circle asks in its first months, answered from how the product actually behaves.",
};

async function route(): Promise<void> {
  const hash = location.hash || "#/";
  stopDeadlineTimer();
  root.replaceChildren();
  window.scrollTo(0, 0);
  if (hash === "#/" || hash === "" || hash.startsWith("#feed") || hash.startsWith("#how") || hash.startsWith("#proof")) {
    await renderLanding(app, root, go);
    if (hash.length > 2) {
      document.getElementById(hash.slice(1))?.scrollIntoView();
    }
    return;
  }
  const parts = hash.replace(/^#\/app\/?/, "").split("/");
  const screen = parts[0] || "overview";
  const param = parts.slice(1).join("/");

  const frame = el("div", "app");
  const side = el("aside", "side");
  const logo = el("a", "logo", "asiri");
  logo.append(el("span", "dot", "."));
  logo.href = "#/";
  side.append(logo);

  const seg = el("div", "seg");
  for (const n of ["mainnet", "esmeralda"] as const) {
    const b = el("button", n === app.network ? "on" : undefined, n);
    b.addEventListener("click", () => {
      void (async () => {
        app.setNetwork(n);
        if (app.wallet.account) {
          // Bring the wallet along where it lets us, then
          // re-derive the identity on the new network: the
          // balance setNetwork cleared belongs to the old one.
          // A wallet that stays on the old network leaves the
          // balance unread, and the submit guard will say why
          // a write cannot go ahead.
          const net = await app.wallet.refreshNetwork();
          if (net && net !== n) {
            try {
              await app.wallet.switchNetwork(n);
            } catch {
              /* the wallet stayed where it was */
            }
          }
          await app.deriveIdentity();
        }
        void route();
      })();
    });
    seg.append(b);
  }
  side.append(seg);

  const nav = el("nav", "snav");
  for (const item of NAV) {
    const b = el("button", item.key === screen ? "on" : undefined);
    b.append(
      el("span", "nav-label", item.label),
      el("span", "nav-help", item.helper),
    );
    b.addEventListener("click", () => go(`#/app/${item.key}`));
    nav.append(b);
  }
  side.append(nav);

  const walletCard = el("div", "wallet-card");
  const renderWallet = () => {
    walletCard.replaceChildren();
    const row1 = el("div", "row");
    row1.append(el("span", undefined, "network"), el("b", undefined, app.indexer.cfg.label));
    walletCard.append(row1);
    if (app.wallet.account) {
      // The account can be connected while the wallet sits on
      // another network (the switch was declined at connect, or
      // the user switched inside the wallet afterwards). Say so
      // on the card: actions are blocked until the two match.
      if (app.wallet.network && app.wallet.network !== app.network) {
        walletCard.append(
          el(
            "div",
            "small mt",
            `your wallet is on ${app.wallet.network}. the app is showing ${app.indexer.cfg.label}, and actions are blocked until the two match. switch the network in your wallet, or switch the app's network.`,
          ),
        );
      }
      const row2 = el("div", "row");
      row2.append(el("span", undefined, "account"), el("b", undefined, short(app.wallet.account)));
      walletCard.append(row2);
      if (app.myKey) {
        const row3 = el("div", "row");
        row3.append(el("span", undefined, "your public key"), el("b", undefined, short(app.myKey)));
        walletCard.append(row3);
        const copyBtn = el("button", "btn btn-white btn-sm btn-block mt", "copy my public key");
        copyBtn.addEventListener("click", () => {
          void (async () => {
            try {
              await navigator.clipboard.writeText(app.myKey!);
              copyBtn.textContent = "copied. share it with your circle.";
            } catch {
              copyBtn.textContent = app.myKey!;
            }
          })();
        });
        walletCard.append(copyBtn);
        walletCard.append(
          el("div", "small mt", "your circle needs this key to make you an approver or to pay you as a seller."),
        );
      }
      if (app.balance !== null) {
        const row4 = el("div", "row");
        row4.append(el("span", undefined, "balance"), el("b", undefined, `${tari(app.balance)} tari`));
        walletCard.append(row4);
      }
      if (fundingApplies(app.balance)) {
        walletCard.append(el("div", "small mt", fundingGuidance(app.network)));
      }
      const disconnectBtn = el("button", "btn btn-white btn-sm btn-block mt", "disconnect wallet");
      disconnectBtn.addEventListener("click", () => {
        app.disconnect();
        renderWallet();
      });
      walletCard.append(disconnectBtn);
    } else {
      const connectBtn = el("button", "btn btn-blue btn-sm btn-block mt", "connect wallet");
      connectBtn.addEventListener("click", () => {
        void (async () => {
          if (!(await waitForProvider())) {
            connectBtn.textContent = "no wallet found. install sapient or open the tari web wallet.";
            return;
          }
          try {
            await app.wallet.connect();
          } catch (e) {
            // A refusal in the wallet is the user's own call,
            // not a failure: say which one happened.
            connectBtn.textContent = looksDeclined(e)
              ? "you declined the connection in your wallet. approve it there to connect."
              : "the wallet did not connect. try again.";
            return;
          }
          // The account is connected from here. Aligning the
          // wallet's network can still be declined, and that
          // is a third case, not a failed connection: the card
          // renders connected, and its mismatch note (rendered
          // from the wallet's network) says what is off.
          if (app.wallet.network && app.wallet.network !== app.network) {
            try {
              await app.wallet.switchNetwork(app.network);
            } catch {
              /* the wallet stayed on its own network */
            }
          }
          await app.deriveIdentity();
          renderWallet();
        })();
      });
      walletCard.append(connectBtn);
      if (!hasProvider()) {
        const hint = el("div", "small mt", "writes need a wallet. reading and verifying never do.");
        walletCard.append(hint);
      }
    }
  };
  renderWallet();
  side.append(walletCard);
  frame.append(side);

  const main = el("main", "main");
  const head = el("div", "main-head");
  // The screen's title is the page's one top-level heading,
  // and the boxes below it are h2 sections under it, so the
  // heading order never skips a level. (It rendered as an h2
  // with h3 boxes until the accessibility pass: same styles,
  // the stylesheet names both levels.)
  head.append(el("h1", undefined, TITLES[screen] ?? "circles and tenders"));
  head.append(el("span", "pill pill-tint", networkPill(app.indexer.cfg)));
  head.append(el("span", "spacer"));
  const newBtn = el("button", "btn btn-blue btn-sm", "new tender");
  newBtn.addEventListener("click", () => go("#/app/create"));
  head.append(newBtn);
  main.append(head);
  // The screen's purpose, stated in one plain line under its
  // title, so a first-time visitor never has to guess what
  // the screen is for.
  const purpose = PURPOSES[screen];
  if (purpose) main.append(el("p", "screen-purpose", purpose));
  const content = el("div");
  main.append(content);
  frame.append(main);
  root.append(frame);

  // A note left by the previous screen about a transaction it
  // submitted: shown once, above whatever this screen renders.
  if (app.flash) {
    const f = app.flash;
    app.flash = null;
    const note = el("div", "notice", f.text);
    // The note reports how a submitted transaction stands: a
    // status region, so it is announced when the screen opens.
    setAria(note, "role", "status");
    if (f.txId) {
      note.append(document.createTextNode(" transaction "));
      note.append(explorerLink(app, "tx", f.txId));
      note.append(document.createTextNode("."));
    }
    content.append(note);
  }

  try {
    switch (screen) {
      case "overview":
        await renderOverview(app, content, go);
        break;
      case "tender":
        if (param) await renderTender(app, content, decodeURIComponent(param), go);
        else content.append(el("div", "empty", "open a tender from circles and tenders."));
        break;
      case "circle":
        if (param) await renderCircle(app, content, decodeURIComponent(param), go);
        else content.append(el("div", "empty", "open a circle from circles and tenders."));
        break;
      case "create":
        await renderCreate(app, content, go);
        break;
      case "seller":
        await renderSeller(app, content, go);
        break;
      case "approvals":
        await renderApprovals(app, content, go);
        break;
      case "verify":
        await renderVerify(app, content, param ? decodeURIComponent(param) : undefined);
        break;
      case "results":
        await renderResults(app, content, go);
        break;
      case "help":
        await renderHelp(app, content);
        break;
      default:
        await renderOverview(app, content, go);
    }
  } catch (e) {
    const box = el("div", "err", e instanceof Error ? e.message : String(e));
    setAria(box, "role", "alert");
    content.append(box);
  }
  startDeadlineTimer();
}

window.addEventListener("hashchange", () => void route());
void route();
