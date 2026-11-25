import { beforeEach, describe, it, expect } from "vitest";
import { App, cap } from "../src/app";
import { bytesToHex } from "../src/cbor";
import { sha256 } from "../src/hash";
import {
  MAINNET_ATTACK_DUPLICATES,
  MAINNET_ATTACK_OVERRIDE,
  MAINNET_ATTACK_RECORD,
  MAINNET_ATTACK_SEALED_BID,
  MAINNET_ATTACKS,
} from "../src/mainnet-attack-data";
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
  it("carries one receipt for every mainnet record, in order, plus the attack tender's", () => {
    expect(MAINNET_TENDER_RECEIPTS).toHaveLength(7);
    expect(MAINNET_TENDER_RECEIPTS.map((r) => r.key)).toEqual([
      "gate",
      "tie",
      "override",
      "dispute",
      "expiry",
      "scale",
      "attack",
    ]);
    const byTender = new Map(
      MAINNET_TENDER_RECEIPTS.map((r) => [r.tender, r]),
    );
    for (const t of MAINNET_TENDER_RECORDS) {
      expect(byTender.has(t.tender)).toBe(true);
    }
    expect(byTender.has(MAINNET_ATTACK_RECORD.tender)).toBe(true);
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
      attack: 13,
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

// The attack tender's data is generated from the evidence
// record's attack section, cross-checked against the
// tender's receipt. These tests guard the record's shape:
// eighteen attacks, the fees the record's own sums demand,
// and no invented actors where the record names none.
describe("mainnet attack data", () => {
  it("the attack record closes its escrow identity and matches its receipt", () => {
    const t = MAINNET_ATTACK_RECORD;
    expect(t.key).toBe("attack");
    expect(t.state).toBe("settled");
    expect((t.paidMicro ?? 0) + t.refundMicro).toBe(t.capMicro);
    expect(t.paidMicro).toBe(15_000_000);
    expect(t.paidTo).toBe("seller1");
    expect(t.closedEpoch).toBe(39256);
    expect(t.commitments).toBe(3);
    expect(t.reveals).toBe(2);
    expect(t.standalonePass).toBe(13);
    expect(t.appPass).toBe(13);
    const receipt = MAINNET_TENDER_RECEIPTS.find(
      (r) => r.key === "attack",
    )!;
    expect(receipt.tender).toBe(t.tender);
    expect(receipt.sha256).toBe(
      "128a855fa956b4c30f90a09a44ea3c6b5ad8fb5841cecc6bb429098757c00526",
    );
  });

  it("carries eighteen attacks with unique transactions and verbatim rejections", () => {
    expect(MAINNET_ATTACKS).toHaveLength(18);
    expect(new Set(MAINNET_ATTACKS.map((a) => a.key)).size).toBe(18);
    expect(new Set(MAINNET_ATTACKS.map((a) => a.tx)).size).toBe(18);
    for (const a of MAINNET_ATTACKS) {
      expect(a.tx).toMatch(/^[0-9a-f]{64}$/);
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.rejection.length).toBeGreaterThan(0);
      expect(a.feeMicro).toBeGreaterThan(0);
    }
    const byKey = new Map(MAINNET_ATTACKS.map((a) => [a.key, a]));
    expect(byKey.get("duplicate-commit")!.rejection).toBe(
      "seller has already committed in this tender",
    );
    expect(byKey.get("update-rules")!.rejection).toBe(
      "tender is not a draft",
    );
    expect(byKey.get("override-unrevealed")!.rejection).toBe(
      "an override can only choose a valid revealed bid",
    );
    expect(byKey.get("claim-payment-twice")!.rejection).toBe(
      "payment already claimed",
    );
    // The four commitment-mismatch reveals carry the one
    // quoted reason the record gives for all of them.
    for (const k of [
      "wrong-salt",
      "wrong-price",
      "wrong-identity",
      "uncommitted-reveal",
      "double-reveal",
    ]) {
      expect(byKey.get(k)!.rejection).toBe(
        "no matching commitment for this reveal",
      );
    }
  });

  it("names an actor only where the record names one", () => {
    const nullActors = MAINNET_ATTACKS.filter(
      (a) => a.actor === null,
    ).map((a) => a.key);
    expect(nullActors).toEqual([
      "double-reveal",
      "early-close-reveal",
      "early-advance-delivery",
      "override-zero-rationale",
      "override-unrevealed",
    ]);
    const byKey = new Map(MAINNET_ATTACKS.map((a) => [a.key, a]));
    expect(byKey.get("update-rules")!.actor).toBe("operator");
    expect(byKey.get("uncommitted-reveal")!.actor).toBe("second");
    expect(byKey.get("collect-forfeits-twice")!.actor).toBe(
      "the circle",
    );
  });

  it("the attack fees are the record's own sums", () => {
    const attacks = MAINNET_ATTACKS.reduce(
      (a, x) => a + x.feeMicro,
      0,
    );
    expect(attacks).toBe(55_811);
    const dups = MAINNET_ATTACK_DUPLICATES.reduce(
      (a, x) => a + x.feeMicro,
      0,
    );
    expect(dups).toBe(6_257);
    expect(MAINNET_ATTACK_DUPLICATES.map((d) => d.key)).toEqual([
      "small-bond",
      "update-rules",
    ]);
    expect(MAINNET_ATTACK_RECORD.feesMicro).toBe(168_965);
  });

  it("the below-threshold override is carried as an observation, not an attack", () => {
    const o = MAINNET_ATTACK_OVERRIDE;
    expect(o.chosenAccount).toBe("seller2");
    expect(o.signer).toBe("operator");
    expect(o.signatures).toBe(1);
    expect(o.threshold).toBe(2);
    expect(o.awardWinner).toBe("seller1");
    expect(o.proposeTx).toMatch(/^[0-9a-f]{64}$/);
    expect(o.signTx).toMatch(/^[0-9a-f]{64}$/);
    expect(MAINNET_ATTACK_SEALED_BID).toEqual({
      by: "third",
      priceMicro: 12_000_000,
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

describe("mainnet results screen", () => {
  it("renders the mainnet records on the mainnet view, and not the esmeralda sections", async () => {
    const app = new App();
    expect(app.network).toBe("mainnet");
    const r = new FakeEl("div") as unknown as HTMLElement;
    await renderResults(app, r, () => {});
    const t = (r as unknown as FakeEl).textContent;
    expect(t).toContain("Tari Mainnet");
    expect(t).toContain("664,908 microtari");
    for (const rec of MAINNET_TENDER_RECORDS) {
      expect(t).toContain(cap(rec.title));
      expect(t).toContain(
        `python3 scripts/verify.py ${rec.tender} --network mainnet`,
      );
    }
    expect(t).toContain(
      "15 of 15 checks passed in the standalone verifier, 15 of 15 in the app verifier",
    );
    expect(t).toContain("Proven lowest revealed price");
    expect(t).toContain("14 tari, by seller2");
    expect(t).toContain("Nothing paid, expired at epoch 39240");
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
    expect(t).toContain("Receipt provenance: indexer transaction bodies");
    expect(t).toContain(
      "Receipt sha256: 9e1da09ac76fc682a4ebe03bbe36acf9e682735e90328127cd0cfca1ad6acd51",
    );
    expect(t).toContain("Download the receipt (json)");
    expect(t).not.toContain("they do not include a receipt download");
    // The seventh tender: the attack test, its receipt, and
    // the attack record with the chain's own rejections.
    expect(t).toContain("Seven tenders ran on Mainnet");
    expect(t).toContain("The attack tender");
    expect(t).toContain(
      `python3 scripts/verify.py ${MAINNET_ATTACK_RECORD.tender} --network mainnet`,
    );
    expect(t).toContain(
      "Receipt sha256: 128a855fa956b4c30f90a09a44ea3c6b5ad8fb5841cecc6bb429098757c00526",
    );
    expect(t).toContain("The attacks: eighteen, all rejected");
    expect(t).toContain(
      "Rejected · seller has already committed in this tender",
    );
    expect(t).toContain(
      "Rejected · an override can only choose a valid revealed bid",
    );
    expect(t).toContain("Rejected · payment already claimed");
    expect(t).toContain(
      "One signature is below the circle's threshold of 2",
    );
    expect(t).toContain("still seller1, with no override recorded");
    expect(t).toContain(
      "third's 12 tari bid was committed and never revealed",
    );
    // The esmeralda sections belong to the esmeralda view.
    expect(t).not.toContain("Falsification cards");
    expect(t).not.toContain("Zero-extraction ledger");
    expect(t).not.toContain("esmeralda testnet");
  });
});
