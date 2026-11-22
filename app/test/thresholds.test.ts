import { describe, it, expect } from "vitest";
import { thresholdError } from "../src/model";

// The chain refuses to lock a tender whose thresholds the circle
// cannot satisfy. The create screen checks the pair against the
// circle's approver count before any transaction is built, so a
// bad pair fails in the form instead of at the lock.
describe("thresholdError", () => {
  it("accepts pairs the circle can satisfy", () => {
    expect(thresholdError(1, 2, 2)).toBeNull();
    expect(thresholdError(2, 3, 3)).toBeNull();
    expect(thresholdError(1, 2, 5)).toBeNull();
    expect(thresholdError(2, 3, 5)).toBeNull();
  });

  it("rejects the solo circle: no dispute value exists", () => {
    const err = thresholdError(1, 2, 1);
    expect(err).toContain("no dispute threshold can work here");
    expect(err).toContain("add an approver to the circle first");
  });

  it("rejects a dispute threshold above the approver count when a valid one exists", () => {
    const err = thresholdError(1, 3, 2);
    expect(err).toContain("the dispute threshold is 3");
    expect(err).toContain("2 approvers");
  });

  it("rejects a dispute threshold not above the approval threshold", () => {
    expect(thresholdError(2, 2, 3)).toContain("must be higher than the approval threshold");
    expect(thresholdError(2, 1, 3)).toContain("must be higher than the approval threshold");
  });

  it("rejects an approval threshold above the approver count", () => {
    expect(thresholdError(3, 4, 2)).toContain("the approval threshold is 3");
  });

  it("rejects non-integer and below-one thresholds", () => {
    expect(thresholdError(0, 2, 2)).toContain("approval threshold");
    expect(thresholdError(1.5, 2, 3)).toContain("approval threshold");
    expect(thresholdError(1, 0, 2)).toContain("dispute threshold");
    expect(thresholdError(1, Number.NaN, 2)).toContain("dispute threshold");
  });
});
