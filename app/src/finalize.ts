// Post-submission truth. The wallet provider reports a
// transaction as "submitted" and, as integrated here, carries
// no finalize decision the app can read: the result it returns
// is the execution payload the create flows scan for new
// component addresses, nothing more. The finalize outcome is
// public record on the indexer instead: a transaction that
// touches a component appears in that component's event feed,
// and its result (/transactions/{id}/result) states the final
// decision and, when the execution failed, the chain's own
// reason. This module reads that record so a submitted action
// can say what actually happened: confirmed, failed on chain
// with the reason, or honestly still unknown.
import type { Indexer } from "./indexer";
import type { Instruction } from "./wallet";

export interface ActionOutcome {
  kind: "confirmed" | "failed" | "unconfirmed";
  txId: string | null;
  // The chain's reason when the execution failed, else null.
  reason: string | null;
}

export const UNCONFIRMED: ActionOutcome = {
  kind: "unconfirmed",
  txId: null,
  reason: null,
};

/** Method names called on each component by an instruction list. */
export function calledMethods(
  instructions: Instruction[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const ix of instructions) {
    if (!("CallMethod" in ix)) continue;
    const { call, method } = ix.CallMethod;
    const set = out.get(call.Address) ?? new Set<string>();
    set.add(method);
    out.set(call.Address, set);
  }
  return out;
}

/**
 * The finalize decision in an indexer transaction result, in
 * the shape the indexer serves: { result: { Finalized: {
 * final_decision, abort_details } } }. A Commit with abort
 * details is the fee-only ending: the transaction landed, the
 * execution failed, and the details say why. Returns null when
 * the payload carries no readable decision yet.
 */
export function parseFinalizeResult(
  body: unknown,
): { decision: string; abortDetails: string | null } | null {
  const fin = (
    body as {
      result?: {
        Finalized?: { final_decision?: unknown; abort_details?: unknown };
      };
    }
  )?.result?.Finalized;
  if (!fin || typeof fin.final_decision !== "string") return null;
  // A present abort_details, even an empty one, is the failure
  // marker: a clean commit carries null here (verified live).
  // Only a non-string value reads as absent.
  return {
    decision: fin.final_decision,
    abortDetails:
      typeof fin.abort_details === "string" ? fin.abort_details : null,
  };
}

/**
 * The finalize decision in a transaction body's summary, the
 * shape the mainnet indexer serves: { transaction: {
 * summary: { outcome, finalized_at }, rejected_reason } }.
 * The body endpoint answers on mainnet where the /result
 * endpoint 404s for the same transaction, so this is the
 * first place a decision is read. Returns null when the body
 * carries no summary yet.
 */
export function parseBodySummary(
  body: unknown,
): { decision: string; reason: string | null } | null {
  const tx = (body as { transaction?: unknown })?.transaction;
  if (!tx || typeof tx !== "object") return null;
  const rec = tx as Record<string, unknown>;
  const summary = rec.summary as { outcome?: unknown } | undefined;
  if (!summary || typeof summary.outcome !== "string") return null;
  const rejected = rec.rejected_reason;
  return {
    decision: summary.outcome,
    reason:
      typeof rejected === "string" && rejected.trim() ? rejected : null,
  };
}

/**
 * The plain part of the chain's abort detail: the template's
 * own reason when the detail carries one, else the whole
 * detail, trimmed.
 */
export function plainReason(abortDetails: string): string {
  const marker = "Template error: ";
  const at = abortDetails.lastIndexOf(marker);
  const tail = at >= 0 ? abortDetails.slice(at + marker.length) : abortDetails;
  return tail.trim();
}

/** The finalize decision for one transaction, read from the
 * body summary first (the route that answers on mainnet) and
 * the /result endpoint second (the route that answers on
 * Esmeralda). Returns null when neither carries a decision
 * yet. The reason is the body's rejected reason, or the
 * /result record's abort details. */
async function readDecision(
  indexer: Indexer,
  txId: string,
): Promise<{ decision: string; reason: string | null } | null> {
  try {
    const summary = parseBodySummary(await indexer.transaction(txId));
    if (summary) return summary;
  } catch {
    /* the body is not readable yet; fall through */
  }
  try {
    const parsed = parseFinalizeResult(
      await indexer.transactionResult(txId),
    );
    if (parsed) return { decision: parsed.decision, reason: parsed.abortDetails };
  } catch {
    /* the result is not readable yet */
  }
  return null;
}

/** The failure reason for a decision that is not a clean
 * commit: the plain template reason when the detail carries
 * one, else what the decision itself says. */
function failureReason(decision: {
  decision: string;
  reason: string | null;
}): string {
  if (decision.reason && decision.reason.trim()) {
    return plainReason(decision.reason);
  }
  return decision.decision === "Commit"
    ? "The chain accepted the fee but the execution failed"
    : `The chain's final decision was ${decision.decision.toLowerCase()}`;
}

function findCalls(
  node: unknown,
  out: { address: string; method: string }[],
): void {
  if (Array.isArray(node)) {
    node.forEach((n) => findCalls(n, out));
  } else if (node && typeof node === "object") {
    const rec = node as Record<string, unknown>;
    const call = rec.CallMethod as
      | { call?: { Address?: string }; method?: string }
      | undefined;
    if (call && typeof call.method === "string") {
      out.push({ address: String(call.call?.Address ?? ""), method: call.method });
    }
    Object.values(rec).forEach((v) => findCalls(v, out));
  }
}

/** Does a transaction body call one of the methods on the component? */
export function txCalls(
  body: unknown,
  component: string,
  methods: Set<string>,
): boolean {
  const calls: { address: string; method: string }[] = [];
  findCalls(body, calls);
  return calls.some((c) => c.address === component && methods.has(c.method));
}

