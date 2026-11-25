// The falsification cards as shipped on the results screen.
// The data is generated from the captured verifier runs
// against the tampered records; these tests guard the joins,
// the headline rejections, and the claim boundary, so a
// generation that drops a card, drifts a quoted row, or
// overclaims fails here rather than on the page.
import { beforeEach, describe, expect, it } from "vitest";
import { App, cap } from "../src/app";
import {
  FALSIFICATION_CARDS,
  FALSIFICATION_CARDS_JSON,
  FALSIFICATION_META,
} from "../src/falsification-data";
import { EXCEPTION_INVOICE } from "../src/proof-data";
import { TENDER_RESULTS } from "../src/results-data";
import { renderResults } from "../src/screens/results";

const EXPECTED_IDS = [
  "award-price-lowered",
  "reveal-price-changed",
  "winner-swapped",
  "escrow-balance-inflated",
  "fabricated-cheaper-reveal",
  "reveal-omitted",
  "rationale-word-changed",
];

const byId = new Map(FALSIFICATION_CARDS.map((c) => [c.id, c]));

describe("falsification card data", () => {
  it("carries exactly the seven cards, in order, each joined to a results tender by address", () => {
    expect(FALSIFICATION_CARDS.map((c) => c.id)).toEqual(EXPECTED_IDS);
    const tenderAddrs = new Set(TENDER_RESULTS.map((t) => t.tender));
    for (const c of FALSIFICATION_CARDS) {
      expect(tenderAddrs.has(c.tender)).toBe(true);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.lie.length).toBeGreaterThan(0);
      expect(c.field.length).toBeGreaterThan(0);
      expect(c.originalText.length).toBeGreaterThan(0);
      expect(c.tamperedText.length).toBeGreaterThan(0);
      expect(c.originalText).not.toBe(c.tamperedText);
    }
  });

  it("every card is rejected by both verifiers, with the same failing checks in each", () => {
    for (const c of FALSIFICATION_CARDS) {
      expect(c.rejections.standalone.length).toBeGreaterThanOrEqual(1);
      expect(c.rejections.app.length).toBeGreaterThanOrEqual(1);
      expect(c.rejections.standalone.map((r) => r.check)).toEqual(
        c.rejections.app.map((r) => r.check),
      );
      for (const r of [...c.rejections.standalone, ...c.rejections.app]) {
        expect(r.check.length).toBeGreaterThan(0);
        expect(r.detail.length).toBeGreaterThan(0);
      }
      expect(c.passedText.standalone).toMatch(/^\d+ of \d+ checks passed$/);
      expect(c.passedText.app).toBe(c.passedText.standalone);
    }
  });

  it("the headline rejections are the expected ones", () => {
    const lead = (id: string) => {
      const c = byId.get(id)!;
      return [
        c.rejections.standalone[0].check,
        c.rejections.app[0].check,
      ];
    };
    expect(lead("award-price-lowered")).toEqual([
      "award is the lowest valid revealed price",
      "award is the lowest valid revealed price",
    ]);
    expect(lead("reveal-price-changed")).toEqual([
      "reveals verify against commitments",
      "reveals verify against commitments",
    ]);
    expect(lead("fabricated-cheaper-reveal")).toEqual([
      "record counts",
      "record counts",
    ]);
    const only = (id: string) => {
      const c = byId.get(id)!;
      return [
        c.rejections.standalone.map((r) => r.check),
        c.rejections.app.map((r) => r.check),
      ];
    };
    expect(only("escrow-balance-inflated")).toEqual([
      ["escrow funding"],
      ["escrow funding"],
    ]);
    expect(only("rationale-word-changed")).toEqual([
      ["override rationale text"],
      ["override rationale text"],
    ]);
  });

  it("the rationale card's original hash is the on-chain rationale hash, and its tampered hash is not", () => {
    const c = byId.get("rationale-word-changed")!;
    const hex = (s: string) => s.match(/[0-9a-f]{64}/)?.[0];
    expect(hex(c.originalText)).toBe(EXCEPTION_INVOICE.rationaleHash);
    expect(hex(c.tamperedText)).not.toBe(EXCEPTION_INVOICE.rationaleHash);
    expect(hex(c.tamperedText)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the control summaries are full passes in both verifiers", () => {
    expect(FALSIFICATION_META.controls.map((c) => c.tenderKey)).toEqual([
      "gate",
      "tie",
      "override",
    ]);
    const totals = { gate: 13, tie: 13, override: 15 };
    for (const c of FALSIFICATION_META.controls) {
      for (const v of [c.standalone, c.app]) {
        expect(v.total).toBe(totals[c.tenderKey as keyof typeof totals]);
        expect(v.pass).toBe(v.total);
        expect(v.fail).toBe(0);
        expect(v.couldNotRead).toBe(0);
      }
    }
  });

  it("the section's own copy stays inside the claim boundary", () => {
    const all = JSON.stringify({
      meta: FALSIFICATION_META,
      cards: FALSIFICATION_CARDS,
      download: FALSIFICATION_CARDS_JSON,
    });
    expect(all).not.toContain("burned");
    const prose = [
      FALSIFICATION_META.methodNote,
      ...FALSIFICATION_CARDS.map((c) => c.lie),
      ...FALSIFICATION_CARDS.map((c) => c.note ?? ""),
    ].join(" ");
    // No claim of proof over bids nobody revealed, in either
    // direction of the sentence.
    expect(prose).not.toMatch(
      /prov\w*[^.]*\b(unrevealed|never revealed|nobody revealed)\b/i,
    );
    expect(prose).not.toMatch(
      /\b(unrevealed|never revealed|nobody revealed)\b[^.]*\bpric\w*/i,
    );
  });

  it("the download payload is the cards file's kept content, with no internal pointers", () => {
    const parsed = JSON.parse(FALSIFICATION_CARDS_JSON);
    expect(parsed.schema).toBe("asiri-falsification-cards-1");
    expect(parsed.cards.map((c: { id: string }) => c.id)).toEqual(
      EXPECTED_IDS,
    );
    expect(FALSIFICATION_CARDS_JSON).not.toContain("falsification/records");
    expect(FALSIFICATION_CARDS_JSON).not.toContain("falsification/outputs");
    for (const pc of parsed.cards) {
      const shipped = byId.get(pc.id)!;
      expect(pc.rejections).toEqual(shipped.rejections);
      expect(pc.tender).toBe(shipped.tender);
      expect(pc.lie).toBe(shipped.lie);
    }
    expect(parsed.controls).toEqual({
      gate: {
        standalone: { pass: 13, fail: 0, could_not_read: 0, total: 13 },
        app: { pass: 13, fail: 0, could_not_read: 0, total: 13 },
      },
      tie: {
        standalone: { pass: 13, fail: 0, could_not_read: 0, total: 13 },
        app: { pass: 13, fail: 0, could_not_read: 0, total: 13 },
      },
      override: {
        standalone: { pass: 15, fail: 0, could_not_read: 0, total: 15 },
        app: { pass: 15, fail: 0, could_not_read: 0, total: 15 },
      },
    });
  });
});

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

