// Decoders for the raw component state the indexer serves. The
// public info records (model.ts) come from method calls; a static
// app cannot call methods, so it reads state substates directly and
// reconstructs the same record. Field order follows the template
// state structs in the circle and tender crates. Vault fields carry
// the vault substate id, whose own substate holds the balance.
import { bytesToHex, Tagged, type CborValue } from "./cbor";
import {
  decodeRules,
  decodeState,
  type AwardRecord,
  type TenderRules,
  type TenderStateName,
} from "./model";

export interface CommitmentRecord {
  seller: string;
  commitment: string;
  epoch: number;
  revealed: boolean;
  bond: string;
}

export interface RevealRecord {
  seller: string;
  price: bigint;
  epoch: number;
  counter: number;
  valid: boolean;
  commitment: string;
}

export interface OverrideProposal {
  id: number;
  chosen: string | null;
  rationaleHash: string;
  signers: string[];
  executed: boolean;
  isVoid: boolean;
}

export interface TenderComponentState {
  template: string;
  circle: string;
  circleName: string;
  bound: boolean;
  approvers: string[];
  rules: TenderRules;
  rulesHash: string | null;
  state: TenderStateName;
  escrowVault: string;
  bondsVault: string;
  receiptResource: string | null;
  lockEpoch: number | null;
  bidDeadline: number | null;
  revealDeadline: number | null;
  overrideDeadline: number | null;
  deliveryStart: number | null;
  deliveryDeadline: number | null;
  claimDeadline: number | null;
  commitments: CommitmentRecord[];
  reveals: RevealRecord[];
  award: AwardRecord | null;
  overrideProposals: OverrideProposal[];
  overrideRecord: {
    chosen: string | null;
    rationaleHash: string;
    epoch: number;
  } | null;
  deliverySigners: string[];
  dispute: {
    evidenceHash: string;
    epoch: number;
    deadline: number;
    resolvedForWinner: boolean | null;
    rationaleHash: string | null;
  } | null;
  disputeVotes: { signer: string; payWinner: boolean; rationaleHash: string }[];
  settlement: { winner: string; price: bigint; epoch: number } | null;
  refundAmount: bigint | null;
  refundClaimed: boolean;
  payoutClaimed: boolean;
  forfeitForCircle: bigint;
  forfeitLocked: bigint;
  forfeitsClaimedByCircle: boolean;
  receiptIssued: boolean;
  approverChanges: {
    id: number;
    newApprovers: string[];
    signers: string[];
    executed: boolean;
    isVoid: boolean;
  }[];
  nextProposalId: number;
}

export interface CircleComponentState {
  template: string;
  name: string;
  members: string[];
  approvers: string[];
  threshold: number;
  auditor: string | null;
  treasuryVault: string;
  tenders: string[];
  withdrawals: {
    id: number;
    amount: bigint;
    to: string;
    signers: string[];
    executed: boolean;
    isVoid: boolean;
  }[];
  approverChanges: {
    id: number;
    newApprovers: string[];
    newThreshold: number;
    signers: string[];
    executed: boolean;
    isVoid: boolean;
  }[];
  nextProposalId: number;
}

const BOND_STATES = ["Held", "Returnable", "Returned", "Forfeited"];

function arr(v: CborValue, what: string): CborValue[] {
  if (!Array.isArray(v)) throw new Error(`expected an array for ${what}`);
  return v;
}
/** An array with exactly n fields: a record with trailing or
 *  missing fields is malformed, not a shorter form. */
function exact(v: CborValue, n: number, what: string): CborValue[] {
  const g = arr(v, what);
  if (g.length !== n)
    throw new Error(`${what} has ${g.length} fields, expected ${n}`);
  return g;
}
function int(v: CborValue, what: string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  throw new Error(`expected an integer for ${what}`);
}
function num(v: CborValue, what: string): number {
  const n = int(v, what);
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Error(`integer for ${what} is outside the safe range`);
  return Number(n);
}
function hex(v: CborValue, what: string): string {
  if (v instanceof Uint8Array) return bytesToHex(v);
  throw new Error(`expected bytes for ${what}`);
}
function text(v: CborValue, what: string): string {
  if (typeof v === "string") return v;
  throw new Error(`expected text for ${what}`);
}
function bool(v: CborValue, what: string): boolean {
  if (typeof v === "boolean") return v;
  throw new Error(`expected a boolean for ${what}`);
}
function opt<T>(v: CborValue, inner: (x: CborValue) => T): T | null {
  return v === null ? null : inner(v);
}
function addr(v: CborValue, tag: number, prefix: string, what: string): string {
  if (v instanceof Tagged && v.tag === tag && v.value instanceof Uint8Array)
    return prefix + bytesToHex(v.value);
  throw new Error(`expected a tagged address for ${what}`);
}
function keys(v: CborValue, what: string): string[] {
  return arr(v, what).map((k) => hex(k, what));
}
function enumName(v: CborValue, names: string[], what: string): string {
  const parts = arr(v, what);
  const idx = num(parts[0], what);
  const name = names[idx];
  if (!name) throw new Error(`unknown ${what} index ${idx}`);
  return name;
}

