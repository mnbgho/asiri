// Gathering a circle's record for export, with bounds. The
// shaping is circle-record.ts; this module does the reads.
//
// One export reads the treasury, the tender template's code,
// and then every tender's state and verification. Measured on
// the live network (2026-11-20), a nine-tender circle's full
// read is 186 indexer reads and about 48 seconds when every
// read answers promptly, and the template's code substate is
// the largest single read in it. The indexers intermittently
// stall individual reads, and each read's own retries can hold
// it for minutes, so an unbounded gather can leave a click
// sitting in silence effectively forever. The bounds here are
// what make the export always end:
//
// - the template's code is read once per export, not once per
//   tender, and its digest is handed to each tender's checks;
// - every tender gets a time budget for its state read and
//   another for its checks. A read that stalls past its
//   budget does not kill the export: the tender stands in the
//   record as unreadable, or with its checks marked as not
//   run, with the reason, exactly as a tender that cannot be
//   read at all does. The stalled read itself keeps the
//   indexer's own timeouts in the background and writes
//   nothing;
// - the whole gather has a total budget. Tenders not yet
//   reached when it runs out stand as unreadable for that
//   reason, and the export still completes.
//
// Progress is reported as it goes, so the person who clicked
// can see what is being read while it happens.
import { bytesToHex } from "./cbor";
import {
  summarizeReport,
  tenderStateRecord,
  uncheckedVerification,
  type CircleRecordInput,
  type CircleRecordTender,
  type TenderVerificationSummary,
} from "./circle-record";
import { sha256 } from "./hash";
import type { Indexer } from "./indexer";
import {
  decodeTenderState,
  decodeVaultBalance,
  extractWasm,
  plainAddressError,
  type CircleComponentState,
} from "./state";
import { verifyTender } from "./verify";

// One tender's read or checks get this long before the export
// moves on without them. Today's measured per-tender read is
// a few seconds; this is headroom for a slow network, not a
// target.
export const EXPORT_TENDER_BUDGET_MS = 60_000;
// The template's code read, once per export.
export const EXPORT_TEMPLATE_BUDGET_MS = 60_000;
// The whole gather ends within this, whatever stalls.
export const EXPORT_TOTAL_BUDGET_MS = 240_000;

type Attempt<T> =
  | { kind: "done"; value: T }
  | { kind: "failed"; error: unknown }
  | { kind: "stalled" };

function attempt<T>(work: Promise<T>, ms: number): Promise<Attempt<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "stalled" }), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve({ kind: "done", value });
      },
      (error) => {
        clearTimeout(timer);
        resolve({ kind: "failed", error });
      },
    );
  });
}

export interface GatherOptions {
  onProgress?: (message: string) => void;
  tenderBudgetMs?: number;
  templateBudgetMs?: number;
  totalBudgetMs?: number;
}

export interface GatheredRecord {
  input: CircleRecordInput;
  unreadable: number;
  unchecked: number;
}

export async function gatherCircleRecord(
  indexer: Indexer,
  circleAddress: string,
  circle: CircleComponentState,
  opts: GatherOptions = {},
): Promise<GatheredRecord> {
  const tenderBudgetMs = opts.tenderBudgetMs ?? EXPORT_TENDER_BUDGET_MS;
  const templateBudgetMs = opts.templateBudgetMs ?? EXPORT_TEMPLATE_BUDGET_MS;
  const totalBudgetMs = opts.totalBudgetMs ?? EXPORT_TOTAL_BUDGET_MS;
  const progress = opts.onProgress ?? (() => {});
  const startedAt = Date.now();

  progress("Reading the treasury…");
  let balance: bigint | null = null;
  const treasury = await attempt(
    (async () => {
      const vsub = await indexer.substate(circle.treasuryVault);
      return vsub ? decodeVaultBalance(vsub.value) : null;
    })(),
    tenderBudgetMs,
  );
  if (treasury.kind === "done") balance = treasury.value;

  // The template's code, read once for the whole export. A
  // read that fails or stalls leaves the digest null, and
  // each tender's code check then reports that it could not
  // be run, rather than the export re-reading the largest
  // substate on the network once per tender.
  let templateDigest: string | null = null;
  let passDigest = false;
  if (indexer.cfg.tenderTemplate) {
    passDigest = true;
    progress("Reading the tender template's code…");
    const troot = await attempt(
      (async () => {
        const sub = await indexer.substate(indexer.cfg.tenderTemplate!, {
          large: true,
        });
        if (!sub) return null;
        return bytesToHex(await sha256(extractWasm(sub.value)));
      })(),
      templateBudgetMs,
    );
    if (troot.kind === "done") templateDigest = troot.value;
  }

  const entries: CircleRecordTender[] = [];
  const total = circle.tenders.length;
  for (let i = 0; i < total; i++) {
    const tAddr = circle.tenders[i];
    if (Date.now() - startedAt > totalBudgetMs) {
      entries.push({
        address: tAddr,
        read: "unreadable",
        note: "The export reached its time limit before this tender was read. Export again to try it once more.",
        verification: uncheckedVerification(
          "The export reached its time limit before the checks could be run",
        ),
      });
      continue;
    }
    progress(`Reading tender ${i + 1} of ${total}…`);
    const read = await attempt(
      (async () => {
        const sub = await indexer.substate(tAddr);
        if (!sub)
          throw new Error("That tender's record is not live on the indexer");
        return decodeTenderState(sub.value);
      })(),
      tenderBudgetMs,
    );
    if (read.kind !== "done") {
      entries.push({
        address: tAddr,
        read: "unreadable",
        note:
          read.kind === "stalled"
            ? "The read stalled on the indexer and the export moved on rather than wait without limit. Export again to try it once more."
            : plainAddressError(tAddr, read.error),
        verification: uncheckedVerification(
          "The tender's state could not be read, so the checks were not run",
        ),
      });
      continue;
    }
    progress(`Checking tender ${i + 1} of ${total}…`);
    const checked = await attempt(
      verifyTender(indexer, tAddr, passDigest ? { templateDigest } : {}),
      tenderBudgetMs,
    );
    let verification: TenderVerificationSummary;
    if (checked.kind === "done") {
      verification = summarizeReport(checked.value.report);
    } else if (checked.kind === "stalled") {
      verification = uncheckedVerification(
        "The checks could not be completed: the indexer reads stalled past the export's per-tender time limit. Export again to try once more.",
      );
    } else {
      verification = uncheckedVerification(
        plainAddressError(tAddr, checked.error),
      );
    }
    entries.push({
      address: tAddr,
      read: "ok",
      state: tenderStateRecord(read.value),
      verification,
    });
  }

  return {
    input: {
      networkLabel: indexer.cfg.label,
      circleAddress,
      circle,
      treasuryBalance: balance,
      tenders: entries,
    },
    unreadable: entries.filter((t) => t.read === "unreadable").length,
    unchecked: entries.filter(
      (t) => t.verification.status === "could not be checked",
    ).length,
  };
}
