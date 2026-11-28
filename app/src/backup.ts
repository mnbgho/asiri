// Backups of the bid and reveal screen's saved bids.
//
// A saved bid is the only copy of its salt anywhere: the
// commitment on chain is a one-way hash, and neither the app,
// the circle, nor the network can work a salt back out of it.
// A backup file is the seller's own copy of the bid records,
// kept wherever the seller keeps it. Whoever holds the file
// can reveal the bids in it, so the copy below says so plainly
// and never implies a recovery path exists: there is none.
//
// Two forms. The plain form is the records as JSON. The
// encrypted form locks the same JSON under a passphrase the
// seller chooses, with the platform's standard construction
// only: PBKDF2 with SHA-256 derives an AES-GCM key, and the
// AES-GCM authentication tag is what makes a wrong passphrase
// fail instead of decrypting to nonsense. The app keeps no
// copy of the passphrase, so a forgotten one opens nothing.

import { hexToBytes } from "./cbor";
import { commitmentHash } from "./hash";

export interface BidBackupRecord {
  tender: string;
  price: string; // µT as a decimal string
  saltHex: string;
  identity: string;
  commitment: string;
}

const PLAIN_FORMAT = "asiri-bids";
const ENCRYPTED_FORMAT = "asiri-bids-encrypted";
const PBKDF2_ITERATIONS = 310_000;

const HEX64 = /^[0-9a-f]{64}$/i;

function validateBid(raw: unknown): BidBackupRecord {
  const bad = () =>
    new Error(
      "One of the bids in that file is incomplete or damaged, so nothing was imported.",
    );
  if (typeof raw !== "object" || raw === null) throw bad();
  const r = raw as Record<string, unknown>;
  if (typeof r.tender !== "string" || !r.tender) throw bad();
  if (typeof r.price !== "string" || !/^\d+$/.test(r.price)) throw bad();
  if (typeof r.saltHex !== "string" || !HEX64.test(r.saltHex)) throw bad();
  if (typeof r.identity !== "string" || !HEX64.test(r.identity)) throw bad();
  if (typeof r.commitment !== "string" || !HEX64.test(r.commitment))
    throw bad();
  return {
    tender: r.tender,
    price: r.price,
    saltHex: r.saltHex.toLowerCase(),
    identity: r.identity.toLowerCase(),
    commitment: r.commitment.toLowerCase(),
  };
}

/** The plain backup file: the bid records as JSON text. */
export function serializeBids(bids: readonly BidBackupRecord[]): string {
  return JSON.stringify({ format: PLAIN_FORMAT, version: 1, bids }, null, 2);
}

/**
 * Recompute each bid's commitment from its own price, salt,
 * and identity, and compare it with the commitment in the
 * record. A bid that does not match its own commitment is
 * damaged or tampered with, so the whole file is refused
 * before anything is imported: a file with one bad bid may
 * hold more damage the check cannot see.
 */
export async function checkBidsMatchCommitments(
  bids: readonly BidBackupRecord[],
): Promise<void> {
  for (const bid of bids) {
    let recomputed: string;
    try {
      recomputed = await commitmentHash(
        BigInt(bid.price),
        hexToBytes(bid.saltHex),
        bid.identity,
      );
    } catch {
      throw new Error(
        "That file holds a bid that does not match its own commitment. Nothing was imported. Check the file and try again.",
      );
    }
    if (recomputed !== bid.commitment) {
      throw new Error(
        "That file holds a bid that does not match its own commitment. Nothing was imported. Check the file and try again.",
      );
    }
  }
}

/** Read a plain backup file back into bid records. */
export async function parseBidsFile(text: string): Promise<BidBackupRecord[]> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("That file is not an Asiri bids backup.");
  }
  if (
    typeof doc !== "object" ||
    doc === null ||
    (doc as { format?: unknown }).format !== PLAIN_FORMAT ||
    !Array.isArray((doc as { bids?: unknown }).bids)
  ) {
    throw new Error("That file is not an Asiri bids backup.");
  }
  const bids = (doc as { bids: unknown[] }).bids.map(validateBid);
  await checkBidsMatchCommitments(bids);
  return bids;
}

/** True when the file is the encrypted form and needs a passphrase. */
export function isEncryptedBackup(text: string): boolean {
  try {
    const doc = JSON.parse(text) as { format?: unknown };
    return doc?.format === ENCRYPTED_FORMAT;
  } catch {
    return false;
  }
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** The encrypted backup file: the plain JSON locked under a passphrase. */
export async function encryptBids(
  bids: readonly BidBackupRecord[],
  passphrase: string,
): Promise<string> {
  if (!passphrase) throw new Error("Choose a passphrase first.");
  const kdfSalt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, kdfSalt, PBKDF2_ITERATIONS);
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(serializeBids(bids)),
  );
  return JSON.stringify(
    {
      format: ENCRYPTED_FORMAT,
      version: 1,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: PBKDF2_ITERATIONS,
        salt: toB64(kdfSalt),
      },
      cipher: { name: "AES-GCM", iv: toB64(iv) },
      data: toB64(new Uint8Array(data)),
    },
    null,
    2,
  );
}

/**
 * Open an encrypted backup file. A wrong passphrase fails the
 * AES-GCM authentication check, and a damaged file fails its
 * parsing; both reach the user as one plain statement, because
 * the cryptography cannot tell them apart either.
 *
 * The envelope's parameters are held to the exporter's own
 * construction: an importer that accepted a one-iteration key
 * derivation, a fixed or empty salt, or a short IV would let
 * a file made elsewhere carry weaker protection than anything
 * this app produces, and an unbounded iteration count would
 * let a crafted file hang the tab on import.
 */
export async function decryptBidsFile(
  text: string,
  passphrase: string,
): Promise<BidBackupRecord[]> {
  const fail = () =>
    new Error(
      "That file could not be opened. The passphrase may be wrong, or the file is damaged or is not an Asiri backup.",
    );
  if (!passphrase)
    throw new Error("Enter the backup's passphrase and try again.");
  let doc: {
    kdf?: { name?: unknown; hash?: unknown; iterations?: unknown; salt?: unknown };
    cipher?: { name?: unknown; iv?: unknown };
    data?: unknown;
  };
  try {
    doc = JSON.parse(text);
  } catch {
    throw fail();
  }
  if (
    !isEncryptedBackup(text) ||
    doc.kdf?.name !== "PBKDF2" ||
    doc.kdf?.hash !== "SHA-256" ||
    typeof doc.kdf?.iterations !== "number" ||
    doc.kdf.iterations < 100_000 ||
    doc.kdf.iterations > 5_000_000 ||
    doc.cipher?.name !== "AES-GCM" ||
    typeof doc.kdf?.salt !== "string" ||
    typeof doc.cipher?.iv !== "string" ||
    typeof doc.data !== "string"
  ) {
    throw fail();
  }
  let plainText: string;
  try {
    const kdfSalt = fromB64(doc.kdf.salt);
    const iv = fromB64(doc.cipher.iv);
    if (kdfSalt.length !== 16 || iv.length !== 12) throw fail();
    const key = await deriveKey(passphrase, kdfSalt, doc.kdf.iterations);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      fromB64(doc.data) as BufferSource,
    );
    plainText = new TextDecoder().decode(plain);
  } catch {
    throw fail();
  }
  // The integrity check runs outside the decrypt catch, so a
  // decrypted file with a bad bid reports the bad bid in plain
  // words instead of the generic open failure.
  return parseBidsFile(plainText);
}