/** A vault field in component state: keep the substate id string. */
function vaultId(v: CborValue, what: string): string {
  if (v instanceof Tagged && v.tag === 132 && v.value instanceof Uint8Array)
    return "vault_" + bytesToHex(v.value);
  throw new Error(`unexpected vault encoding for ${what}`);
}

/** Split a component substate value into template address and state. */
export function splitComponent(root: CborValue): { template: string; state: CborValue[] } {
  const outer = arr(root, "component substate");
  const body = arr(outer[1], "component body");
  const first = arr(body[0], "component entry");
  const header = arr(first[0], "component header");
  const templateBytes = header[0];
  if (!(templateBytes instanceof Uint8Array))
    throw new Error("component header does not start with template bytes");
  const wrapped = arr(first[1], "component state wrapper");
  const state = arr(wrapped[0], "component state");
  return { template: "template_" + bytesToHex(templateBytes), state };
}

export function decodeTenderState(root: CborValue): TenderComponentState {
  const { template, state: raw } = splitComponent(root);
  // As in TenderInfo, a None receipt_id is omitted from the
  // encoding: 35 fields before a receipt exists, 36 after, with
  // the fields behind it shifted by one.
  if (raw.length !== 35 && raw.length !== 36)
    throw new Error(`tender state has ${raw.length} fields, expected 35 or 36`);
  const hasReceipt = raw.length === 36;
  const f: CborValue[] = hasReceipt
    ? raw
    : [...raw.slice(0, 33), null, ...raw.slice(33)];
  return {
    template,
    circle: addr(f[0], 128, "component_", "circle"),
    circleName: text(f[1], "circle_name"),
    bound: bool(f[2], "bound"),
    approvers: keys(f[3], "approvers"),
    rules: decodeRules(f[4]),
    rulesHash: opt(f[5], (x) => hex(x, "rules_hash")),
    state: decodeState(f[6]),
    escrowVault: vaultId(f[7], "escrow"),
    bondsVault: vaultId(f[8], "bonds"),
    receiptResource: opt(f[9], (x) => addr(x, 131, "resource_", "receipt_resource")),
    lockEpoch: opt(f[10], (x) => num(x, "lock_epoch")),
    bidDeadline: opt(f[11], (x) => num(x, "bid_deadline")),
    revealDeadline: opt(f[12], (x) => num(x, "reveal_deadline")),
    overrideDeadline: opt(f[13], (x) => num(x, "override_deadline")),
    deliveryStart: opt(f[14], (x) => num(x, "delivery_start")),
    deliveryDeadline: opt(f[15], (x) => num(x, "delivery_deadline")),
    claimDeadline: opt(f[16], (x) => num(x, "claim_deadline")),
    commitments: arr(f[17], "commitments").map((c) => {
      const g = exact(c, 5, "commitment");
      return {
        seller: hex(g[0], "seller"),
        commitment: hex(g[1], "commitment"),
        epoch: num(g[2], "epoch"),
        revealed: bool(g[3], "revealed"),
        bond: enumName(g[4], BOND_STATES, "bond state"),
      };
    }),
    reveals: arr(f[18], "reveals").map((r) => {
      const g = exact(r, 6, "reveal");
      return {
        seller: hex(g[0], "seller"),
        price: int(g[1], "price"),
        epoch: num(g[2], "epoch"),
        counter: num(g[3], "counter"),
        valid: bool(g[4], "valid"),
        commitment: hex(g[5], "commitment"),
      };
    }),
    award: opt(f[20], (x) => {
      // The on-chain award carries seven fields: the five the
      // checks use, plus the epoch it was computed at and whether
      // an executed override put it in place. Measured live on
      // the mainnet gate tender, 2026-11-25.
      const g = exact(x, 7, "award");
      return {
        winner: hex(g[0], "winner"),
        winningCommitment: hex(g[1], "winning_commitment"),
        winningPrice: int(g[2], "winning_price"),
        commitmentsCount: num(g[3], "commitments_count"),
        revealsCount: num(g[4], "reveals_count"),
        epoch: num(g[5], "epoch"),
        byOverride: bool(g[6], "by_override"),
      };
    }),
    overrideProposals: arr(f[21], "override_proposals").map((p) => {
      const g = exact(p, 6, "override proposal");
      return {
        id: num(g[0], "id"),
        chosen: opt(g[1], (x) => hex(x, "chosen")),
        rationaleHash: hex(g[2], "rationale_hash"),
        signers: keys(g[3], "signers"),
        executed: bool(g[4], "executed"),
        isVoid: bool(g[5], "void"),
      };
    }),
    overrideRecord: opt(f[22], (x) => {
      const g = exact(x, 3, "override record");
      return {
        chosen: opt(g[0], (y) => hex(y, "chosen")),
        rationaleHash: hex(g[1], "rationale_hash"),
        epoch: num(g[2], "epoch"),
      };
    }),
    deliverySigners: keys(f[23], "delivery_signers"),
    dispute: opt(f[24], (x) => {
      const g = arr(x, "dispute");
      // Trailing empty options are omitted from the encoding, so
      // an unresolved dispute carries only its first three fields.
      // Any other length is a malformed record, not a shorter form.
      if (g.length < 3 || g.length > 5)
        throw new Error(`dispute record has ${g.length} fields`);
      return {
        evidenceHash: hex(g[0], "evidence_hash"),
        epoch: num(g[1], "epoch"),
        deadline: num(g[2], "deadline"),
        resolvedForWinner:
          g.length > 3 ? opt(g[3], (y) => bool(y, "resolved_for_winner")) : null,
        rationaleHash:
          g.length > 4 ? opt(g[4], (y) => hex(y, "rationale_hash")) : null,
      };
    }),
    disputeVotes: arr(f[25], "dispute_votes").map((d) => {
      const g = exact(d, 3, "dispute vote");
      return {
        signer: hex(g[0], "signer"),
        payWinner: bool(g[1], "pay_winner"),
        rationaleHash: hex(g[2], "rationale_hash"),
      };
    }),
    settlement: opt(f[26], (x) => {
      const g = exact(x, 3, "settlement");
      return {
        winner: hex(g[0], "winner"),
        price: int(g[1], "price"),
        epoch: num(g[2], "epoch"),
      };
    }),
    refundAmount: opt(f[27], (x) => int(x, "refund_amount")),
    refundClaimed: bool(f[28], "refund_claimed"),
    payoutClaimed: bool(f[29], "payout_claimed"),
    forfeitForCircle: int(f[30], "forfeit_for_circle"),
    forfeitLocked: int(f[31], "forfeit_locked"),
    forfeitsClaimedByCircle: bool(f[32], "forfeits_claimed_by_circle"),
    receiptIssued: f[33] !== null,
    approverChanges: arr(f[34], "approver_changes").map((p) => {
      const g = exact(p, 5, "approver change");
      return {
        id: num(g[0], "id"),
        newApprovers: keys(g[1], "new_approvers"),
        signers: keys(g[2], "signers"),
        executed: bool(g[3], "executed"),
        isVoid: bool(g[4], "void"),
      };
    }),
    nextProposalId: num(f[35], "next_proposal_id"),
  };
}

