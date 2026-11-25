// Overview: the tenders this browser can see, from the featured
// circle on the selected network, from watched addresses, and
// from network discovery, each with its live state. Plus
// open-by-address for anything else. The watched and featured
// content renders first; discovery, which replays the
// network's event record and can take a while, fills in behind
// it and never blocks it.
import { App, el, errorBox, setAria, short } from "../app";
import {
  DISCOVERY_FRESH_MS,
  discoverNetwork,
  discoveryAgeText,
  readDiscoveryCache,
  writeDiscoveryCache,
  type DiscoveredSet,
} from "../discovery";
import { templatesConfigured } from "../indexer";
import {
  decodeCircleState,
  decodeTenderState,
  plainAddressError,
  type CircleComponentState,
} from "../state";
import { deadlineSpan } from "../time";
import { actionButton, box, money, notice, BUILDER_RUN_LABEL } from "./common";

interface TenderMark {
  source: string;
  discovered: boolean;
}

export async function renderOverview(
  app: App,
  root: HTMLElement,
  go: (hash: string) => void,
): Promise<void> {
  const wrap = el("div");
  root.append(wrap);

  const openBox = box("open a tender or circle by address");
  const input = el("input");
  input.type = "text";
  input.placeholder = "component_…";
  input.className = "mono addr";
  // The box heading names this field's purpose; the input
  // itself carries it as its accessible name.
  setAria(input, "aria-label", "tender or circle component address");
  const row = el("div", "srow");
  const openBtn = el("button", "btn btn-blue btn-sm", "open");
  openBtn.addEventListener("click", () => {
    const addr = input.value.trim();
    if (!addr.startsWith("component_")) return;
    void (async () => {
      // Try tender first, then circle. When both fail, the
      // first attempt's problem is the one to report: the
      // second attempt's decoder complaint can misname what
      // is actually wrong with the address.
      let firstError: unknown = null;
      try {
        const sub = await app.indexer.substate(addr);
        if (!sub) throw new Error("that component is down");
        const t = decodeTenderState(sub.value);
        app.watch("tenders", addr);
        go(`#/app/tender/${addr}`);
        void t;
        return;
      } catch (e) {
        firstError = e;
      }
      try {
        const sub = await app.indexer.substate(addr);
        if (!sub) throw new Error("that component is down");
        decodeCircleState(sub.value);
        app.watch("circles", addr);
        go(`#/app/circle/${addr}`);
      } catch {
        errorBox(wrap, new Error(plainAddressError(addr, firstError)));
      }
    })();
  });
  row.append(input, openBtn);
  openBox.body.append(row);
  wrap.append(openBox.box);

  const listBox = box("tenders", app.indexer.cfg.label);
  listBox.body.append(el("div", "empty", "reading the network…"));
  wrap.append(listBox.box);

  const discoveryBox = box("discovery", app.indexer.cfg.label);
  wrap.append(discoveryBox.box);

  /**
   * Render the tenders list. The featured circle and watched
   * addresses always take part; a discovery set, when one is
   * at hand, adds its circles and tenders, marked as
   * discovered. Returns the circle states it decoded, so the
   * discovery section can name the circles it lists without
   * reading them twice.
   */
  const renderList = async (
    discovered: DiscoveredSet | null,
  ): Promise<Map<string, CircleComponentState>> => {
    const tenders = new Map<string, TenderMark>(); // address -> mark
    const featured = app.indexer.cfg.featuredCircle;
    const watched = app.watched();
    const circleMarks = new Map<string, boolean>(); // address -> discovered?
    if (featured) circleMarks.set(featured, false);
    for (const c of watched.circles)
      if (!circleMarks.has(c)) circleMarks.set(c, false);
    if (discovered)
      for (const c of discovered.circles)
        if (!circleMarks.has(c)) circleMarks.set(c, true);
    const circleStates = new Map<string, CircleComponentState>();
    let featuredListed = false;
    for (const [c, isDiscovered] of circleMarks) {
      try {
        const sub = await app.indexer.substate(c);
        if (!sub) continue;
        const circle = decodeCircleState(sub.value);
        circleStates.set(c, circle);
        for (const t of circle.tenders) {
          const mark: TenderMark = { source: circle.name, discovered: isDiscovered };
          const existing = tenders.get(t);
          // A tender known through a watched or featured
          // circle keeps that standing when discovery also
          // finds it: discovery adds reach, it does not
          // relabel what the browser already knew.
          if (!existing || (existing.discovered && !isDiscovered))
            tenders.set(t, mark);
          if (c === featured) featuredListed = true;
        }
      } catch {
        /* an unreadable circle simply contributes nothing */
      }
    }
    for (const t of watched.tenders) {
      if (!tenders.has(t)) tenders.set(t, { source: "watched", discovered: false });
    }
    if (discovered)
      for (const t of discovered.tenders)
        if (!tenders.has(t))
          tenders.set(t, { source: "discovered on the network", discovered: true });
    listBox.body.replaceChildren();
    if (tenders.size === 0) {
      listBox.body.append(
        el(
          "div",
          "empty",
          app.network === "mainnet"
            ? "no public tenders are listed on mainnet yet. switch to the esmeralda testnet to see the live trial, or open a tender by address above."
            : "no tenders found yet on this network. open one by address above, or create the first circle from start a circle or tender.",
        ),
      );
      return circleStates;
    }
    let epoch = 0;
    try {
      epoch = await app.indexer.epoch();
    } catch {
      /* deadlines still render without the current epoch */
    }
    for (const [addr, mark] of tenders) {
      try {
        const sub = await app.indexer.substate(addr);
        if (!sub) continue;
        const t = decodeTenderState(sub.value);
        const rowBtn = el("button", "trow");
        const name = el("span", undefined, t.circleName || "sealed tender");
        const pill = el("span", "pill pill-tint", t.state.toLowerCase());
        const meta = el("span", "tm");
        const capLine = el("b", undefined, money(t.rules.budgetCap));
        // The row title is already the circle's name, so the
        // detail line drops it when the source names the same
        // circle, and keeps only the provenance that adds
        // information: watched, or discovered on the network.
        const parts: string[] = [];
        if (mark.source !== t.circleName) parts.push(mark.source);
        if (mark.discovered && mark.source !== "discovered on the network")
          parts.push("discovered on the network");
        parts.push(`${t.commitments.length} bids in`);
        meta.append(capLine, document.createTextNode(parts.join(" · ")));
        if (t.bidDeadline) {
          meta.append(document.createTextNode(" · bids close "));
          meta.append(deadlineSpan(app.network, t.bidDeadline, epoch));
        }
        rowBtn.append(name, pill, meta);
        rowBtn.title = addr;
        rowBtn.addEventListener("click", () => go(`#/app/tender/${addr}`));
        listBox.body.append(rowBtn);
      } catch {
        /* skip tenders that do not decode */
      }
    }
    if (!listBox.body.children.length) {
      listBox.body.append(
        el("div", "empty", "the listed tenders could not be read right now."),
      );
    } else if (featuredListed) {
      // The featured circle's tenders carry their provenance
      // where they are listed, in the receipts' own words, not
      // only inside the receipt downloads.
      listBox.body.append(
        el("div", "small mt", `tenders from the featured circle are ${BUILDER_RUN_LABEL}.`),
      );
    }
    return circleStates;
  };

  // The discovery section: what discovery is, what the last
  // pass found and when, the circles it found, and the
  // refresh. On a network with no templates published there
  // is nothing running them to find, and the section says so
  // instead of offering a read that cannot find anything.
  if (!templatesConfigured(app.indexer.cfg)) {
    discoveryBox.body.append(
      notice(
        `there is nothing to discover on ${app.indexer.cfg.label} yet: the asiri templates are not published there, so no circles or tenders run them. switch to the esmeralda testnet to see discovery over its live network.`,
      ),
    );
    await renderList(null);
    return;
  }
  discoveryBox.body.append(
    notice(
      "discovery reads this network's public event record for the asiri templates and confirms every candidate against the chain, so it can find circles and tenders this browser has never opened. it finds every component that has emitted an event, and creating a circle or a tender emits one. a full read replays the templates' whole history, so it can take a while on a large network, and reads run one at a time.",
    ),
  );
  const discoveryStatus = el("div", "small mt", "");
  setAria(discoveryStatus, "role", "status");
  const discoveredCircles = el("div");
  let running = false;
  let shown: DiscoveredSet | null = readDiscoveryCache(app.network);

  const showSet = (
    set: DiscoveredSet,
    circleStates: Map<string, CircleComponentState>,
  ): void => {
    discoveryStatus.textContent =
      `discovery found ${set.circles.length} ${set.circles.length === 1 ? "circle" : "circles"} ` +
      `and ${set.tenders.length} ${set.tenders.length === 1 ? "tender" : "tenders"} on this network, ` +
      `read ${discoveryAgeText(set.at)}. the tenders are in the list above, marked as discovered.`;
    discoveredCircles.replaceChildren();
    for (const c of set.circles) {
      const state = circleStates.get(c);
      const rowEl = el("div", "commit-row");
      rowEl.append(
        el("span", undefined, `${state?.name || short(c)} · discovered on the network`),
      );
      rowEl.append(el("span", "spacer"));
      const open = el("button", "btn btn-blue btn-sm", "open circle");
      open.addEventListener("click", () => go(`#/app/circle/${c}`));
      rowEl.append(open);
      discoveredCircles.append(rowEl);
    }
  };

  const runDiscovery = async (): Promise<void> => {
    if (running) return;
    running = true;
    discoveryStatus.textContent = "reading the network's event record…";
    try {
      const set = await discoverNetwork(app.indexer, {
        onEvent: (n) => {
          discoveryStatus.textContent = `reading the network's event record… ${n} events read so far.`;
        },
      });
      writeDiscoveryCache(app.network, set);
      shown = set;
      const states = await renderList(set);
      showSet(set, states);
    } catch {
      discoveryStatus.textContent = shown
        ? `discovery could not read the network this time. the list above still shows the last good read, from ${discoveryAgeText(shown.at)}, and what this browser has watched.`
        : "discovery could not read the network this time. the list above shows the featured circle and what this browser has watched, and nothing was changed.";
    } finally {
      running = false;
    }
  };

  const refreshBtn = actionButton(
    "read the network again",
    "btn-white btn-sm",
    () => runDiscovery(),
    (e) => errorBox(wrap, e),
  );
  discoveryBox.body.append(discoveryStatus, discoveredCircles, refreshBtn);

  // The watched and featured content renders first, with the
  // cached discovery set when this browser holds one.
  // Discovery itself runs behind it: at once when there is no
  // cache or the cache has gone stale, and on request
  // otherwise.
  const states = await renderList(shown);
  if (shown) showSet(shown, states);
  if (!shown || Date.now() - shown.at > DISCOVERY_FRESH_MS) void runDiscovery();
}

export function tenderRowLabel(address: string): string {
  return short(address);
}