/**
 * The public key that sealed a transaction. The indexer body
 * envelope is { transaction: { transaction: { V1: {
 * seal_signature, body } } } }: the seal sits on the versioned
 * transaction object, beside the body. Only that position is
 * read. A seal_signature appearing anywhere deeper, inside
 * instruction arguments or payload data, is data, not a seal,
 * and is never treated as one. In this stack the seal signer
 * is the submitting account's owner key, so it identifies
 * whose transaction this is. Returns null when the envelope
 * carries no readable seal.
 */
export function sealSigner(body: unknown): string | null {
  const versioned = (
    body as { transaction?: { transaction?: unknown } }
  )?.transaction?.transaction;
  if (!versioned || typeof versioned !== "object") return null;
  for (const variant of Object.values(versioned as Record<string, unknown>)) {
    if (!variant || typeof variant !== "object") continue;
    const seal = (variant as { seal_signature?: { public_key?: unknown } })
      .seal_signature;
    if (seal && typeof seal.public_key === "string") return seal.public_key;
  }
  return null;
}

export interface ConfirmOptions {
  pollMs?: number;
  eventTries?: number;
  resultTries?: number;
  versionTries?: number;
  // The watched component's version before the action was
  // submitted. When known, a version increase proves the
  // action's transaction landed even when the event feed has
  // not indexed it yet, so the confirmation does not depend
  // on the feed being fresh. Null when the version could not
  // be read before submitting, and the version route is off.
  beforeVersion?: number | null;
  // The connected account's owner key. When known, a candidate
  // transaction must be sealed by it to count as this action's
  // own; when null, matching falls back to component and
  // method alone.
  signer?: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Watch a component's event feed for the transaction this
 * action submitted: a transaction id not in `before` whose
 * body calls one of `methods` on the component and, when the
 * signer's key is known, is sealed by that key. Then read its
 * finalize decision. When the feed stays quiet, watch the
 * component's version instead: a version increase proves a
 * transaction changed the component, and a failed execution
 * changes nothing, so an increase after this action was
 * submitted is the action landing. Bounded: when nothing can
 * be read inside the budget, the outcome is unconfirmed,
 * never a guessed success, and an unconfirmed outcome names
 * a transaction only when that transaction was matched as the
 * action's own.
 */
export async function confirmAction(
  indexer: Indexer,
  component: string,
  methods: Set<string>,
  before: Set<string>,
  opts: ConfirmOptions = {},
): Promise<ActionOutcome> {
  const pollMs = opts.pollMs ?? 2500;
  const eventTries = opts.eventTries ?? 24;
  const resultTries = opts.resultTries ?? 18;
  const versionTries = opts.versionTries ?? 12;
  const beforeVersion = opts.beforeVersion ?? null;
  const signer = opts.signer ?? null;
  let matched: string | null = null;
  const notMine = new Set<string>();
  for (let i = 0; i < eventTries && !matched; i++) {
    if (i > 0) await sleep(pollMs);
    let events: { txId: string; topic: string }[];
    try {
      events = await indexer.events(component);
    } catch {
      continue;
    }
    for (const ev of events) {
      if (!ev.txId || before.has(ev.txId) || notMine.has(ev.txId)) continue;
      try {
        const body = await indexer.transaction(ev.txId);
        if (
          txCalls(body, component, methods) &&
          (!signer || sealSigner(body) === signer)
        ) {
          matched = ev.txId;
          break;
        }
        notMine.add(ev.txId);
      } catch {
        // The body is not readable yet (indexer lag, or a body
        // the indexers have pruned). Leave the candidate
        // unchecked so a later poll can try it again.
      }
    }
  }
  if (!matched && beforeVersion !== null) {
    // The feed has not indexed the transaction yet. Watch the
    // component's version: a failed execution changes nothing,
    // so an increase after the submit is the action landing.
    // A final feed read then tries to name the transaction for
    // the receipt link; when the feed is still quiet the
    // outcome is confirmed without a link, which is honest:
    // the state change is the proof, the link is a nicety.
    let versionProved = false;
    for (let i = 0; i < versionTries && !matched && !versionProved; i++) {
      if (i > 0) await sleep(pollMs);
      let version: number | null = null;
      try {
        version = (await indexer.substate(component))?.version ?? null;
      } catch {
        continue;
      }
      if (version !== null && version > beforeVersion) {
        versionProved = true;
        try {
          const events = await indexer.events(component);
          for (const ev of events) {
            if (!ev.txId || before.has(ev.txId) || notMine.has(ev.txId)) continue;
            try {
              const body = await indexer.transaction(ev.txId);
              if (
                txCalls(body, component, methods) &&
                (!signer || sealSigner(body) === signer)
              ) {
                matched = ev.txId;
                break;
              }
              notMine.add(ev.txId);
            } catch {
              /* leave the candidate unchecked */
            }
          }
        } catch {
          /* the feed is still unreadable; the version is the proof */
        }
      }
    }
    if (!matched && versionProved) {
      return { kind: "confirmed", txId: null, reason: null };
    }
  }
  if (!matched) return { kind: "unconfirmed", txId: null, reason: null };
  for (let i = 0; i < resultTries; i++) {
    if (i > 0) await sleep(pollMs);
    const decision = await readDecision(indexer, matched);
    if (decision) {
      if (decision.decision === "Commit" && decision.reason === null) {
        return { kind: "confirmed", txId: matched, reason: null };
      }
      return {
        kind: "failed",
        txId: matched,
        reason: failureReason(decision),
      };
    }
  }
  return { kind: "unconfirmed", txId: matched, reason: null };
}