/**
 * A vault substate carries its balance beside its resource
 * address; find that pair in the decoded value.
 */
export function decodeVaultBalance(root: CborValue): bigint {
  const find = (node: CborValue): bigint | null => {
    if (Array.isArray(node)) {
      if (
        node.length >= 2 &&
        node[0] instanceof Tagged &&
        (node[0] as Tagged).tag === 131 &&
        typeof node[1] === "bigint"
      )
        return node[1] as bigint;
      for (const child of node) {
        const got = find(child);
        if (got !== null) return got;
      }
    }
    return null;
  };
  const balance = find(root);
  if (balance === null) throw new Error("no balance found in the vault substate");
  return balance;
}

/**
 * The owner public key of an account component. The wallet's
 * account list gives the component address only, but the account
 * state header carries the owner's key, at a fixed position
 * (proven against live accounts on Esmeralda): body, entry,
 * header, key container, key slot, key bytes.
 */
export function decodeAccountOwnerKey(root: CborValue): string {
  const outer = arr(root, "account substate");
  const body = arr(outer[1], "account body");
  const first = arr(body[0], "account entry");
  const header = arr(first[0], "account header");
  const container = arr(header[1], "account key container");
  const slot = arr(container[1], "account key slot");
  const keyBytes = slot[0];
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32)
    throw new Error("account state does not carry a 32 byte owner key");
  return bytesToHex(keyBytes);
}

/**
 * Find the vault an account holds for one resource, by scanning
 * the account state for the resource to vault map entry. Returns
 * the vault address, or null when the account holds none.
 */
