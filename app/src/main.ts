// Entry point and hash router. Two views: the landing page and
// the app frame (sidebar, network switch, wallet card, screens).
import { App, cap, el, explorerLink, setAria, short, tari } from "./app";
import type { TxStage } from "./app";
import { TxModal } from "./txmodal";
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

// The wallet card's renderer, refreshed when the wallet gate
// modal connects from its own button: the connection shows in
// the sidebar without a reload. Reassigned on every route, so
// it always points at the current frame's card.
let refreshWalletCard: (() => void) | null = null;
if (
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function"
) {
  window.addEventListener("asiri:wallet-connected", () => {
    refreshWalletCard?.();
  });
  // A transaction just landed, or the indexer caught up with
  // one: re-render the current screen so its numbers come
  // from the chain as it stands now, not from when the page
  // first loaded. While the visitor is typing in a field the
  // refresh waits, so it never wipes what they are entering.
  window.addEventListener("asiri:refresh", () => {
    const active = document.activeElement;
    const typing =
      active !== null &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT");
    if (!typing) void route();
  });
}

// The transaction status modal: one overlay for the whole
// app, narrating every action while it runs. It is created
// once here and answers the stage events the app dispatches
// from every submit, so no action needs its own popup.
const txModal = new TxModal();
if (
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function"
) {
  window.addEventListener("asiri:tx-stage", (e) => {
    const detail = (e as Event & { detail?: TxStage }).detail;
    if (detail) txModal.show(app, detail);
  });
}

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
  overview: "Circles and tenders",
  tender: "tender record",
  circle: "circle record",
  create: "Start a circle or tender",
  seller: "bid and reveal",
  approvals: "approvals",
  verify: "Verify a tender",
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
    label: "Circles and tenders",
    helper: "Every circle and tender this browser can see, with its live state",
  },
  {
    key: "create",
    label: "Start a circle or tender",
    helper: "Form the buying group, then lock its tender's rules and budget",
  },
  {
    key: "seller",
    label: "Bid and reveal",
    helper: "Sellers: commit a sealed bid, then open it in the reveal window",
  },
  {
    key: "approvals",
    label: "Approvals",
    helper: "What is waiting for your signature: overrides, deliveries, disputes",
  },
  {
    key: "results",
    label: "Results",
    helper: "The proof: finished tenders, checked by two verifiers, with receipts",
  },
  {
    key: "verify",
    label: "Verify a tender",
    helper: "Re-run the checks on any tender yourself, live, no wallet needed",
  },
  {
    key: "help",
    label: "Help",
    helper: "The questions every new circle asks, answered plainly",
  },
];

