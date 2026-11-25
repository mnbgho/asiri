// The public records of the two templates, as TypeScript types with
// strict decoders from the CBOR values the indexer serves. Field
// order is the #[n] order in the asiri-types crate; the decoders are
// checked against tari_bor encodings of known values in the tests.
import { bytesToHex, Tagged, type CborValue } from "./cbor";

export interface TenderRules {
  specificationHash: string;
  budgetCap: bigint;
  bondAmount: bigint;
  bidWindowEpochs: number;
  revealWindowEpochs: number;
  overrideWindowEpochs: number;
  deliveryWindowEpochs: number;
  claimGraceEpochs: number;
  disputeWindowEpochs: number;
  approvalThreshold: number;
  disputeThreshold: number;
}

// The chain refuses to lock a tender whose thresholds the circle
// cannot satisfy: the approval threshold must sit between 1 and
// the approver count, and the dispute threshold must sit above
// the approval threshold and no higher than the approver count.
// Returns a plain explanation, or null when the pair can lock.
export function thresholdError(
  approvalThreshold: number,
  disputeThreshold: number,
  approverCount: number,
): string | null {
  if (!Number.isInteger(approvalThreshold) || approvalThreshold < 1)
    return "the approval threshold must be a whole number of at least 1";
  if (!Number.isInteger(disputeThreshold) || disputeThreshold < 1)
    return "the dispute threshold must be a whole number of at least 1";
  if (approvalThreshold > approverCount)
    return `the approval threshold is ${approvalThreshold}, but this circle has ${approverCount} approver${approverCount === 1 ? "" : "s"}`;
  if (disputeThreshold <= approvalThreshold)
    return "the dispute threshold must be higher than the approval threshold";
  if (disputeThreshold > approverCount)
    return approvalThreshold >= approverCount
      ? `no dispute threshold can work here: it must be higher than the approval threshold and no higher than this circle's ${approverCount} approver${approverCount === 1 ? "" : "s"}. add an approver to the circle first`
      : `the dispute threshold is ${disputeThreshold}, but this circle has ${approverCount} approvers`;
  return null;
}

// The winner's dispute window, exactly as the tender template
// enforces it in claim_dispute: the tender is awaiting delivery,
// the delivery deadline has passed, and the claim grace has not
// closed yet. An unknown epoch (0, when the network read failed)
// opens nothing.
export function disputeWindowOpen(
  state: TenderStateName,
  deliveryDeadline: number | null,
  claimDeadline: number | null,
  epoch: number,
): boolean {
  return (
    state === "AwaitingDelivery" &&
    deliveryDeadline !== null &&
    claimDeadline !== null &&
    epoch > 0 &&
    epoch >= deliveryDeadline &&
    epoch < claimDeadline
  );
}

// A treasury withdrawal proposal, checked the way the circle
// template checks it in propose_withdrawal, plus the address
// shape the instruction builder needs: the amount must be
// positive and no more than the treasury holds, and the
// destination must be a component address. Returns a plain
// explanation, or null when the proposal can be made. A null
// balance means the treasury read failed; the form must not
// submit blind in that case, because the one check it cannot
// do is the one that matters, so it blocks until the balance
// is read again.
export function withdrawalError(
  amountMicro: bigint,
  to: string,
  treasuryBalance: bigint | null,
): string | null {
  if (!/^component_[0-9a-f]{64}$/.test(to))
    return "the destination is not a component address";
  if (amountMicro <= 0n) return "the amount must be more than zero";
  if (treasuryBalance === null)
    return "the treasury balance could not be read, so a withdrawal cannot be proposed yet. read it again and retry.";
  if (amountMicro > treasuryBalance)
    return "that is more than the treasury holds";
  return null;
}

export const TENDER_STATES = [
  "Draft",
  "Open",
  "Reveal",
  "Awarded",
  "AwaitingDelivery",
  "Settled",
  "Expired",
  "Disputed",
] as const;
export type TenderStateName = (typeof TENDER_STATES)[number];

export interface AwardRecord {
  winner: string;
  winningCommitment: string;
  winningPrice: bigint;
  commitmentsCount: number;
  revealsCount: number;
  epoch: number;
  byOverride: boolean;
}

export interface OverrideRecord {
  chosen: string | null;
  rationaleHash: string;
  epoch: number;
}