export function findAccountVault(root: CborValue, resource: string): string | null {
  const want = resource.replace(/^resource_/, "");
  let found: string | null = null;
  const walk = (node: CborValue): void => {
    if (found !== null) return;
    if (node instanceof Map) {
      for (const [k, v] of node) {
        if (
          k instanceof Tagged && k.tag === 131 &&
          v instanceof Tagged && v.tag === 132 &&
          k.value instanceof Uint8Array && bytesToHex(k.value) === want &&
          v.value instanceof Uint8Array
        ) {
          found = "vault_" + bytesToHex(v.value);
          return;
        }
        walk(k);
        walk(v);
      }
    } else if (Array.isArray(node)) {
      for (const child of node) walk(child);
    } else if (node instanceof Tagged) {
      walk(node.value);
    }
  };
  walk(root);
  return found;
}

/** Pull the WASM binary out of a template substate value. */
export function extractWasm(root: CborValue): Uint8Array {
  let best: Uint8Array | null = null;
  const walk = (node: CborValue): void => {
    if (node instanceof Uint8Array) {
      if (
        node.length > 1000 &&
        node[0] === 0 &&
        node[1] === 0x61 &&
        node[2] === 0x73 &&
        node[3] === 0x6d &&
        (best === null || node.length > best.length)
      )
        best = node;
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node instanceof Tagged) {
      walk(node.value);
    }
  };
  walk(root);
  if (best === null) throw new Error("no WASM binary in the template substate");
  return best;
}

export function decodeCircleState(root: CborValue): CircleComponentState {
  const { template, state: f } = splitComponent(root);
  if (f.length !== 12)
    throw new Error(`circle state has ${f.length} fields, expected 12`);
  return {
    template,
    name: text(f[0], "name"),
    members: keys(f[1], "members"),
    approvers: keys(f[2], "approvers"),
    threshold: num(f[3], "threshold"),
    auditor: opt(f[4], (x) => hex(x, "auditor")),
    treasuryVault: vaultId(f[5], "treasury"),
    tenders: arr(f[6], "tenders").map((t) => addr(t, 128, "component_", "tender")),
    withdrawals: arr(f[7], "withdrawals").map((w) => {
      const g = exact(w, 6, "withdrawal");
      return {
        id: num(g[0], "id"),
        amount: int(g[1], "amount"),
        to: addr(g[2], 128, "component_", "to"),
        signers: keys(g[3], "signers"),
        executed: bool(g[4], "executed"),
        isVoid: bool(g[5], "void"),
      };
    }),
    approverChanges: arr(f[8], "approver_changes").map((p) => {
      const g = exact(p, 6, "approver change");
      return {
        id: num(g[0], "id"),
        newApprovers: keys(g[1], "new_approvers"),
        newThreshold: num(g[2], "new_threshold"),
        signers: keys(g[3], "signers"),
        executed: bool(g[4], "executed"),
        isVoid: bool(g[5], "void"),
      };
    }),
    nextProposalId: num(f[9], "next_proposal_id"),
  };
}

const DECODER_WORDING =
  /expected an? (array|integer|bytes|text|boolean|tagged address)|outside the safe range|unknown .* index|component (substate|body|entry|header|state)|tender state has \d+ fields|circle state has \d+ fields|dispute record has \d+ fields|unexpected vault encoding|does not start with template bytes/;

/**
 * The plain-language version of a failed attempt to open or
 * verify an address. The decoders above speak in encoding
 * terms; a user who pastes the wrong kind of address should
 * hear what kind of thing the address is, or that the
 * component is not a tender or a circle, never decoder
 * vocabulary. Errors that are not about the address at all
 * (an indexer outage, a stall) pass through unchanged.
 */
export function plainAddressError(address: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // The kind branches name what an address belongs to, so they
  // are taken only for a well-formed id of that kind. A string
  // that merely starts with the prefix is not that kind of
  // address at all, and falls through to the message mapping.
  if (/^vault_[0-9a-f]{64}$/.test(address))
    return "that address belongs to a vault. a vault holds funds; it is not a tender or a circle, so there is no record to open for it.";
  if (/^resource_[0-9a-f]{64}$/.test(address))
    return "that address belongs to a resource. a resource is the kind of thing a vault holds; it is not a tender or a circle, so there is no record to open for it.";
  if (/^template_[0-9a-f]{64}$/.test(address))
    return "that address belongs to a template. a template is the code that tenders and circles run; it is not itself a tender or a circle, so there is no record to open for it.";
  if (/^not found on /.test(msg) || /has no live value/.test(msg))
    return "nothing was found at that address on this network. check the address, and that the app is showing the network it belongs to.";
  if (/is down/.test(msg))
    return "that component's record is not live on this network right now. it may have been replaced or removed.";
  if (DECODER_WORDING.test(msg))
    return "that component is not a tender or a circle. it is a different kind of component, or it belongs to another network.";
  return msg;
}
