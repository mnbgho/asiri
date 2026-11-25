// The circle record export's shape, pinned against fixtures:
// the decoded circle state, its tenders with decoded states,
// the proposals, and a verification summary per tender. A
// tender whose read fails is carried as an unreadable entry
// with the reason, never dropped, and a tender whose checks
// could not be computed says so in its summary.
import { describe, expect, it } from "vitest";
import {
  buildCircleRecord,
  summarizeReport,
  tenderStateRecord,
  uncheckedVerification,
  type CircleRecordTender,
} from "../src/circle-record";
import type { CircleComponentState, TenderComponentState } from "../src/state";
import { Report } from "../src/verify";

const K1 = "01".repeat(32);
const K2 = "02".repeat(32);
const CIRCLE = `component_${"aa".repeat(32)}`;
const TENDER_OK = `component_${"bb".repeat(32)}`;
const TENDER_DOWN = `component_${"cc".repeat(32)}`;

const circle: CircleComponentState = {
  template: "template_circle",
  name: "fixture circle",
  members: [K1, K2],
  approvers: [K1, K2],
  threshold: 2,
  auditor: null,
  treasuryVault: `vault_${"dd".repeat(32)}`,
  tenders: [TENDER_OK, TENDER_DOWN],
  withdrawals: [
    { id: 1, amount: 100_000n, to: `component_${"ee".repeat(32)}`, signers: [K1], executed: false, isVoid: false },
  ],
  approverChanges: [
    { id: 2, newApprovers: [K1], newThreshold: 1, signers: [], executed: false, isVoid: true },
  ],
  nextProposalId: 3,
};

const tender: TenderComponentState = {
  template: "template_tender",
  circle: CIRCLE,
  circleName: "fixture circle",
  bound: true,
  approvers: [K1, K2],
  rules: {
    specificationHash: "ab".repeat(32),
    budgetCap: 20_000_000n,
    bondAmount: 2_000_000n,
    bidWindowEpochs: 2,
    revealWindowEpochs: 2,
    overrideWindowEpochs: 1,
    deliveryWindowEpochs: 2,
    claimGraceEpochs: 2,
    disputeWindowEpochs: 2,
    approvalThreshold: 2,
    disputeThreshold: 3,
  },
  rulesHash: "cd".repeat(32),
  state: "Settled",
  escrowVault: `vault_${"ff".repeat(32)}`,
  bondsVault: `vault_${"99".repeat(32)}`,
  receiptResource: null,
  lockEpoch: 100,
  bidDeadline: 102,
  revealDeadline: 104,
  overrideDeadline: 105,
  deliveryStart: 105,
  deliveryDeadline: 107,
  claimDeadline: 109,
  commitments: [
    { seller: K1, commitment: "ef".repeat(32), epoch: 100, revealed: true, bond: "Returned" },
  ],
  reveals: [
    { seller: K1, price: 15_000_000n, epoch: 103, counter: 1, valid: true, commitment: "ef".repeat(32) },
  ],
  award: { winner: K1, winningCommitment: "ef".repeat(32), winningPrice: 15_000_000n, commitmentsCount: 1, revealsCount: 1, epoch: 106, byOverride: false },
  overrideProposals: [],
  overrideRecord: null,
  deliverySigners: [K1, K2],
  dispute: null,
  disputeVotes: [],
  settlement: { winner: K1, price: 15_000_000n, epoch: 106 },
  refundAmount: 5_000_000n,
  refundClaimed: true,
  payoutClaimed: true,
  forfeitForCircle: 0n,
  forfeitLocked: 0n,
  forfeitsClaimedByCircle: false,
  receiptIssued: true,
  approverChanges: [],
  nextProposalId: 1,
};

function checkedReport(): Report {
  const r = new Report();
  r.add("tender exists", true, "state Settled");
  r.add("award is the lowest valid revealed price", false, "award 9, best valid reveal 7");
  r.add("reveals verify against commitments", null, "the transaction bodies could not be read");
  return r;
}

const tenders: CircleRecordTender[] = [
  {
    address: TENDER_OK,
    read: "ok",
    state: tenderStateRecord(tender),
    verification: summarizeReport(checkedReport()),
  },
  {
    address: TENDER_DOWN,
    read: "unreadable",
    note: "nothing was found at that address on this network",
    verification: uncheckedVerification("the tender's state could not be read, so the checks were not run"),
  },
];

describe("circle record export", () => {
  it("carries the circle, its proposals, and every tender", () => {
    const rec = buildCircleRecord({
      networkLabel: "esmeralda testnet",
      circleAddress: CIRCLE,
      circle,
      treasuryBalance: 50_000_000n,
      tenders,
    });
    expect(rec.record_version).toBe("asiri-circle-record-1");
    const c = rec.circle as Record<string, unknown>;
    expect(c.name).toBe("fixture circle");
    expect(c.treasury_balance_microtari).toBe(50_000_000);
    expect(c.treasury_balance_read).toBe("read at export time");
    const w = (c.withdrawals as Record<string, unknown>[])[0];
    expect(w.amount_microtari).toBe(100_000);
    const list = rec.tenders as CircleRecordTender[];
    expect(list.map((t) => t.address)).toEqual([TENDER_OK, TENDER_DOWN]);
  });

  it("marks the unreadable tender instead of dropping it", () => {
    const rec = buildCircleRecord({
      networkLabel: "esmeralda testnet",
      circleAddress: CIRCLE,
      circle,
      treasuryBalance: 50_000_000n,
      tenders,
    });
    const down = (rec.tenders as CircleRecordTender[])[1];
    expect(down.read).toBe("unreadable");
    if (down.read === "unreadable") expect(down.note).toContain("nothing was found");
    expect(down.verification.status).toBe("could not be checked");
    const notes = (rec.notes as string[]).join(" ");
    expect(notes).toContain("1 of this circle's tenders could not be read");
    expect(notes).toContain("carry no verification summary");
  });

  it("records an unreadable treasury balance as unreadable, not a figure", () => {
    const rec = buildCircleRecord({
      networkLabel: "esmeralda testnet",
      circleAddress: CIRCLE,
      circle,
      treasuryBalance: null,
      tenders,
    });
    const c = rec.circle as Record<string, unknown>;
    expect(c.treasury_balance_microtari).toBeNull();
    expect(c.treasury_balance_read).toBe("unreadable");
    expect((rec.notes as string[]).join(" ")).toContain("treasury balance could not be read");
  });

  it("summarizes a report as counts plus the named checks", () => {
    const s = summarizeReport(checkedReport());
    expect(s).toEqual({
      status: "checked",
      pass: 1,
      fail: 1,
      couldNotRead: 1,
      failedChecks: ["award is the lowest valid revealed price"],
      unreadableChecks: ["reveals verify against commitments"],
      note: null,
    });
  });

  it("serializes tender amounts as microtari numbers and keeps the record JSON-safe", () => {
    const rec = buildCircleRecord({
      networkLabel: "esmeralda testnet",
      circleAddress: CIRCLE,
      circle,
      treasuryBalance: 50_000_000n,
      tenders,
    });
    const ok = (rec.tenders as CircleRecordTender[])[0];
    if (ok.read !== "ok") throw new Error("fixture tender should read ok");
    const st = ok.state as Record<string, unknown>;
    expect((st.rules as Record<string, unknown>).budget_cap_microtari).toBe(20_000_000);
    expect((st.settlement as Record<string, unknown>).price_microtari).toBe(15_000_000);
    // No raw bigint may leak into the record: stringify throws on one.
    expect(() => JSON.stringify(rec)).not.toThrow();
  });
});
