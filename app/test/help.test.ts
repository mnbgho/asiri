// Render checks for the help surface, the evidence file
// controls, and the seller desk's backup box, all without a
// wallet. The DOM here is a small fake implementing exactly
// what the screens touch, as in copy-gating.test.ts. The help
// answers are also scanned against the claim boundary: an
// unrevealed bond's locked half is never called burned, and
// no answer claims proof over bids nobody revealed.
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app";
import { mergeBids } from "../src/screens/seller";
import { renderHelp } from "../src/screens/help";
import { renderSeller } from "../src/screens/seller";
import { evidenceCheckControl, hashFileControl } from "../src/screens/evidence-ui";

class FakeEl {
  className = "";
  value = "";
  rows = 0;
  placeholder = "";
  type = "";
  disabled = false;
  href = "";
  id = "";
  dataset: Record<string, string> = {};
  children: FakeEl[] = [];
  private ownText = "";
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
  private adopt(node: unknown): FakeEl {
    if (node instanceof FakeEl) return node;
    const t = new FakeEl("#text");
    t.ownText = (node as { text?: string })?.text ?? String(node);
    return t;
  }
  append(...nodes: unknown[]): void {
    for (const n of nodes) this.children.push(this.adopt(n));
  }
  prepend(...nodes: unknown[]): void {
    for (const n of [...nodes].reverse()) this.children.unshift(this.adopt(n));
  }
  replaceChildren(...nodes: unknown[]): void {
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(): void {}
  querySelectorAll(sel: string): FakeEl[] {
    const cls = sel.replace(/^\./, "");
    const out: FakeEl[] = [];
    const walk = (el: FakeEl) => {
      for (const c of el.children) {
        if (c.classList.contains(cls)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  remove(): void {}
}

(globalThis as { document?: unknown }).document = {
  createElement: (tag: string) => new FakeEl(tag),
  createTextNode: (text: string) => ({ text }),
};

const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
});

const go = () => {};
const root = () => new FakeEl("div") as unknown as HTMLElement;
const text = (r: HTMLElement) => (r as unknown as FakeEl).textContent;

describe("help surface", () => {
  it("answers the first-month questions in the product's own terms", async () => {
    const app = new App();
    const r = root();
    await renderHelp(app, r);
    const t = text(r);
    for (const q of [
      "What is an epoch?",
      "What happens if i never reveal my bid?",
      "How do bonds and forfeits work?",
      "What is an override, and what does it cost the circle?",
      "How does verification work, and what does could not be read mean?",
      "Where does tari come from?",
      "What does it cost to use asiri?",
      "I lost my salt. can it be recovered?",
      "My transaction failed. what do i do?",
    ]) {
      expect(t).toContain(q);
    }
    // The expiry exception and the locked half, in boundary words.
    expect(t).toContain("an unrevealed bond comes back whole");
    expect(t).toContain("stays locked in the tender forever");
    expect(t).not.toContain("burned");
    // The override's cost, from the season record.
    expect(t).toContain("paid 16 tari where the lowest revealed price was 14 tari");
    // Could-not-read, funding for both networks, fees, no recovery.
    expect(t).toContain("could not be read");
    expect(t).toContain("pilot circles are funded on request");
    expect(t).toContain("created only by burning xtm");
    expect(t).toContain("about 0.0051 tari");
    expect(t).toContain("there is no recovery path");
    expect(t).toContain("failed on chain");
  });
});

describe("evidence controls", () => {
  it("the check control names the hash and keeps the document in the browser", () => {
    const c = evidenceCheckControl("ab".repeat(32)) as unknown as FakeEl;
    expect(c.textContent).toContain("check a document against this hash:");
    expect(c.textContent).toContain("never leaves it");
    expect(c.textContent).toContain("byte for byte the one this hash was taken from");
  });

  it("the fill control offers to hash a document into a field", () => {
    const c = hashFileControl(() => {}, () => {}) as unknown as FakeEl;
    expect(c.textContent).toContain("or pick the document and the app fills in its hash:");
    expect(c.textContent).toContain("only the hash goes on chain");
  });
});

describe("seller desk backup box", () => {
  it("offers import with no bids saved, and no downloads", async () => {
    const app = new App();
    const r = root();
    await renderSeller(app, r, go);
    const t = text(r);
    expect(t).toContain("Back up your bids");
    expect(t).toContain("whoever holds the file can reveal those bids");
    expect(t).toContain("there is no recovery path");
    expect(t).toContain("import a backup file");
    expect(t).not.toContain("download a plain backup");
  });

  it("offers both downloads once a bid is saved", async () => {
    mergeBids([
      {
        tender: "component_" + "11".repeat(32),
        price: "1500000",
        saltHex: "ab".repeat(32),
        identity: "01".repeat(32),
        commitment: "cd".repeat(32),
      },
    ]);
    const app = new App();
    const r = root();
    await renderSeller(app, r, go);
    const t = text(r);
    expect(t).toContain("download a plain backup");
    expect(t).toContain("download an encrypted backup");
    expect(t).toContain("if you forget it, the encrypted file cannot be opened");
  });
});
