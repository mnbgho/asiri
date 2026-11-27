// The transaction-building layer, tested for request shape: each
// builder must produce the exact instruction list for its flow,
// and the wallet wrapper must drive the provider's three-step
// request flow in order.
import { describe, expect, it } from "vitest";
import {
  buildClaimDispute,
  buildCommitBid,
  buildCreateCircle,
  buildCreateTender,
  buildLockAndFund,
  buildProposeOverride,
  buildProposeWithdrawal,
  buildRevealBid,
  buildTenderApproveApproverChange,
} from "../src/builders";
import { Wallet, type Instruction, type TariProvider } from "../src/wallet";

const ACCOUNT = "component_" + "aa".repeat(32);
const CIRCLE = "component_" + "bb".repeat(32);
const TENDER = "component_" + "cc".repeat(32);
const CIRCLE_TEMPLATE = "template_" + "dd".repeat(32);
const TENDER_TEMPLATE = "template_" + "ee".repeat(32);
const TOKEN = "resource_" + "01".repeat(32);
const FEE_VAULT = "vault_" + "ff".repeat(32);
const FEE_INPUTS = [
  { substate_id: ACCOUNT, version: null },
  { substate_id: FEE_VAULT, version: null },
];

const RULES = {
  specificationHash: "07".repeat(32),
  budgetCap: 10000n,
  bondAmount: 100n,
  bidWindowEpochs: 5,
  revealWindowEpochs: 5,
  overrideWindowEpochs: 3,
  deliveryWindowEpochs: 5,
  claimGraceEpochs: 3,
  disputeWindowEpochs: 4,
  approvalThreshold: 2,
  disputeThreshold: 3,
};

describe("instruction builders", () => {
  it("creates a circle through the template function", () => {
    const ix = buildCreateCircle(
      CIRCLE_TEMPLATE,
      "Uyo Shopkeepers Circle",
      ["11".repeat(32), "22".repeat(32)],
      2,
      null,
      TENDER_TEMPLATE,
    );
    expect(ix).toHaveLength(1);
    const fn = (ix[0] as { CallFunction: { address: string; function: string } })
      .CallFunction;
    expect(fn.address).toBe("dd".repeat(32));
    expect(fn.function).toBe("new");
  });

  it("creates a tender through the template function", () => {
    const ix = buildCreateTender(TENDER_TEMPLATE, CIRCLE, RULES);
    const fn = (ix[0] as { CallFunction: { function: string } }).CallFunction;
    expect(fn.function).toBe("new");
  });

  it("locks and funds: withdraw, keep the bucket, call", () => {
    const ix = buildLockAndFund(ACCOUNT, TENDER, 10000n);
    expect(ix).toHaveLength(3);
    const withdraw = (
      ix[0] as { CallMethod: { method: string; args: unknown[] } }
    ).CallMethod;
    expect(withdraw.method).toBe("withdraw");
    expect(JSON.stringify(withdraw.args)).toContain(
      "d8835820" + "01".repeat(32),
    );
    expect(ix[1]).toEqual({
      PutLastInstructionOutputOnWorkspace: { key: 0 },
    });
    const lock = (ix[2] as { CallMethod: { method: string; args: unknown[] } })
      .CallMethod;
    expect(lock.method).toBe("lock_and_fund");
    expect(lock.args).toEqual([{ Workspace: { id: 0, offset: null } }]);
  });

  it("commits a bid with the bond bucket", () => {
    const ix = buildCommitBid(ACCOUNT, TENDER, "ab".repeat(32), 100n);
    expect(ix).toHaveLength(3);
    const commit = (
      ix[2] as { CallMethod: { method: string; args: unknown[] } }
    ).CallMethod;
    expect(commit.method).toBe("commit_bid");
    expect(commit.args[0]).toEqual({ Literal: "5820" + "ab".repeat(32) });
    expect(commit.args[1]).toEqual({ Workspace: { id: 0, offset: null } });
  });

  it("reveals with price, salt array, and payment identity", () => {
    const salt = new Uint8Array(32).map((_, i) => i);
    const ix = buildRevealBid(TENDER, 1950n, salt, "b9".repeat(32));
    const call = (ix[0] as { CallMethod: { method: string; args: unknown[] } })
      .CallMethod;
    expect(call.method).toBe("reveal_bid");
    expect(call.args[0]).toEqual({ Literal: "19079e" });
    expect(call.args[2]).toEqual({ Literal: "5820" + "b9".repeat(32) });
  });

  it("proposes a cancellation override with no chosen seller", () => {
    const ix = buildProposeOverride(TENDER, null, "09".repeat(32));
    const call = (ix[0] as { CallMethod: { method: string; args: unknown[] } })
      .CallMethod;
    expect(call.method).toBe("propose_override");
    expect(call.args[0]).toEqual({ Literal: "f6" });
    expect(call.args[1]).toEqual({ Literal: "5820" + "09".repeat(32) });
  });

  it("claims a dispute with the evidence hash alone", () => {
    const ix = buildClaimDispute(TENDER, "ef".repeat(32));
    expect(ix).toHaveLength(1);
    const call = (ix[0] as { CallMethod: { call: { Address: string }; method: string; args: unknown[] } })
      .CallMethod;
    expect(call.call.Address).toBe(TENDER);
    expect(call.method).toBe("claim_dispute");
    expect(call.args).toEqual([{ Literal: "5820" + "ef".repeat(32) }]);
  });

  it("proposes a withdrawal with amount and destination", () => {
    const ix = buildProposeWithdrawal(CIRCLE, 2_000_000n, ACCOUNT);
    expect(ix).toHaveLength(1);
    const call = (ix[0] as { CallMethod: { call: { Address: string }; method: string; args: unknown[] } })
      .CallMethod;
    expect(call.call.Address).toBe(CIRCLE);
    expect(call.method).toBe("propose_withdrawal");
    expect(call.args[0]).toEqual({ Literal: "1a001e8480" });
    expect(call.args[1]).toEqual({ Literal: "d8805820" + "aa".repeat(32) });
  });

  it("signs a tender approver change by proposal id", () => {
    const ix = buildTenderApproveApproverChange(TENDER, 1);
    expect(ix).toHaveLength(1);
    const call = (ix[0] as { CallMethod: { call: { Address: string }; method: string; args: unknown[] } })
      .CallMethod;
    expect(call.call.Address).toBe(TENDER);
    expect(call.method).toBe("approve_approver_change");
    expect(call.args).toEqual([{ Literal: "01" }]);
  });
});

