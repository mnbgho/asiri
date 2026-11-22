// Hashing documents against the hashes the chain carries.
//
// A dispute's evidence hash, an override's rationale hash, and
// a dispute resolution's rationale hash are all plain SHA-256
// over the exact bytes of a document the participants publish
// between themselves. The season record proves the method: the
// dispute tender's evidence hash ef74281e… is the SHA-256 of
// the evidence text's UTF-8 bytes, with no prefix or framing
// (make_scenarios.py in the workspace, h(text) =
// sha256(text.encode())). A file whose bytes are exactly those
// bytes hashes to the same value, so hashing a picked file's
// bytes here is the same computation the season ran.
//
// The file never leaves the browser: the picker hands its
// bytes to crypto.subtle on this machine and only the digest
// is compared or filled into a form.
import { bytesToHex } from "./cbor";
import { sha256 } from "./hash";

/** The SHA-256 of a document's exact bytes, as lowercase hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(await sha256(bytes));
}

/**
 * Hash a document and compare it with the hash on chain. The
 * comparison is over the digest alone: a match proves the
 * document is byte for byte the one the hash was taken from,
 * and nothing more.
 */
export async function checkEvidence(
  bytes: Uint8Array,
  expectedHash: string,
): Promise<{ hash: string; matches: boolean }> {
  const hash = await sha256Hex(bytes);
  return { hash, matches: hash === expectedHash.trim().toLowerCase() };
}