export interface DisputeRecord {
  evidenceHash: string;
  epoch: number;
  resolvedForWinner: boolean | null;
  rationaleHash: string | null;
}

export interface SettlementRecord {
  winner: string;
  price: bigint;
  epoch: number;
}

export interface TenderInfo {
  circle: string;
  circleName: string;
  bound: boolean;
  state: TenderStateName;
  rules: TenderRules;
  rulesHash: string | null;
  approvers: string[];
  lockEpoch: number | null;
  bidDeadline: number | null;
  revealDeadline: number | null;
  overrideDeadline: number | null;
  deliveryDeadline: number | null;
  claimDeadline: number | null;
  commitmentsCount: number;
  revealsCount: number;
  award: AwardRecord | null;
  overrideRecord: OverrideRecord | null;
  dispute: DisputeRecord | null;
  settlement: SettlementRecord | null;
  receiptResource: string | null;
  forfeitForCircle: bigint;
  forfeitLocked: bigint;
  receiptIssued: boolean;
}

export interface CircleInfo {
  name: string;
  approvers: string[];
  threshold: number;
  auditor: string | null;
  tenders: string[];
  treasuryBalance: bigint;
}

// ---------- strict field readers ----------

function arr(v: CborValue, what: string): CborValue[] {
  if (!Array.isArray(v)) throw new Error(`expected an array for ${what}`);
  return v;
}

function int(v: CborValue, what: string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  throw new Error(`expected an integer for ${what}`);
}

function num(v: CborValue, what: string): number {
  const n = int(v, what);
  if (n > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`integer too large for ${what}`);
  return Number(n);
}

function bytes(v: CborValue, what: string): Uint8Array {
  if (v instanceof Uint8Array) return v;
  throw new Error(`expected bytes for ${what}`);
}

function hex(v: CborValue, what: string): string {
  return bytesToHex(bytes(v, what));
}

function text(v: CborValue, what: string): string {
  if (typeof v === "string") return v;
  throw new Error(`expected text for ${what}`);
}

function bool(v: CborValue, what: string): boolean {
  if (typeof v === "boolean") return v;
  throw new Error(`expected a boolean for ${what}`);
}

function taggedAddress(v: CborValue, tag: number, prefix: string, what: string): string {
  if (v instanceof Tagged && v.tag === tag)
    return prefix + bytesToHex(bytes(v.value, what));
  throw new Error(`expected a tagged ${prefix} address for ${what}`);
}

function opt<T>(v: CborValue, inner: (x: CborValue) => T): T | null {
  return v === null ? null : inner(v);
}

function enumIndex(v: CborValue, what: string): number {
  const parts = arr(v, what);
  if (parts.length !== 2) throw new Error(`bad enum shape for ${what}`);
  return num(parts[0], what);
}

// ---------- decoders ----------

export function decodeRules(v: CborValue): TenderRules {
  const f = arr(v, "rules");
  if (f.length !== 11) throw new Error(`rules has ${f.length} fields, expected 11`);
  return {
    specificationHash: hex(f[0], "specification_hash"),
    budgetCap: int(f[1], "budget_cap"),
    bondAmount: int(f[2], "bond_amount"),
    bidWindowEpochs: num(f[3], "bid_window_epochs"),
    revealWindowEpochs: num(f[4], "reveal_window_epochs"),
    overrideWindowEpochs: num(f[5], "override_window_epochs"),
    deliveryWindowEpochs: num(f[6], "delivery_window_epochs"),
    claimGraceEpochs: num(f[7], "claim_grace_epochs"),
    disputeWindowEpochs: num(f[8], "dispute_window_epochs"),
    approvalThreshold: num(f[9], "approval_threshold"),
    disputeThreshold: num(f[10], "dispute_threshold"),
  };
}

export function decodeState(v: CborValue): TenderStateName {
  const idx = enumIndex(v, "state");
  const name = TENDER_STATES[idx];
  if (!name) throw new Error(`unknown tender state index ${idx}`);
  return name;
}

