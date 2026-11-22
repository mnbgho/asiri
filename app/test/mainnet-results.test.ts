import { beforeEach, describe, it, expect } from "vitest";
import { App } from "../src/app";
import { bytesToHex } from "../src/cbor";
import { sha256 } from "../src/hash";
import {
  MAINNET_TENDER_RECEIPTS,
} from "../src/mainnet-receipts-data";
import {
  MAINNET_RESULTS_META,
  MAINNET_TENDER_RECORDS,
} from "../src/mainnet-results-data";
import { renderResults } from "../src/screens/results";

async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(await sha256(new TextEncoder().encode(text)));
}

// The mainnet records are generated from the season's
// evidence record. These tests guard the shape and the
// record's own arithmetic: a malformed generation must fail
// here rather than render a broken or empty results screen.
describe("mainnet results data", () => {
  it("is bound to mainnet and the heartland circle", () => {
    expect(MAINNET_RESULTS_META.network).toBe("mainnet");
    expect(MAINNET_RESULTS_META.circle).toMatch(/^component_[0-9a-f]{64}$/);
    expect(MAINNET_RESULTS_META.circleName).toBe(
      "Heartland Provisions Circle",
    );
  });

  it("lists the six season tenders with unique keys and full addresses", () => {
    expect(MAINNET_TENDER_RECORDS).toHaveLength(6);
    expect(MAINNET_TENDER_RECORDS.map((t) => t.key)).toEqual([
      "gate",
      "tie",
      "override",
      "dispute",
      "expiry",
      "scale",
    ]);
    for (const t of MAINNET_TENDER_RECORDS) {
      expect(t.tender).toMatch(/^component_[0-9a-f]{64}$/);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.proves.length).toBeGreaterThan(0);
    }
  });

  it("every tender passed both verifiers in full", () => {
    for (const t of MAINNET_TENDER_RECORDS) {
      expect(t.standalonePass).toBe(t.standaloneTotal);
      expect(t.appPass).toBe(t.appTotal);
      expect(t.standaloneTotal).toBeGreaterThanOrEqual(10);
    }
  });

  it("the escrow identity closes on every tender", () => {
    for (const t of MAINNET_TENDER_RECORDS) {
      expect((t.paidMicro ?? 0) + t.refundMicro).toBe(t.capMicro);
    }
  });

  it("the fee totals sum to the season total", () => {
    const sum = MAINNET_TENDER_RECORDS.reduce((a, t) => a + t.feesMicro, 0);
    expect(sum).toBe(MAINNET_RESULTS_META.totalFeesMicro);
  });

  it("only the override carries a proven lowest price and a rationale hash", () => {
    for (const t of MAINNET_TENDER_RECORDS) {
      if (t.key === "override") {
        expect(t.provenLowestMicro).not.toBeNull();
        expect(t.paidMicro).toBeGreaterThan(t.provenLowestMicro!);
        expect(t.rationaleHash).toMatch(/^[0-9a-f]{64}$/);
      } else {
        expect(t.provenLowestMicro).toBeNull();
        expect(t.rationaleHash).toBeNull();
      }
    }
  });

  it("only the expiry tender paid nothing", () => {
    for (const t of MAINNET_TENDER_RECORDS) {
      if (t.key === "expiry") {
        expect(t.state).toBe("expired");
        expect(t.paidMicro).toBeNull();
        expect(t.reveals).toBe(0);
      } else {
        expect(t.state).toBe("settled");
        expect(t.paidMicro).not.toBeNull();
        expect(t.reveals).toBeGreaterThan(0);
      }
    }
  });
});

