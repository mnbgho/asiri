// Human time for epoch deadlines. The chain counts in epochs;
// people plan in hours. Every rendering here is labelled as an
// approximation and computed from the network's epoch length as
// the create screen's hints already state it (BUILD-PLAN.md
// Section 1.2 via Section 15: sellers are told their reveal
// deadline in epochs and in approximate wall-clock terms). When
// the current epoch cannot be read, the epoch alone is shown:
// an approximation built on an unknown present would be an
// invented time, and the app does not invent.
import { el } from "./app";
import type { NetworkName } from "./indexer";

export const EPOCH_SECONDS: Record<NetworkName, number> = {
  esmeralda: 3600, // about an hour
  mainnet: 1200, // about twenty minutes
};

/** "about 25 minutes", "about an hour", "about 3 days". */
export function durationText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 120) return "about a minute";
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = s / 3600;
  if (hours < 1.5) return "about an hour";
  if (hours < 24) return `about ${Math.round(hours)} hours`;
  const days = hours / 24;
  if (days < 1.5) return "about a day";
  return `about ${Math.round(days)} days`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function hhmm(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "14:30 today", "09:15 tomorrow", "14:30 on Fri 21 Nov". */
export function clockText(when: Date, now: Date): string {
  const t = hhmm(when);
  if (sameDay(when, now)) return `${t} today`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(when, tomorrow)) return `${t} tomorrow`;
  return `${t} on ${WEEKDAYS[when.getDay()]} ${when.getDate()} ${MONTHS[when.getMonth()]}`;
}

/**
 * One deadline, rendered for a person: the epoch, and when the
 * current epoch is known, how long is left (or how long ago it
 * passed) and the approximate wall-clock moment. The epoch is
 * always the first thing shown: it is the exact value, and the
 * rest is the approximation of it.
 */
export function deadlineText(
  network: NetworkName,
  targetEpoch: number,
  currentEpoch: number,
  now: Date = new Date(),
): string {
  if (!currentEpoch || currentEpoch <= 0) return `epoch ${targetEpoch}`;
  const delta = targetEpoch - currentEpoch;
  if (delta === 0) return `epoch ${targetEpoch} · this epoch`;
  const secs = Math.abs(delta) * EPOCH_SECONDS[network];
  if (delta < 0) return `epoch ${targetEpoch} · ${durationText(secs)} ago`;
  const when = new Date(now.getTime() + secs * 1000);
  return `epoch ${targetEpoch} · in ${durationText(secs)} (about ${clockText(when, now)})`;
}

/**
 * The reveal window a seller is committing into, as the plan
 * promised it would be stated at commitment time: when reveals
 * open and when they close, in epochs and approximate
 * wall-clock terms. Null when the tender carries no deadlines
 * yet (an unlocked tender has no window to state).
 */
export function revealWindowText(
  network: NetworkName,
  bidDeadline: number | null,
  revealDeadline: number | null,
  currentEpoch: number,
  now: Date = new Date(),
): string | null {
  if (bidDeadline === null || revealDeadline === null) return null;
  return `Reveals open at epoch ${bidDeadline} and close at ${deadlineText(network, revealDeadline, currentEpoch, now)}`;
}

/**
 * A deadline rendered as a live span: it carries its target
 * epoch in a data attribute so the periodic refresh in main.ts
 * can re-render its text as epochs pass, without re-rendering
 * the screen around it. A gate span marks a deadline whose
 * passing opens an action on the screen (close reveal, advance
 * to delivery, expire, the dispute window): when one crosses,
 * the refresh re-renders the screen so the action appears.
 */
export function deadlineSpan(
  network: NetworkName,
  targetEpoch: number,
  currentEpoch: number,
  opts?: { gate?: boolean },
): HTMLSpanElement {
  const span = el("span", "deadline", deadlineText(network, targetEpoch, currentEpoch));
  span.dataset.epoch = String(targetEpoch);
  if (opts?.gate) span.dataset.gate = "1";
  return span;
}

/**
 * Re-render every deadline span under a root for a newly read
 * epoch. Returns true when a gate deadline crossed since the
 * previous epoch (it was still ahead then, and has passed
 * now): the caller re-renders the screen so the action the
 * deadline gates appears. A previous epoch of 0 means no
 * baseline was known, and nothing is reported crossed: the
 * text still updates.
 */
export function updateDeadlineSpans(
  root: ParentNode,
  network: NetworkName,
  currentEpoch: number,
  prevEpoch: number,
  now: Date = new Date(),
): boolean {
  let crossed = false;
  root.querySelectorAll("[data-epoch]").forEach((node) => {
    const span = node as HTMLElement;
    const target = Number(span.dataset.epoch);
    if (!Number.isInteger(target)) return;
    span.textContent = deadlineText(network, target, currentEpoch, now);
    if (
      span.dataset.gate === "1" &&
      prevEpoch > 0 &&
      prevEpoch <= target &&
      currentEpoch > target
    ) {
      crossed = true;
    }
  });
  return crossed;
}
