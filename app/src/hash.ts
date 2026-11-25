// SHA-256 helpers and the two Asiri hash constructions, ported from
// asiri-types (canonical_rules_bytes, commitment_bytes). The template
// computes both with the engine's hashing intrinsics over exactly
// these byte layouts.
import { bytesToHex, hexToBytes } from "./cbor";
import type { TenderRules } from "./model";

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return new Uint8Array(digest);
}

function u128be(v: bigint): Uint8Array {
  if (v < 0n || v >= 1n << 128n) throw new Error(`Amount out of range: ${v}`);
  const out = new Uint8Array(16);
  let m = v;
  for (let i = 15; i >= 0; i--) {
    out[i] = Number(m & 0xffn);
    m >>= 8n;
  }
  return out;
}

function u64be(v: number): Uint8Array {
  const out = new Uint8Array(8);
  let m = BigInt(v);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(m & 0xffn);
    m >>= 8n;
  }
  return out;
}

function u32be(v: number): Uint8Array {
  return new Uint8Array([
    (v >>> 24) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 8) & 0xff,
    v & 0xff,
  ]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const enc = (s: string) => new TextEncoder().encode(s);

/** The exact bytes the template hashes to produce a rules hash. */
export function canonicalRulesBytes(r: TenderRules): Uint8Array {
  return concat([
    enc("asiri-rules-v1"),
    hexToBytes(r.specificationHash),
    u128be(r.budgetCap),
    u128be(r.bondAmount),
    u64be(r.bidWindowEpochs),
    u64be(r.revealWindowEpochs),
    u64be(r.overrideWindowEpochs),
    u64be(r.deliveryWindowEpochs),
    u64be(r.claimGraceEpochs),
    u64be(r.disputeWindowEpochs),
    u32be(r.approvalThreshold),
    u32be(r.disputeThreshold),
  ]);
}

export async function rulesHash(r: TenderRules): Promise<string> {
  return bytesToHex(await sha256(canonicalRulesBytes(r)));
}

/** The exact bytes the template hashes to check a bid reveal. */
export function commitmentBytes(
  price: bigint,
  salt: Uint8Array,
  paymentIdentityHex: string,
): Uint8Array {
  if (salt.length !== 32) throw new Error("Salt must be 32 bytes");
  return concat([
    enc("asiri-bid-v1"),
    u128be(price),
    salt,
    hexToBytes(paymentIdentityHex),
  ]);
}

export async function commitmentHash(
  price: bigint,
  salt: Uint8Array,
  paymentIdentityHex: string,
): Promise<string> {
  return bytesToHex(await sha256(commitmentBytes(price, salt, paymentIdentityHex)));
}
