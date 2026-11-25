import { describe, it, expect } from "vitest";
import { bytesToHex } from "../src/cbor";
import { sha256 } from "../src/hash";
import { EXCEPTION_INVOICE, LEDGER } from "../src/proof-data";
import { TENDER_RECEIPTS } from "../src/receipts-data";
import { TENDER_RESULTS } from "../src/results-data";

async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(await sha256(new TextEncoder().encode(text)));
}

// The proof data is generated from real artefacts: the seven
// receipt files, the published exception invoice, and the
// published zero-extraction ledger. These tests guard the
// joins and the figures: a generation that drops a receipt,
// mislabels its provenance, or drifts a number must fail here.

describe("tender receipts", () => {
  it("carries one receipt for every results tender", () => {
    expect(TENDER_RECEIPTS).toHaveLength(7);
    const byTender = new Map(TENDER_RECEIPTS.map((r) => [r.tender, r]));
    for (const t of TENDER_RESULTS) {
      expect(byTender.has(t.tender)).toBe(true);
    }
  });

  it("the json is the receipt file itself, hash and all", async () => {
    for (const r of TENDER_RECEIPTS) {
      expect(await sha256Hex(r.json)).toBe(r.sha256);
      const parsed = JSON.parse(r.json);
      expect(parsed.receipt_version).toBe("asiri-receipt-1");
      expect(parsed.tender).toBe(r.tender);
      expect(parsed.checks_summary).toEqual({
        pass: r.pass,
        fail: r.fail,
        could_not_read: r.couldNotRead,
      });
      expect(parsed.provenance.reveal_transactions).toBe(
        r.revealProvenance,
      );
    }
  });

  it("the season receipts pass in full from preserved history", () => {
    const expected: Record<string, number> = {
      gate: 13,
      tie: 13,
      override: 15,
      dispute: 13,
      expiry: 10,
      scale: 13,
    };
    for (const r of TENDER_RECEIPTS) {
      if (r.key === "coldrun") continue;
      expect(r.pass).toBe(expected[r.key]);
      expect(r.fail).toBe(0);
      expect(r.couldNotRead).toBe(0);
    }
    for (const key of ["gate", "tie", "override", "dispute", "scale"]) {
      const r = TENDER_RECEIPTS.find((x) => x.key === key)!;
      expect(r.revealProvenance).toContain("preserved history");
      expect(r.revealProvenance).toContain("2026-11-20");
    }
    const expiry = TENDER_RECEIPTS.find((x) => x.key === "expiry")!;
    expect(expiry.revealProvenance).toContain("no reveals");
  });

  it("the cold run receipt states could-not-read plainly", () => {
    const r = TENDER_RECEIPTS.find((x) => x.key === "coldrun")!;
    expect(r.pass).toBe(12);
    expect(r.fail).toBe(0);
    expect(r.couldNotRead).toBe(1);
    expect(r.revealProvenance).toContain("could not be read");
  });
});

describe("exception invoice", () => {
  it("the three facts, with the difference closing", () => {
    expect(EXCEPTION_INVOICE.tender).toBe(
      "component_49377a6f26dfb108ca406bbe445551832512aef96c017499c6f2fda5f4970aab",
    );
    expect(EXCEPTION_INVOICE.provenLowest.priceMicro).toBe(14000000);
    expect(EXCEPTION_INVOICE.pricePaid.priceMicro).toBe(16000000);
    expect(EXCEPTION_INVOICE.differenceMicro).toBe(2000000);
    expect(
      EXCEPTION_INVOICE.pricePaid.priceMicro -
        EXCEPTION_INVOICE.provenLowest.priceMicro,
    ).toBe(EXCEPTION_INVOICE.differenceMicro);
  });

  it("agrees with the override receipt's own exception section", () => {
    const r = TENDER_RECEIPTS.find((x) => x.key === "override")!;
    const parsed = JSON.parse(r.json);
    expect(parsed.exception.proven_lowest_revealed.price_microtari).toBe(
      EXCEPTION_INVOICE.provenLowest.priceMicro,
    );
    expect(parsed.exception.proven_lowest_revealed.seller).toBe(
      EXCEPTION_INVOICE.provenLowest.seller,
    );
    expect(parsed.exception.price_paid.price_microtari).toBe(
      EXCEPTION_INVOICE.pricePaid.priceMicro,
    );
    expect(parsed.exception.price_paid.seller).toBe(
      EXCEPTION_INVOICE.pricePaid.seller,
    );
    expect(parsed.exception.difference_microtari).toBe(
      EXCEPTION_INVOICE.differenceMicro,
    );
    expect(parsed.exception.rationale_hash).toBe(
      EXCEPTION_INVOICE.rationaleHash,
    );
  });

  it("the rationale text hashes to the on-chain rationale hash", async () => {
    expect(await sha256Hex(EXCEPTION_INVOICE.rationaleText)).toBe(
      EXCEPTION_INVOICE.rationaleHash,
    );
  });
});

describe("zero-extraction ledger", () => {
  it("every row's escrow identity closes and pays the operator zero", () => {
    expect(LEDGER.rows).toHaveLength(7);
    for (const row of LEDGER.rows) {
      expect(row.escrowIn).toBe(
        (row.paid ?? 0) + row.refunded + row.inVault,
      );
      expect(row.operatorPaid).toBe(0);
    }
  });

  it("the totals sum the rows and the operator total is zero", () => {
    const sum = (f: (r: (typeof LEDGER.rows)[number]) => number) =>
      LEDGER.rows.reduce((a, r) => a + f(r), 0);
    expect(sum((r) => r.escrowIn)).toBe(LEDGER.totals.escrowIn);
    expect(sum((r) => r.paid ?? 0)).toBe(LEDGER.totals.paid);
    expect(sum((r) => r.refunded)).toBe(LEDGER.totals.refunded);
    expect(sum((r) => r.inVault)).toBe(LEDGER.totals.inVault);
    expect(sum((r) => r.bondsIn)).toBe(LEDGER.totals.bondsIn);
    expect(sum((r) => r.lockedForever)).toBe(
      LEDGER.totals.lockedForever,
    );
    expect(LEDGER.totals.escrowIn).toBe(122000000);
    expect(LEDGER.totals.paid).toBe(72500000);
    expect(LEDGER.totals.lockedForever).toBe(1000000);
    expect(LEDGER.totals.operatorPaid).toBe(0);
  });

  it("the scale row carries the recomputed lifecycle fee", () => {
    const row = LEDGER.rows.find((r) => r.title === "The scale tender")!;
    expect(row.paid).toBe(11000000);
    expect(row.refunded).toBe(9000000);
    expect(row.inVault).toBe(0);
    expect(row.feesMicro).toBe(253990);
    expect(LEDGER.totals.feesMicro).toBe(676519);
  });

  it("carries the one fee discrepancy as corrected", () => {
    expect(LEDGER.discrepancy.tx).toBe("83f4137fe19c");
    expect(LEDGER.discrepancy.feeMicro).toBe(3850);
    expect(LEDGER.discrepancy.originallyWrittenMicro).toBe(3806);
    expect(LEDGER.discrepancy.resolved).toBe(true);
  });

  it("the ledger rows cover the same tenders as the results", () => {
    const byTender = new Set<string>(LEDGER.rows.map((r) => r.tender));
    for (const t of TENDER_RESULTS) {
      expect(byTender.has(t.tender)).toBe(true);
    }
  });
});
