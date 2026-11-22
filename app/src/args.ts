// Builders for transaction instruction arguments, in the JSON shape
// the window.tari provider takes: { Literal: hex } carrying the
// tari_bor encoding of the value, or { Workspace: { id, offset } }.
import {
  addressBytes,
  encArray,
  encBool,
  encBytes,
  encNull,
  encTagged,
  encText,
  encUint,
  hexToBytes,
  TAG_COMPONENT,
  TAG_RESOURCE,
  toHex,
} from "./cbor";
import type { TenderRules } from "./model";

export type Arg = { Literal: string } | { Workspace: { id: number; offset: number | null } };

const lit = (bytes: number[]): Arg => ({ Literal: toHex(bytes) });

export const arg = {
  uint: (v: bigint | number): Arg => lit(encUint(v)),
  /** An Amount in µT. */
  amount: (v: bigint): Arg => lit(encUint(v)),
  text: (s: string): Arg => lit(encText(s)),
  bool: (v: boolean): Arg => lit(encBool(v)),
  /** A 32-byte hash (Hash32) given as 64 hex chars. */
  hash: (hex: string): Arg => lit(encBytes(hexToBytes(hex))),
  /** A Ristretto public key given as 64 hex chars. */
  pubkey: (hex: string): Arg => lit(encBytes(hexToBytes(hex))),
  pubkeys: (hexes: string[]): Arg =>
    lit(encArray(hexes.map((h) => encBytes(hexToBytes(h))))),
  component: (address: string): Arg =>
    lit(encTagged(TAG_COMPONENT, encBytes(addressBytes(address, "component_")))),
  components: (addresses: string[]): Arg =>
    lit(
      encArray(
        addresses.map((a) =>
          encTagged(TAG_COMPONENT, encBytes(addressBytes(a, "component_"))),
        ),
      ),
    ),
  resource: (address: string): Arg =>
    lit(encTagged(TAG_RESOURCE, encBytes(addressBytes(address, "resource_")))),
  /** Option<public key>: null for None, the bare key for Some. */
  optPubkey: (hex: string | null): Arg =>
    hex === null ? lit(encNull) : lit(encBytes(hexToBytes(hex))),
  /** Option<ComponentAddress>. */
  optComponent: (address: string | null): Arg =>
    address === null
      ? lit(encNull)
      : lit(encTagged(TAG_COMPONENT, encBytes(addressBytes(address, "component_")))),
  /** Option<Hash32>. */
  optHash: (hex: string | null): Arg =>
    hex === null ? lit(encNull) : lit(encBytes(hexToBytes(hex))),
  /** Option<u64> (a proposal id in the override flow). */
  optUint: (v: bigint | number | null): Arg =>
    v === null ? lit(encNull) : lit(encUint(v)),
  /**
   * Option<TemplateAddress>. A template address is a bare hash in
   * this stack: it encodes as plain bytes, with no tag (measured
   * against tari_bor, see test/fixtures.ts).
   */
  optTemplate: (address: string | null): Arg =>
    address === null
      ? lit(encNull)
      : lit(encBytes(addressBytes(address, "template_"))),
  /** A Vec<u8>: an array of numbers, not a byte string. */
  byteVec: (b: Uint8Array): Arg => lit(encArray([...b].map((x) => encUint(x)))),
  /** TenderRules as one struct argument, fields in declaration order. */
  rules: (r: TenderRules): Arg =>
    lit(
      encArray([
        encBytes(hexToBytes(r.specificationHash)),
        encUint(r.budgetCap),
        encUint(r.bondAmount),
        encUint(r.bidWindowEpochs),
        encUint(r.revealWindowEpochs),
        encUint(r.overrideWindowEpochs),
        encUint(r.deliveryWindowEpochs),
        encUint(r.claimGraceEpochs),
        encUint(r.disputeWindowEpochs),
        encUint(r.approvalThreshold),
        encUint(r.disputeThreshold),
      ]),
    ),
  workspace: (id: number): Arg => ({ Workspace: { id, offset: null } }),
};

/** The native token resource address on every Ootle network. */
export const TARI_TOKEN =
  "resource_0101010101010101010101010101010101010101010101010101010101010101";