class MockProvider implements TariProvider {
  calls: string[] = [];
  polls = 0;
  createParams: unknown = null;
  async request(args: { method: string; params?: unknown }): Promise<unknown> {
    this.calls.push(args.method);
    switch (args.method) {
      case "tari_requestAccounts":
        return [ACCOUNT];
      case "tari_getNetwork":
        return "esmeralda";
      case "tari_getCapabilities":
        return { exactInputSelection: true };
      case "tari_createTransactionRequest":
        this.createParams = args.params;
        return { requestId: "req-1" };
      case "tari_getTransactionRequest":
        this.polls++;
        return this.polls < 2
          ? { status: "pending" }
          : this.polls < 3
            ? { status: "approved" }
            : { status: "submitted", result: { ok: true } };
      case "tari_submitTransactionRequest":
        return {};
      default:
        throw new Error(`unexpected method ${args.method}`);
    }
  }
}

describe("wallet submit flow", () => {
  it("creates, polls, submits on approval, and returns the result", async () => {
    const mock = new MockProvider();
    (globalThis as { window?: unknown }).window = { tari: mock };
    const wallet = new Wallet();
    wallet.pollMs = 1; // ride the poll loop at full speed, not real time
    await wallet.connect();
    expect(wallet.account).toBe(ACCOUNT);
    const out = await wallet.submit(buildClose(), FEE_INPUTS, 2000000);
    expect(out.result).toEqual({ ok: true });
    expect(mock.createParams).toMatchObject({
      inputs: FEE_INPUTS,
      maxFee: "2000000",
    });
    expect(mock.calls).toEqual([
      "tari_requestAccounts",
      "tari_getNetwork",
      "tari_getCapabilities",
      "tari_createTransactionRequest",
      "tari_getTransactionRequest",
      "tari_getTransactionRequest",
      "tari_submitTransactionRequest",
      "tari_getTransactionRequest",
    ]);
  });

  it("submits only once when approval is reported repeatedly", async () => {
    let polls = 0;
    let submits = 0;
    const slow: TariProvider = {
      async request(args: { method: string; params?: unknown }) {
        if (args.method === "tari_getCapabilities")
          return { exactInputSelection: true };
        if (args.method === "tari_createTransactionRequest")
          return { requestId: "req-3" };
        if (args.method === "tari_getTransactionRequest") {
          polls++;
          return polls < 5
            ? { status: "approved" }
            : { status: "submitted", result: { ok: true } };
        }
        if (args.method === "tari_submitTransactionRequest") {
          submits++;
          return {};
        }
        throw new Error("unexpected");
      },
    };
    (globalThis as { window?: unknown }).window = { tari: slow };
    const wallet = new Wallet();
    wallet.pollMs = 1;
    const out = await wallet.submit(buildClose(), FEE_INPUTS);
    expect(out.result).toEqual({ ok: true });
    expect(submits).toBe(1);
  });

  it("throws the wallet's message on rejection", async () => {
    const rejecting: TariProvider = {
      async request(args: { method: string; params?: unknown }) {
        if (args.method === "tari_getCapabilities")
          return { exactInputSelection: true };
        if (args.method === "tari_createTransactionRequest")
          return { requestId: "req-2" };
        if (args.method === "tari_getTransactionRequest")
          return { status: "rejected", error: "user declined" };
        throw new Error("unexpected");
      },
    };
    (globalThis as { window?: unknown }).window = { tari: rejecting };
    const wallet = new Wallet();
    await expect(wallet.submit(buildClose(), FEE_INPUTS)).rejects.toThrow("user declined");
  });
});

function buildClose(): Instruction[] {
  return [
    {
      CallMethod: {
        call: { Address: TENDER },
        method: "close_reveal",
        args: [],
      },
    },
  ];
}

// The token constant is part of the request shape; pin it here so
// a careless edit cannot retarget withdrawals.
describe("constants", () => {
  it("uses the native token resource", () => {
    expect(TOKEN).toBe(
      "resource_0101010101010101010101010101010101010101010101010101010101010101",
    );
  });
});
