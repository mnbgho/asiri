// File pickers for the hashes the chain carries: one fills a
// hash field from a document, the other checks a document
// against a hash already on chain. Both hash in the browser
// (see evidence.ts): the document itself never leaves the
// visitor's machine, and the copy says so wherever the picker
// appears.
import { el, setAria } from "../app";
import { checkEvidence, sha256Hex } from "../evidence";

async function fileBytes(input: HTMLInputElement): Promise<Uint8Array> {
  const file = input.files?.[0];
  if (!file) throw new Error("Choose a document first");
  return new Uint8Array(await file.arrayBuffer());
}

function fileInput(accessibleName: string): HTMLInputElement {
  const input = el("input");
  input.type = "file";
  // The sentence above the picker describes it; the input
  // carries that as its accessible name.
  setAria(input, "aria-label", accessibleName);
  return input;
}

/**
 * A picker that hashes the chosen document and hands the
 * digest to onHash, for filling a hash field the user would
 * otherwise have to compute elsewhere and paste.
 */
export function hashFileControl(
  onHash: (hex: string) => void,
  onError: (e: unknown) => void,
): HTMLElement {
  const wrap = el("div", "mt");
  const input = fileInput("Choose the document to hash");
  // A slow read of an earlier pick must not land after a
  // newer one: each change takes a generation number, and
  // only the latest generation may fill the field or report.
  let generation = 0;
  input.addEventListener("change", () => {
    const mine = ++generation;
    void (async () => {
      try {
        const hex = await sha256Hex(await fileBytes(input));
        if (mine === generation) onHash(hex);
      } catch (e) {
        if (mine === generation) onError(e);
      }
    })();
  });
  wrap.append(
    el("div", "small", "Or pick the document and the app fills in its hash:"),
    input,
    el(
      "div",
      "hint",
      "The document is hashed in your browser and never leaves it. Only the hash goes on chain.",
    ),
  );
  return wrap;
}

/**
 * A picker that hashes the chosen document and states plainly
 * whether it matches the hash shown beside it on chain.
 */
export function evidenceCheckControl(expectedHash: string): HTMLElement {
  const wrap = el("div", "mt");
  const input = fileInput("Choose a document to check against this hash");
  const result = el("div", "small mt");
  // The match answer is a status: announced when it lands.
  setAria(result, "role", "status");
  // Same guard as the fill control: an earlier pick's slower
  // check must not overwrite the verdict for the document the
  // visitor picked last.
  let generation = 0;
  input.addEventListener("change", () => {
    const mine = ++generation;
    void (async () => {
      try {
        const { matches } = await checkEvidence(
          await fileBytes(input),
          expectedHash,
        );
        if (mine !== generation) return;
        result.textContent = matches
          ? "This document matches the hash on chain."
          : "This document does not match the hash on chain.";
      } catch {
        if (mine === generation)
          result.textContent = "That document could not be read.";
      }
    })();
  });
  wrap.append(
    el("div", "small", "Check a document against this hash:"),
    input,
    el(
      "div",
      "hint",
      "The document is hashed in your browser and never leaves it. A match proves the document is byte for byte the one this hash was taken from.",
    ),
    result,
  );
  return wrap;
}