describe("falsification section render", () => {
  it("renders all seven cards with both verifiers' rows and the controls", async () => {
    const app = new App();
    // The falsification section belongs to the esmeralda
    // view of the results screen; a fresh app opens on
    // mainnet, so put it on esmeralda first.
    app.setNetwork("esmeralda");
    const r = new FakeEl("div") as unknown as HTMLElement;
    await renderResults(app, r, () => {});
    const t = (r as unknown as FakeEl).textContent;
    expect(t).toContain("Falsification cards");
    for (const c of FALSIFICATION_CARDS) {
      expect(t).toContain(cap(c.title));
      expect(t).toContain(c.lie);
    }
    expect(t).toContain("standalone verifier: 11 of 13 checks passed");
    expect(t).toContain("app verifier: 14 of 15 checks passed");
    expect(t).toContain("control, the gate tender, untampered");
    expect(t).toContain("13 of 13 checks passed in both verifiers");
    expect(t).toContain("download the cards (json)");
    expect(t).toContain("the verdict was right and the sentence was wrong");
    // The boundary scan covers the falsification section only:
    // it is the last section on the screen, and the ledger
    // above it carries the standing "not burned" form, which
    // is the one allowed use of the word.
    const section = t.slice(t.indexOf("Falsification cards"));
    expect(section).not.toContain("burned");
  });
});