export function decodeAward(v: CborValue): AwardRecord {
  const f = arr(v, "award");
  // As in state.ts: the on-chain award carries seven fields.
  if (f.length !== 7) throw new Error(`award has ${f.length} fields, expected 7`);
  return {
    winner: hex(f[0], "winner"),
    winningCommitment: hex(f[1], "winning_commitment"),
    winningPrice: int(f[2], "winning_price"),
    commitmentsCount: num(f[3], "commitments_count"),
    revealsCount: num(f[4], "reveals_count"),
    epoch: num(f[5], "epoch"),
    byOverride: bool(f[6], "by_override"),
  };
}

function decodeOverride(v: CborValue): OverrideRecord {
  const f = arr(v, "override_record");
  if (f.length !== 3) throw new Error(`override record has ${f.length} fields, expected 3`);
  return {
    chosen: opt(f[0], (x) => hex(x, "chosen")),
    rationaleHash: hex(f[1], "rationale_hash"),
    epoch: num(f[2], "epoch"),
  };
}

function decodeDispute(v: CborValue): DisputeRecord {
  const f = arr(v, "dispute");
  if (f.length !== 4) throw new Error(`dispute record has ${f.length} fields, expected 4`);
  return {
    evidenceHash: hex(f[0], "evidence_hash"),
    epoch: num(f[1], "epoch"),
    resolvedForWinner: opt(f[2], (x) => bool(x, "resolved_for_winner")),
    rationaleHash: opt(f[3], (x) => hex(x, "rationale_hash")),
  };
}

function decodeSettlement(v: CborValue): SettlementRecord {
  const f = arr(v, "settlement");
  if (f.length !== 3) throw new Error(`settlement has ${f.length} fields, expected 3`);
  return {
    winner: hex(f[0], "winner"),
    price: int(f[1], "price"),
    epoch: num(f[2], "epoch"),
  };
}

export function decodeTenderInfo(v: CborValue): TenderInfo {
  const f = arr(v, "tender info");
  // A None receipt_id is omitted from the encoding entirely
  // (measured against tari_bor, see test/fixtures.ts): the array
  // has 22 items before a receipt is issued and 23 after.
  if (f.length !== 22 && f.length !== 23)
    throw new Error(`tender info has ${f.length} fields, expected 22 or 23`);
  return {
    circle: taggedAddress(f[0], 128, "component_", "circle"),
    circleName: text(f[1], "circle_name"),
    bound: bool(f[2], "bound"),
    state: decodeState(f[3]),
    rules: decodeRules(f[4]),
    rulesHash: opt(f[5], (x) => hex(x, "rules_hash")),
    approvers: arr(f[6], "approvers").map((k) => hex(k, "approver")),
    lockEpoch: opt(f[7], (x) => num(x, "lock_epoch")),
    bidDeadline: opt(f[8], (x) => num(x, "bid_deadline")),
    revealDeadline: opt(f[9], (x) => num(x, "reveal_deadline")),
    overrideDeadline: opt(f[10], (x) => num(x, "override_deadline")),
    deliveryDeadline: opt(f[11], (x) => num(x, "delivery_deadline")),
    claimDeadline: opt(f[12], (x) => num(x, "claim_deadline")),
    commitmentsCount: num(f[13], "commitments_count"),
    revealsCount: num(f[14], "reveals_count"),
    award: opt(f[15], decodeAward),
    overrideRecord: opt(f[16], decodeOverride),
    dispute: opt(f[17], decodeDispute),
    settlement: opt(f[18], decodeSettlement),
    receiptResource: opt(f[19], (x) =>
      taggedAddress(x, 131, "resource_", "receipt_resource"),
    ),
    forfeitForCircle: int(f[20], "forfeit_for_circle"),
    forfeitLocked: int(f[21], "forfeit_locked"),
    receiptIssued: f.length === 23,
  };
}

export function decodeCircleInfo(v: CborValue): CircleInfo {
  const f = arr(v, "circle info");
  if (f.length !== 6)
    throw new Error(`circle info has ${f.length} fields, expected 6`);
  return {
    name: text(f[0], "name"),
    approvers: arr(f[1], "approvers").map((k) => hex(k, "approver")),
    threshold: num(f[2], "threshold"),
    auditor: opt(f[3], (x) => hex(x, "auditor")),
    tenders: arr(f[4], "tenders").map((t) =>
      taggedAddress(t, 128, "component_", "tender"),
    ),
    treasuryBalance: int(f[5], "treasury_balance"),
  };
}
