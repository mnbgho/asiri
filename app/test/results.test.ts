import { describe, it, expect } from "vitest";
import { RESULTS_META, TENDER_RESULTS } from "../src/results-data";

// The results data is generated from real verifier runs. These
// tests guard the shape only: a malformed generation must fail
// here rather than render a broken or empty results screen.
describe("results data", () => {
  it("carries the run provenance", () => {
    expect(RESULTS_META.network).toBe("esmeralda");
    expect(RESULTS_META.tool).toContain("verify.py");
    expect(RESULTS_META.runDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("lists seven tenders with unique keys and full addresses", () => {
    expect(TENDER_RESULTS).toHaveLength(7);
    const keys = TENDER_RESULTS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of TENDER_RESULTS) {
      expect(t.tender).toMatch(/^component_[0-9a-f]{64}$/);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.state.length).toBeGreaterThan(0);
    }
  });

  it("every entry is a full run or an honest run error, never neither", () => {
    for (const t of TENDER_RESULTS) {
      if (t.runError !== null) {
        expect(t.runError.length).toBeGreaterThan(0);
        expect(t.checks).toHaveLength(0);
      } else {
        expect(t.checks.length).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("every check row carries the verifier's own words", () => {
    for (const t of TENDER_RESULTS) {
      for (const c of t.checks) {
        // ok is true, false, or null: null is the verifier's
        // could-not-be-read verdict, a real row state since the
        // indexers stopped serving the season's transactions.
        expect(c.ok === null || typeof c.ok === "boolean").toBe(true);
        expect(c.check.length).toBeGreaterThan(0);
        expect(c.detail.length).toBeGreaterThan(0);
      }
    }
  });
});
