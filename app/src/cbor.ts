// CBOR encoding and decoding for Ootle call arguments and component
// state, in the exact dialect tari_bor 0.17 produces. Every encoder
// here is checked byte for byte against values produced by the pinned
// Rust crates (see test/fixtures.ts, generated with tari_bor::encode).
//
// The dialect, as measured:
// - unsigned integers are plain CBOR; above u64 they become tag 2
//   (unsigned bignum) over big-endian bytes, which is how Amount
//   encodes once it outgrows 64 bits.
// - Hash32 and public keys are byte strings. ComponentAddress is
//   tag 128 over its bytes, ResourceAddress is tag 131.
// - Option is null for None and the bare inner value for Some.
// - Structs are arrays of their fields in declaration order.
// - Enums are [variant index, [fields]].
// - Vec<u8> is an array of numbers, not a byte string.

export type CborValue =
  | bigint
  | number
  | string
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>
  | Tagged
  | boolean
  | null;

export class Tagged {
  constructor(
    public tag: number,
    public value: CborValue,
  ) {}
}

export const TAG_COMPONENT = 128;
export const TAG_RESOURCE = 131;

// ---------- encoding ----------

type Bytes = number[];

function head(out: Bytes, major: number, n: bigint): void {
  if (n < 24n) out.push(major | Number(n));
  else if (n < 0x100n) out.push(major | 24, Number(n));
  else if (n < 0x10000n)
    out.push(major | 25, Number(n >> 8n), Number(n & 0xffn));
  else if (n < 0x100000000n) {
    out.push(major | 26);
    for (let s = 24n; s >= 0n; s -= 8n) out.push(Number((n >> s) & 0xffn));
  } else {
    out.push(major | 27);
    for (let s = 56n; s >= 0n; s -= 8n) out.push(Number((n >> s) & 0xffn));
  }
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0)
    throw new Error(`not hex: ${hex.slice(0, 24)}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** An unsigned integer: u32, u64, or an Amount (µT). */
export function encUint(v: bigint | number): Bytes {
  const n = BigInt(v);
  if (n < 0n) throw new Error(`negative unsigned value: ${n}`);
  const out: Bytes = [];
  if (n < 1n << 64n) {
    head(out, 0x00, n);
    return out;
  }
  // Tag 2 unsigned bignum over the minimal big-endian bytes.
  const raw: Bytes = [];
  let m = n;
  while (m > 0n) {
    raw.unshift(Number(m & 0xffn));
    m >>= 8n;
  }
  head(out, 0xc0, 2n);
  head(out, 0x40, BigInt(raw.length));
  out.push(...raw);
  return out;
}

export function encBytes(b: Uint8Array): Bytes {
  const out: Bytes = [];
  head(out, 0x40, BigInt(b.length));
  out.push(...b);
  return out;
}

export function encText(s: string): Bytes {
  const bytes = [...new TextEncoder().encode(s)];
  const out: Bytes = [];
  head(out, 0x60, BigInt(bytes.length));
  out.push(...bytes);
  return out;
}

export function encArray(items: Bytes[]): Bytes {
  const out: Bytes = [];
  head(out, 0x80, BigInt(items.length));
  for (const it of items) out.push(...it);
  return out;
}

export function encTagged(tag: number, inner: Bytes): Bytes {
  const out: Bytes = [];
  head(out, 0xc0, BigInt(tag));
  out.push(...inner);
  return out;
}

export function encBool(v: boolean): Bytes {
  return [v ? 0xf5 : 0xf4];
}

export const encNull: Bytes = [0xf6];

/** Address body: 64 lowercase hex chars with the prefix stripped. */
export function addressBytes(address: string, prefix: string): Uint8Array {
  const body = address.startsWith(prefix)
    ? address.slice(prefix.length)
    : address;
  if (!/^[0-9a-f]{64}$/.test(body))
    throw new Error(`not a ${prefix.slice(0, -1)} address: ${address}`);
  return hexToBytes(body);
}

export function toHex(bytes: Bytes): string {
  return bytes.map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------- decoding ----------

export function decode(bytes: Uint8Array): CborValue {
  let i = 0;
  const readByte = (): number => {
    if (i >= bytes.length) throw new Error("truncated CBOR");
    return bytes[i++];
  };
  const uint = (info: number): bigint => {
    if (info < 24) return BigInt(info);
    const len =
      info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : -1;
    if (len < 0) throw new Error(`unsupported CBOR length ${info}`);
    let v = 0n;
    for (let k = 0; k < len; k++) v = (v << 8n) | BigInt(readByte());
    return v;
  };
  const item = (): CborValue => {
    const b = readByte();
    const major = b >> 5;
    const info = b & 31;
    switch (major) {
      case 0:
        return uint(info);
      case 1:
        return -1n - uint(info);
      case 2: {
        const n = Number(uint(info));
        if (i + n > bytes.length) throw new Error("truncated CBOR");
        const v = bytes.slice(i, i + n);
        i += n;
        return v;
      }
      case 3: {
        const n = Number(uint(info));
        if (i + n > bytes.length) throw new Error("truncated CBOR");
        const v = new TextDecoder().decode(bytes.slice(i, i + n));
        i += n;
        return v;
      }
      case 4: {
        const n = Number(uint(info));
        return Array.from({ length: n }, item);
      }
      case 5: {
        const n = Number(uint(info));
        const m = new Map<CborValue, CborValue>();
        for (let k = 0; k < n; k++) m.set(item(), item());
        return m;
      }
      case 6: {
        const tag = Number(uint(info));
        const v = item();
        if (tag === 2 && v instanceof Uint8Array)
          return v.reduce((acc, x) => (acc << 8n) | BigInt(x), 0n);
        return new Tagged(tag, v);
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22 || info === 23) return null;
        throw new Error(`unsupported CBOR simple value ${info}`);
    }
    throw new Error("bad CBOR");
  };
  const v = item();
  if (i !== bytes.length)
    throw new Error(`trailing bytes in CBOR value (${bytes.length - i} extra)`);
  return v;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return out;
}