// The mainnet receipts are generated from the receipt files
// themselves: the standalone verifier's own output from a live
// run against the public mainnet indexer. These tests guard
// the joins and the figures the way the esmeralda receipt
// tests do: a generation that drops a receipt, mislabels its
// provenance, or drifts a number must fail here.
describe("mainnet receipts", () => {
  it("carries one receipt for every mainnet record, in order", () => {
    expect(MAINNET_TENDER_RECEIPTS).toHaveLength(6);
    expect(MAINNET_TENDER_RECEIPTS.map((r) => r.key)).toEqual([
      "gate",
      "tie",
      "override",
      "dispute",
      "expiry",
      "scale",
    ]);
    const byTender = new Map(
      MAINNET_TENDER_RECEIPTS.map((r) => [r.tender, r]),
    );
    for (const t of MAINNET_TENDER_RECORDS) {
      expect(byTender.has(t.tender)).toBe(true);
    }
  });

  it("the json is the receipt file itself, hash and all", async () => {
    for (const r of MAINNET_TENDER_RECEIPTS) {
      expect(await sha256Hex(r.json)).toBe(r.sha256);
      const parsed = JSON.parse(r.json);
      expect(parsed.receipt_version).toBe("asiri-receipt-1");
      expect(parsed.network).toBe("mainnet");
      expect(parsed.tender).toBe(r.tender);
      expect(parsed.checks_summary).toEqual({
        pass: r.pass,
        fail: r.fail,
        could_not_read: r.couldNotRead,
      });
      expect(parsed.provenance.reveal_transactions).toBe(
        r.revealProvenance,
      );
      expect(parsed.checks).toEqual(r.checks);
    }
  });

  it("every mainnet receipt passes in full from the indexer", () => {
    const expected: Record<string, number> = {
      gate: 13,
      tie: 13,
      override: 15,
      dispute: 13,
      expiry: 10,
      scale: 13,
    };
    for (const r of MAINNET_TENDER_RECEIPTS) {
      expect(r.pass).toBe(expected[r.key]);
      expect(r.fail).toBe(0);
      expect(r.couldNotRead).toBe(0);
      expect(r.checks).toHaveLength(expected[r.key]);
      for (const c of r.checks) {
        expect(c.ok).toBe(true);
      }
      if (r.key === "expiry") {
        expect(r.revealProvenance).toContain("no reveals");
      } else {
        expect(r.revealProvenance).toBe("indexer transaction bodies");
      }
    }
  });

  it("the override receipt's exception agrees with the record", () => {
    const r = MAINNET_TENDER_RECEIPTS.find(
      (x) => x.key === "override",
    )!;
    const parsed = JSON.parse(r.json);
    const rec = MAINNET_TENDER_RECORDS.find(
      (x) => x.key === "override",
    )!;
    expect(parsed.exception.proven_lowest_revealed.price_microtari)
      .toBe(rec.provenLowestMicro);
    expect(parsed.exception.price_paid.price_microtari)
      .toBe(rec.paidMicro);
    expect(parsed.exception.difference_microtari).toBe(2000000);
    expect(parsed.exception.rationale_hash).toBe(rec.rationaleHash);
    expect(parsed.override.rationale_text_check).toContain(
      "the supplied text hashes to the recorded rationale hash",
    );
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

describe("mainnet results screen", () => {
  it("renders the six mainnet records on the mainnet view, and not the esmeralda sections", async () => {
    const app = new App();
    expect(app.network).toBe("mainnet");
    const r = new FakeEl("div") as unknown as HTMLElement;
    await renderResults(app, r, () => {});
    const t = (r as unknown as FakeEl).textContent;
    expect(t).toContain("tari mainnet");
    expect(t).toContain("664,908 microtari");
    for (const rec of MAINNET_TENDER_RECORDS) {
      expect(t).toContain(rec.title);
      expect(t).toContain(
        `python3 scripts/verify.py ${rec.tender} --network mainnet`,
      );
    }
    expect(t).toContain(
      "15 of 15 checks passed in the standalone verifier, 15 of 15 in the app verifier",
    );
    expect(t).toContain("proven lowest revealed price");
    expect(t).toContain("14 tari, by seller2");
    expect(t).toContain("nothing paid, expired at epoch 39240");
    // The real receipts are presented: check rows from the
    // receipt files, their provenance and hashes, and the
    // download. The interim wording that said the records
    // carry no receipt is gone.
    expect(t).toContain(
      "settled 15000000 at epoch 39218, winner matches the award",
    );
    expect(t).toContain(
      "award 11000000 at counter 1, best valid reveal 11000000",
    );
    expect(t).toContain("receipt provenance: indexer transaction bodies");
    expect(t).toContain(
      "receipt sha256: 9e1da09ac76fc682a4ebe03bbe36acf9e682735e90328127cd0cfca1ad6acd51",
    );
    expect(t).toContain("download the receipt (json)");
    expect(t).not.toContain("they do not include a receipt download");
    // The esmeralda sections belong to the esmeralda view.
    expect(t).not.toContain("falsification cards");
    expect(t).not.toContain("zero-extraction ledger");
    expect(t).not.toContain("esmeralda testnet");
  });
});