// One plain line at the top of every screen, saying what the
// screen is for, so no screen needs guessing at.
const PURPOSES: Record<string, string> = {
  overview:
    "Every circle and tender this browser can see, each with its live state. Open a tender to read its whole record and act on it.",
  tender:
    "one tender's whole record: its locked rules, its money, every bid and reveal, and the actions its state allows.",
  circle:
    "one buying circle: its approvers, its treasury, its tenders, and what the circle can do.",
  create:
    "Form a buying circle first, then create a tender for it. The rules and the budget lock before bidding opens, and the budget is escrowed in the same step.",
  seller:
    "commit a sealed bid with its bond while bidding is open, then come back in the reveal window and open it. only opened bids can win, and a bid nobody opens stays sealed.",
  approvals:
    "Everything waiting for your signature: override proposals, deliveries to confirm, disputes to settle, and what needs you as a seller or a winner.",
  verify:
    "Check any tender yourself. The verifier recomputes every check from the public record, in your browser. No wallet needed.",
  results:
    "The proof: the finished season tenders, each checked by two verifiers, with its receipt, the money ledger, and the attacks the chain refused.",
  help: "The questions a new circle asks in its first months, answered from how the product actually behaves.",
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
  const logo = el("a", "logo", "Asiri");
  logo.append(el("span", "dot", "."));
  logo.href = "#/";
  side.append(logo);

  // The mobile top bar: ASIRI on the left, the hamburger on
  // the right. Hidden on desktop by the stylesheet. The
  // network switch, the nav and the wallet card live inside
  // .side-menu, which vanishes (display: contents) on desktop
  // so they lay out exactly as before, and drops down from
  // the bar as one panel on a phone.
  const sideTop = el("div", "side-top");
  const sideLogo = el("a", "lp-logo", "ASIRI");
  sideLogo.href = "#/";
  const sideBurger = el("button", "burger");
  setAria(sideBurger, "aria-label", "Open the menu");
  setAria(sideBurger, "aria-expanded", "false");
  sideBurger.append(el("span"), el("span"), el("span"));
  sideTop.append(sideLogo, sideBurger);
  side.append(sideTop);
  const menu = el("div", "side-menu");
  side.append(menu);
  const setSideMenuOpen = (open: boolean): void => {
    // The class string is edited directly: classList.toggle
    // exists in a real browser, and the unit test fake DOM
    // implements add and contains only, so the string form
    // works in both.
    const parts = side.className.split(/\s+/).filter(Boolean);
    const has = parts.includes("menu-open");
    if (open && !has) side.className = [...parts, "menu-open"].join(" ");
    if (!open && has)
      side.className = parts.filter((c) => c !== "menu-open").join(" ");
    setAria(sideBurger, "aria-expanded", open ? "true" : "false");
    setAria(sideBurger, "aria-label", open ? "Close the menu" : "Open the menu");
  };
  sideBurger.addEventListener("click", () => {
    setSideMenuOpen(!side.className.split(/\s+/).includes("menu-open"));
  });

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
  menu.append(seg);

  const nav = el("nav", "snav");
  for (const item of NAV) {
    const b = el("button", item.key === screen ? "on" : undefined);
    // The helper line shows as a hover and focus tooltip, so it
    // leaves the button's visible text; the full label and
    // helper stay the button's accessible name.
    setAria(b, "aria-label", `${item.label}: ${item.helper}`);
    b.append(
      el("span", "nav-label", item.label),
      el("span", "nav-help", item.helper),
    );
    b.addEventListener("click", () => go(`#/app/${item.key}`));
    nav.append(b);
  }
  // Tapping a nav link closes the mobile menu at once: the
  // route rebuilds the frame anyway, and the immediate close
  // reads faster than waiting for it.
  nav.addEventListener("click", () => setSideMenuOpen(false));
  menu.append(nav);

  const walletCard = el("div", "wallet-card");
  const renderWallet = () => {
    walletCard.replaceChildren();
    if (app.wallet.account) {
      // Connected state, one left edge, top to bottom:
      // status, balance, account, public key, disconnect.
      // Labels sit above their values, never beside them, so
      // a long address or key cannot wrap its label with it.
      // The disconnected state below is untouched.
      const mismatched =
        !!app.wallet.network && app.wallet.network !== app.network;
      const head = el("div", "wn-head");
      head.append(el("span", "wn-dot"));
      head.append(el("span", "wn-status", "Connected"));
      head.append(el("span", "pill pill-tint", app.indexer.cfg.label));
      walletCard.append(head);
      if (mismatched) {
        // The account can be connected while the wallet sits
        // on another network (the switch was declined at
        // connect, or the user switched inside the wallet
        // afterwards). One compact warning under the header,
        // not a paragraph between the rows, and the balance
        // stays hidden until the two match: a figure read
        // against the wrong network must not stand as this
        // network's balance.
        walletCard.append(
          el(
            "div",
            "wn-warn",
            `Your wallet is on ${app.wallet.network}. Actions are blocked until the two match. Switch the network in your wallet, or switch the app's network.`,
          ),
        );
      }
      if (!mismatched && app.balance !== null) {
        walletCard.append(el("div", "wn-div"));
        walletCard.append(el("div", "wn-label", "balance"));
        const bal = el("div", "wn-balance", tari(app.balance));
        bal.append(el("span", undefined, " tari"));
        walletCard.append(bal);
        if (fundingApplies(app.balance)) {
          walletCard.append(el("div", "wn-note", fundingGuidance(app.network)));
        }
      }
      walletCard.append(el("div", "wn-div"));
      const accountField = el("div", "wn-field");
      accountField.append(el("div", "wn-label", "account"));
      const accountRow = el("div", "wn-value-row");
      const accountValue = el("span", "wn-value", short(app.wallet.account));
      setAria(accountValue, "title", app.wallet.account);
      accountRow.append(accountValue);
      accountField.append(accountRow);
      walletCard.append(accountField);
      if (app.myKey) {
        const keyField = el("div", "wn-field");
        keyField.append(el("div", "wn-label", "Your public key"));
        const keyRow = el("div", "wn-value-row");
        const keyValue = el("span", "wn-value", short(app.myKey));
        setAria(keyValue, "title", app.myKey);
        const copyBtn = el("button", "wn-copy", "Copy");
        setAria(copyBtn, "aria-label", "Copy my public key");
        copyBtn.addEventListener("click", () => {
          void (async () => {
            try {
              await navigator.clipboard.writeText(app.myKey!);
              copyBtn.textContent = "Copied";
            } catch {
              // A failed copy must not spill the full key into
              // the button: the tidy row stays tidy.
              copyBtn.textContent = "Copy failed";
            }
          })();
        });
        keyRow.append(keyValue, copyBtn);
        keyField.append(keyRow);
        keyField.append(
          el("div", "wn-note", "Share this key with your circle to join or get paid."),
        );
        walletCard.append(keyField);
      }
      const disconnectBtn = el("button", "wn-disconnect", "Disconnect");
      disconnectBtn.addEventListener("click", () => {
        app.disconnect();
        renderWallet();
      });
      walletCard.append(disconnectBtn);
    } else {
      // Disconnected state, unchanged: one network row, one
      // blue button. The connected state above carries the
      // network in its header instead.
      const row1 = el("div", "row");
      row1.append(el("span", undefined, "network"), el("b", undefined, app.indexer.cfg.label));
      walletCard.append(row1);
      const connectBtn = el("button", "btn btn-blue btn-sm btn-block mt", "connect wallet");
      connectBtn.addEventListener("click", () => {
        void (async () => {
          if (!(await waitForProvider())) {
            connectBtn.textContent = "No wallet found. Install Sapient or open the Tari web wallet.";
            return;
          }
          try {
            await app.wallet.connect();
          } catch (e) {
            // A refusal in the wallet is the user's own call,
            // not a failure: say which one happened.
            connectBtn.textContent = looksDeclined(e)
              ? "You declined the connection in your wallet. Approve it there to connect."
              : "The wallet did not connect. Try again.";
            return;
          }
          // Remember the connection, so a page refresh
          // reconnects it instead of dropping it.
          if (app.wallet.account) app.rememberWallet(app.wallet.account);
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
        const hint = el("div", "small mt", "Writes need a wallet. Reading and verifying never do.");
        walletCard.append(hint);
      }
    }
  };
  renderWallet();
  menu.append(walletCard);
  refreshWalletCard = renderWallet;
  frame.append(side);

  const main = el("main", "main");
  const head = el("div", "main-head");
  // The screen's title is the page's one top-level heading,
  // and the boxes below it are h2 sections under it, so the
  // heading order never skips a level. (It rendered as an h2
  // with h3 boxes until the accessibility pass: same styles,
  // the stylesheet names both levels.)
  head.append(el("h1", undefined, cap(TITLES[screen] ?? "Circles and tenders")));
  head.append(el("span", "pill pill-tint", networkPill(app.indexer.cfg)));
  head.append(el("span", "spacer"));
  const newBtn = el("button", "btn btn-blue btn-sm", "New tender");
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
        else content.append(el("div", "empty", "Open a tender from circles and tenders."));
        break;
      case "circle":
        if (param) await renderCircle(app, content, decodeURIComponent(param), go);
        else content.append(el("div", "empty", "Open a circle from circles and tenders."));
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

// Startup: if the wallet was connected before a refresh, ask
// the wallet for its accounts again. A wallet that still
// lists this site returns them without prompting, so the
// connection survives the refresh. A wallet that no longer
// authorizes the site, or a declined prompt, leaves the app
// disconnected, and the remembered account is forgotten.
void (async () => {
  if (app.rememberedAccount() && (await waitForProvider())) {
    try {
      await app.wallet.connect();
      await app.deriveIdentity();
    } catch {
      app.disconnect();
    }
  }
  void route();
})();
