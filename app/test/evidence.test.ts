// Evidence hashing: SHA-256 over a document's exact bytes,
// the match and mismatch paths of the check, and a pin on the
// season's method. The dispute tender's evidence hash was
// produced by make_scenarios.py as sha256 of the evidence
// text's UTF-8 bytes with no prefix or framing; the same text
// hashed here must land on the value the chain carries, which
// is what makes the in-browser file check the same computation
// the season ran.
import { describe, expect, it } from "vitest";
import { checkEvidence, sha256Hex } from "../src/evidence";

const enc = (s: string) => new TextEncoder().encode(s);

describe("sha256Hex", () => {
  it("matches the published SHA-256 test vectors", async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex(enc("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("reproduces the season's dispute evidence hash from its text", async () => {
    const evidenceText =
      "Dispute evidence for season tender 3. The winner states the 10 bags of garri " +
      "were delivered to the circle store on the agreed day, signed for by the store " +
      "keeper, and the circle then did not confirm delivery inside the app. The " +
      "delivery note and photographs are held by the winner.";
    expect(await sha256Hex(enc(evidenceText))).toBe(
      "ef74281e235a8bd7d7bfcd96a013826ccd391d3dc7a1047c1a664a8146687fcb",
    );
  });
});

describe("checkEvidence", () => {
  it("reports a match for the document the hash was taken from", async () => {
    const doc = enc("the delivery note, signed by the store keeper");
    const { hash } = await checkEvidence(doc, "0".repeat(64));
    const again = await checkEvidence(doc, hash);
    expect(again.hash).toBe(hash);
    expect(again.matches).toBe(true);
  });

  it("reports a mismatch for any other document, and for a case-different hash only after normalising", async () => {
    const doc = enc("the delivery note, signed by the store keeper");
    const { hash } = await checkEvidence(doc, "0".repeat(64));
    const other = await checkEvidence(enc("a different note"), hash);
    expect(other.matches).toBe(false);
    const upper = await checkEvidence(doc, hash.toUpperCase());
    expect(upper.matches).toBe(true);
  });
});

// The controls' change handlers are async: a slow read of an
// earlier pick can finish after a newer pick's. The controls
// guard by generation, and these tests drive the handlers
// through a fake DOM whose listeners can actually fire, with
// file reads whose resolution order the test controls.
import { evidenceCheckControl, hashFileControl } from "../src/screens/evidence-ui";

class EventEl {
  className = "";
  type = "";
  value = "";
  files: { arrayBuffer: () => Promise<ArrayBuffer> }[] = [];
  children: EventEl[] = [];
  private ownText = "";
  private handlers = new Map<string, (() => void)[]>();
  constructor(public tag: string) {}
  get classList() {
    const self = this;
    return {
      contains: (c: string) => self.className.split(/\s+/).includes(c),
      add: (c: string) => {
        if (!self.classList.contains(c))
          self.className = self.className ? `${self.className} ${c}` : c;
      },
    };
  }
  set textContent(v: string) {
    this.ownText = v;
    this.children = [];
  }
  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  append(...nodes: unknown[]): void {
    for (const n of nodes) {
      if (n instanceof EventEl) this.children.push(n);
      else {
        const t = new EventEl("#text");
        t.ownText = (n as { text?: string })?.text ?? String(n);
        this.children.push(t);
      }
    }
  }
  addEventListener(type: string, fn: () => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  fire(type: string): void {
    for (const fn of this.handlers.get(type) ?? []) fn();
  }
  find(tag: string): EventEl | undefined {
    for (const c of this.children) {
      if (c.tag === tag) return c;
      const hit = c.find(tag);
      if (hit) return hit;
    }
    return undefined;
  }
  findClass(cls: string): EventEl | undefined {
    for (const c of this.children) {
      if (c.className === cls) return c;
      const hit = c.findClass(cls);
      if (hit) return hit;
    }
    return undefined;
  }
}

(globalThis as { document?: unknown }).document = {
  createElement: (tag: string) => new EventEl(tag),
  createTextNode: (text: string) => ({ text }),
};

const bufOf = (s: string): ArrayBuffer => {
  const u = enc(s);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("evidence controls under a pick race", () => {
  it("the fill control takes the last pick's hash, not the slowest read's", async () => {
    const fills: string[] = [];
    const control = hashFileControl(
      (h) => fills.push(h),
      () => {},
    ) as unknown as EventEl;
    const input = control.find("input")!;
    let resolveA!: (v: ArrayBuffer) => void;
    input.files = [
      { arrayBuffer: () => new Promise<ArrayBuffer>((r) => (resolveA = r)) },
    ];
    input.fire("change");
    const bBytes = enc("the second document");
    input.files = [{ arrayBuffer: async () => bufOf("the second document") }];
    input.fire("change");
    await settle();
    resolveA(bufOf("the first document"));
    await settle();
    expect(fills).toEqual([await sha256Hex(bBytes)]);
  });

  it("the check control keeps the last pick's verdict", async () => {
    const target = await sha256Hex(enc("the second document"));
    const control = evidenceCheckControl(target) as unknown as EventEl;
    const input = control.find("input")!;
    const result = control.findClass("small mt")!;
    let resolveA!: (v: ArrayBuffer) => void;
    input.files = [
      { arrayBuffer: () => new Promise<ArrayBuffer>((r) => (resolveA = r)) },
    ];
    input.fire("change");
    input.files = [
      { arrayBuffer: async () => bufOf("the second document") },
    ];
    input.fire("change");
    await settle();
    expect(result.textContent).toBe("This document matches the hash on chain.");
    resolveA(bufOf("the first document"));
    await settle();
    expect(result.textContent).toBe("This document matches the hash on chain.");
  });
});
