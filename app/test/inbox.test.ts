// The personal inbox aggregation: each
// row type against fixture records, including the rows that
// must NOT appear. Pure aggregation over decoded states and
// this browser's saved bids; the actions themselves live on
// the screens the rows link to.
import { describe, expect, it } from "vitest";
import { personalItems, type InboxItem } from "../src/inbox";
import type { TenderRules } from "../src/model";
import type {
  CircleComponentState,
  TenderComponentState,
} from "../src/state";
import type { SavedBid } from "../src/screens/seller";

const ME = "aa".repeat(32);
const OTHER = "bb".repeat(32);
const CIRCLE = "component_" + "cc".repeat(32);
const TENDER = "component_" + "dd".repeat(32);
const TENDER2 = "component_" + "ee".repeat(32);

const RULES: TenderRules = {
  specificationHash: "00".repeat(32),
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
};

function tender(over: Partial<TenderComponentState> = {}): TenderComponentState {
  return {
    template: "template_x",
    circle: CIRCLE,
    circleName: "uyo provisions circle",
    bound: true,
    approvers: [ME, OTHER],
    rules: RULES,
    rulesHash: "11".repeat(32),
    state: "Open",
    escrowVault: "vault_e",
    bondsVault: "vault_b",
    receiptResource: null,
    lockEpoch: 90,
    bidDeadline: 92,
    revealDeadline: 94,
    overrideDeadline: 95,
    deliveryStart: null,
    deliveryDeadline: 97,
    claimDeadline: 99,
    commitments: [],
    reveals: [],
    award: null,
    overrideProposals: [],
    overrideRecord: null,
    deliverySigners: [],
    dispute: null,
    disputeVotes: [],
    settlement: null,
    refundAmount: null,
    refundClaimed: false,
    payoutClaimed: false,
    forfeitForCircle: 0n,
    forfeitLocked: 0n,
    forfeitsClaimedByCircle: false,
    receiptIssued: false,
    approverChanges: [],
    nextProposalId: 1,
    ...over,
  };
}

function circle(over: Partial<CircleComponentState> = {}): CircleComponentState {
  return {
    template: "template_y",
    name: "uyo provisions circle",
    members: [ME],
    approvers: [ME, OTHER],
    threshold: 2,
    auditor: null,
    treasuryVault: "vault_t",
    tenders: [TENDER],
    withdrawals: [],
    approverChanges: [],
    nextProposalId: 1,
    ...over,
  };
}

function bid(over: Partial<SavedBid> = {}): SavedBid {
  return {
    tender: TENDER,
    price: "15000000",
    saltHex: "00".repeat(32),
    identity: ME,
    commitment: "ff".repeat(32),
    ...over,
  };
}

function run(args: {
  me?: string | null;
  bids?: SavedBid[];
  tenders?: [string, TenderComponentState][];
  circles?: [string, CircleComponentState][];
}): InboxItem[] {
  return personalItems({
    me: args.me === undefined ? ME : args.me,
    bids: args.bids ?? [],
    tenders: new Map(args.tenders ?? []),
    circles: new Map(args.circles ?? []),
    network: "esmeralda",
    epoch: 100,
  });
}

const kinds = (items: InboxItem[]) => items.map((i) => i.kind);

describe("personalItems: reveals due", () => {
  const sealed = tender({
    state: "Reveal",
    commitments: [
      { seller: ME, commitment: "ff".repeat(32), epoch: 91, revealed: false, bond: "Held" },
    ],
  });

  it("lists a saved bid whose reveal window is open", () => {
    const items = run({ bids: [bid()], tenders: [[TENDER, sealed]] });
    expect(kinds(items)).toEqual(["reveal"]);
    expect(items[0].dest).toBe("#/app/seller");
    expect(items[0].detail).toContain("epoch 94");
  });

  it("skips a bid already revealed, and one in another state", () => {
    const revealed = tender({
      state: "Reveal",
      commitments: [
        { seller: ME, commitment: "ff".repeat(32), epoch: 91, revealed: true, bond: "Held" },
      ],
    });
    expect(run({ bids: [bid()], tenders: [[TENDER, revealed]] })).toEqual([]);
    expect(run({ bids: [bid()], tenders: [[TENDER, tender({ state: "Open" })]] })).toEqual([]);
  });

  it("lists only the connected key's bids, and any bid when no key is saved", () => {
    expect(run({ bids: [bid({ identity: OTHER })], tenders: [[TENDER, sealed]] })).toEqual([]);
    const noKey = run({ me: null, bids: [bid({ identity: OTHER })], tenders: [[TENDER, sealed]] });
    expect(kinds(noKey)).toEqual(["reveal"]);
  });
});

