// Network discovery: finding every circle and tender that
// runs the asiri templates on the selected network, including
// ones this browser has never opened. The indexers expose no
// list of components, so discovery replays the indexer's
// event stream per template (see Indexer.templateEventComponents),
// collects the component ids the events name, and confirms
// each candidate by reading its substate and checking the
// template it runs and that it decodes. A component is found
// only if it has emitted at least one event; creation emits
// one for both templates, so in practice the found set is the
// whole set, but the promise the screens make is the weaker
// one. The confirmed set is cached in this browser per
// network, with the time it was read, and the screens state
// that age where the set is shown.
import {
  Indexer,
  templatesConfigured,
  type NetworkName,
} from "./indexer";
import {
  decodeCircleState,
  decodeTenderState,
  splitComponent,
  type CircleComponentState,
  type TenderComponentState,
} from "./state";
import { durationText } from "./time";

export interface DiscoveredSet {
  // When the set was read, in epoch milliseconds.
  at: number;
  circles: string[];
  tenders: string[];
}

const CACHE_PREFIX = "asiri:discovery:";

/**
 * Confirm candidates one at a time: read each and keep the
 * ones the read accepts. A candidate the read rejects (null)
 * is dropped without a word: it was only ever a name in an
 * event, and the substate read is the authority on what it
 * actually is. A read that fails outright throws through, so
 * the pass fails rather than caching a set that is short a
 * component it could not check. Sequential on purpose: the
 * indexer is a shared public service, and the counts are
 * small.
 */
export async function confirmComponents<S>(
  candidates: string[],
  read: (address: string) => Promise<S | null>,
): Promise<Map<string, S>> {
  const out = new Map<string, S>();
  for (const addr of candidates) {
    const state = await read(addr);
    if (state) out.set(addr, state);
  }
  return out;
}

/** Confirm one circle candidate: it must run the circle
 * template and decode as a circle. A candidate that is not
 * live, runs another template, or does not decode as a
 * circle is rejected (null); a substate read that fails
 * throws through, so the pass does not silently lose it. */
export async function confirmCircle(
  indexer: Indexer,
  address: string,
): Promise<CircleComponentState | null> {
  const sub = await indexer.substate(address);
  if (!sub) return null;
  try {
    const expected = indexer.cfg.circleTemplate;
    if (expected && splitComponent(sub.value).template !== expected)
      return null;
    return decodeCircleState(sub.value);
  } catch {
    return null;
  }
}

/** Confirm one tender candidate: it must run the tender
 * template and decode as a tender, with the same rejection
 * and failure rules as a circle candidate. */
export async function confirmTender(
  indexer: Indexer,
  address: string,
): Promise<TenderComponentState | null> {
  const sub = await indexer.substate(address);
  if (!sub) return null;
  try {
    const expected = indexer.cfg.tenderTemplate;
    if (expected && splitComponent(sub.value).template !== expected)
      return null;
    return decodeTenderState(sub.value);
  } catch {
    return null;
  }
}

/**
 * One full discovery pass over the selected network: the
 * circle template's replay, then the tender template's, one
 * stream at a time, each candidate confirmed by its substate
 * read. Resolves with the confirmed set; rejects when a
 * replay could not be read from any indexer, so a half-found
 * set is never cached as if it were the network's whole
 * record. A network with no templates configured has nothing
 * running the templates and is rejected before any stream
 * opens, with the reason the screens show.
 */
export async function discoverNetwork(
  indexer: Indexer,
  opts: { onEvent?: (eventsSoFar: number) => void } = {},
): Promise<DiscoveredSet> {
  const cfg = indexer.cfg;
  if (!templatesConfigured(cfg))
    throw new Error(
      `the asiri templates are not published on ${cfg.label} yet, so there is nothing to discover`,
    );
  let eventsSoFar = 0;
  const onEvent = (): void => {
    eventsSoFar++;
    opts.onEvent?.(eventsSoFar);
  };
  const circleCandidates = await indexer.templateEventComponents(
    cfg.circleTemplate!,
    { onEvent },
  );
  const circles = await confirmComponents(circleCandidates, (a) =>
    confirmCircle(indexer, a),
  );
  const tenderCandidates = await indexer.templateEventComponents(
    cfg.tenderTemplate!,
    { onEvent },
  );
  const tenders = await confirmComponents(tenderCandidates, (a) =>
    confirmTender(indexer, a),
  );
  return {
    at: Date.now(),
    circles: [...circles.keys()],
    tenders: [...tenders.keys()],
  };
}

/** The cached discovery set for a network, or null when this
 * browser has never completed a pass there. Stored values are
 * read defensively, the way the watched lists are: anything
 * that is not the expected shape reads as no cache. */
export function readDiscoveryCache(network: NetworkName): DiscoveredSet | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + network);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      at?: unknown;
      circles?: unknown;
      tenders?: unknown;
    };
    const list = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((a): a is string => typeof a === "string")
        : [];
    if (typeof parsed.at !== "number" || !Number.isFinite(parsed.at))
      return null;
    // A stamp ahead of now, beyond a small allowance for a
    // skewed clock, is corruption rather than a fresh read:
    // its age would never grow, and it would hold the
    // automatic re-read off for good.
    if (parsed.at > Date.now() + 60_000) return null;
    return {
      at: parsed.at,
      circles: list(parsed.circles),
      tenders: list(parsed.tenders),
    };
  } catch {
    return null;
  }
}

export function writeDiscoveryCache(
  network: NetworkName,
  set: DiscoveredSet,
): void {
  try {
    localStorage.setItem(CACHE_PREFIX + network, JSON.stringify(set));
  } catch {
    /* private mode: the set simply does not persist */
  }
}

/** How long ago a discovery set was read, in the app's words:
 * "just now" inside the first minute, then the shared
 * duration wording. */
export function discoveryAgeText(at: number, now: number = Date.now()): string {
  const seconds = (now - at) / 1000;
  if (seconds < 45) return "just now";
  return `${durationText(seconds)} ago`;
}

/** A cached set older than this is refreshed automatically
 * when the overview opens; a fresher one is shown as it
 * stands, with its age stated and a refresh offered. */
export const DISCOVERY_FRESH_MS = 10 * 60 * 1000;
