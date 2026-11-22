// The window and form checks behind the dispute claim and the
// withdrawal proposal. The dispute window mirrors claim_dispute
// in the tender template exactly: state AwaitingDelivery, at or
// after the delivery deadline, before the claim deadline, and
// nothing opens on an unknown epoch. The withdrawal check
// mirrors propose_withdrawal in the circle template: a component
// destination, a positive amount, and no more than the treasury
// holds.
import { describe, expect, it } from "vitest";
import { disputeWindowOpen, withdrawalError } from "../src/model";

describe("disputeWindowOpen", () => {
  it("opens at the delivery deadline and stays open through the grace", () => {
    expect(disputeWindowOpen("AwaitingDelivery", 100, 103, 100)).toBe(true);
    expect(disputeWindowOpen("AwaitingDelivery", 100, 103, 102)).toBe(true);
  });

  it("is closed before the delivery deadline", () => {
    expect(disputeWindowOpen("AwaitingDelivery", 100, 103, 99)).toBe(false);
  });

  it("closes when the claim grace closes", () => {
    expect(disputeWindowOpen("AwaitingDelivery", 100, 103, 103)).toBe(false);
    expect(disputeWindowOpen("AwaitingDelivery", 100, 103, 120)).toBe(false);
  });

  it("never opens in another state", () => {
    for (const s of ["Draft", "Open", "Reveal", "Awarded", "Settled", "Expired", "Disputed"] as const)
      expect(disputeWindowOpen(s, 100, 103, 101)).toBe(false);
  });

  it("never opens on missing deadlines or an unknown epoch", () => {
    expect(disputeWindowOpen("AwaitingDelivery", null, 103, 101)).toBe(false);
    expect(disputeWindowOpen("AwaitingDelivery", 100, null, 101)).toBe(false);
    expect(disputeWindowOpen("AwaitingDelivery", 100, 103, 0)).toBe(false);
    expect(disputeWindowOpen("AwaitingDelivery", 0, 103, 0)).toBe(false);
  });
});

describe("withdrawalError", () => {
  const ACCOUNT = "component_" + "aa".repeat(32);

  it("accepts a proposal the template would accept", () => {
    expect(withdrawalError(2_000_000n, ACCOUNT, 9_000_000n)).toBeNull();
    expect(withdrawalError(9_000_000n, ACCOUNT, 9_000_000n)).toBeNull();
  });

  it("blocks on an unread treasury balance rather than proposing blind", () => {
    expect(withdrawalError(2_000_000n, ACCOUNT, null)).toContain(
      "the treasury balance could not be read",
    );
  });

  it("rejects a destination that is not a component address", () => {
    expect(withdrawalError(1n, "not an address", null)).toContain("component address");
    expect(withdrawalError(1n, "component_" + "aa".repeat(31), null)).toContain("component address");
    expect(withdrawalError(1n, "aa".repeat(32), null)).toContain("component address");
  });

  it("rejects a zero amount", () => {
    expect(withdrawalError(0n, ACCOUNT, 9_000_000n)).toContain("more than zero");
  });

  it("rejects more than the treasury holds", () => {
    expect(withdrawalError(9_000_001n, ACCOUNT, 9_000_000n)).toContain("more than the treasury holds");
  });
});