describe("personalItems: winner claims", () => {
  const settled = (over: Partial<TenderComponentState> = {}) =>
    tender({
      state: "Settled",
      award: {
        winner: ME,
        winningCommitment: "ff".repeat(32),
        winningPrice: 15_000_000n,
        commitmentsCount: 1,
        revealsCount: 1,
      },
      settlement: { winner: ME, price: 15_000_000n, epoch: 98 },
      ...over,
    });

  it("lists payment and receipt while both are unclaimed", () => {
    const items = run({ tenders: [[TENDER, settled()]] });
    expect(kinds(items)).toEqual(["claim-payment", "claim-receipt"]);
    expect(items[0].dest).toBe(`#/app/tender/${TENDER}`);
  });

  it("drops each claim once it is made", () => {
    expect(kinds(run({ tenders: [[TENDER, settled({ payoutClaimed: true })]] }))).toEqual([
      "claim-receipt",
    ]);
    expect(
      run({ tenders: [[TENDER, settled({ payoutClaimed: true, receiptIssued: true })]] }),
    ).toEqual([]);
  });

  it("lists nothing for another key's win", () => {
    const others = settled({
      award: {
        winner: OTHER,
        winningCommitment: "ff".repeat(32),
        winningPrice: 15_000_000n,
        commitmentsCount: 1,
        revealsCount: 1,
      },
    });
    expect(run({ tenders: [[TENDER, others]] })).toEqual([]);
  });
});

describe("personalItems: bonds back", () => {
  const withBond = (bond: string, state: "Settled" | "Expired") =>
    tender({
      state,
      commitments: [
        { seller: ME, commitment: "ff".repeat(32), epoch: 91, revealed: true, bond },
      ],
    });

  it("lists a returnable bond on settled and expired tenders", () => {
    expect(kinds(run({ tenders: [[TENDER, withBond("Returnable", "Settled")]] }))).toEqual([
      "claim-bond",
    ]);
    expect(kinds(run({ tenders: [[TENDER, withBond("Returnable", "Expired")]] }))).toEqual([
      "claim-bond",
    ]);
  });

  it("skips held, returned, and forfeited bonds", () => {
    for (const bond of ["Held", "Returned", "Forfeited"]) {
      expect(run({ tenders: [[TENDER, withBond(bond, "Settled")]] })).toEqual([]);
    }
  });
});

describe("personalItems: circle collections", () => {
  const owing = tender({
    state: "Settled",
    refundAmount: 5_000_000n,
    refundClaimed: false,
    forfeitForCircle: 1_000_000n,
    forfeitsClaimedByCircle: false,
  });

  it("lists the refund and the forfeits for a circle approver", () => {
    const items = run({
      tenders: [[TENDER, owing]],
      circles: [[CIRCLE, circle()]],
    });
    expect(kinds(items)).toEqual(["collect-refund", "collect-forfeits"]);
    expect(items[0].dest).toBe(`#/app/circle/${CIRCLE}`);
  });

  it("drops each once collected, and lists nothing for a non-approver", () => {
    const done = tender({
      state: "Settled",
      refundAmount: 5_000_000n,
      refundClaimed: true,
      forfeitForCircle: 1_000_000n,
      forfeitsClaimedByCircle: true,
    });
    expect(run({ tenders: [[TENDER, done]], circles: [[CIRCLE, circle()]] })).toEqual([]);
    const notApprover = circle({ approvers: [OTHER] });
    expect(
      run({ tenders: [[TENDER, owing]], circles: [[CIRCLE, notApprover]] }),
    ).toEqual([]);
  });

  it("skips a zero refund and an unfinished tender", () => {
    const zero = tender({ state: "Expired", refundAmount: 0n });
    expect(run({ tenders: [[TENDER, zero]], circles: [[CIRCLE, circle()]] })).toEqual([]);
    const open = tender({ state: "Open", refundAmount: 5_000_000n });
    expect(
      run({
        tenders: [[TENDER2, open]],
        circles: [[CIRCLE, circle({ tenders: [TENDER2] })]],
      }),
    ).toEqual([]);
  });

  it("advertises forfeits only once the tender is finished", () => {
    const open = tender({
      state: "Open",
      forfeitForCircle: 1_000_000n,
      forfeitsClaimedByCircle: false,
    });
    expect(
      run({
        tenders: [[TENDER2, open]],
        circles: [[CIRCLE, circle({ tenders: [TENDER2] })]],
      }),
    ).toEqual([]);
  });
});

describe("personalItems: empty reach", () => {
  it("returns nothing when nothing is watched or owed", () => {
    expect(run({})).toEqual([]);
    expect(run({ me: null })).toEqual([]);
  });
});
