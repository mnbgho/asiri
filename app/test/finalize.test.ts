// Post-submission truth: the wallet's "submitted" is not an
// ending, so the app confirms the outcome from the indexer's
// finalize record. The payload shapes below are the ones the
// Esmeralda indexer actually serves: the Commit record of the
// scale tender's advance-delivery transaction, and the
// fee-only Commit (execution failed, abort details carrying
// the template's reason) of its collect-forfeits transaction
// e929f1fce8139c1d488566426fc76f9ea973977dcea8529b1481887444fbc268,
// both read live on 2026-11-20.
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app";
import { buildCloseReveal, buildCommitBid, buildCreateCircle } from "../src/builders";
import {
  calledMethods,
  confirmAction,
  parseFinalizeResult,
  plainReason,
  sealSigner,
  txCalls,
} from "../src/finalize";
import type { Indexer } from "../src/indexer";
import type { TariProvider } from "../src/wallet";

const ACCOUNT = "component_" + "aa".repeat(32);
const CIRCLE = "component_" + "bb".repeat(32);
const TENDER = "component_" + "cc".repeat(32);
const CIRCLE_TEMPLATE = "template_" + "dd".repeat(32);
const TENDER_TEMPLATE = "template_" + "ee".repeat(32);
const OLD_TX = "11".repeat(32);
const NEW_TX = "22".repeat(32);
const FOREIGN_TX = "33".repeat(32);

const COMMIT_RESULT = {
  result: {
    Finalized: {
      final_decision: "Commit",
      abort_details: null,
      execution_result: "gA==",
      execution_time: { secs: 0, nanos: 5497000 },
      finalized_time: "2026-11-20 10:47:37.0",
    },
  },
};

const FEE_ONLY_RESULT = {
  result: {
    Finalized: {
      final_decision: "Commit",
      abort_details:
        "Execution failure (TemplateError): At instruction #1: Cross-template call failed for method 'release_forfeits' on component 'component_d4542df584b5e5682d36c28f39b17c97994eaf4544623b91e7d8fe5b928a8fcc': Template error: no forfeits for the circle",
      execution_result: "gA==",
      execution_time: { secs: 0, nanos: 1000 },
      finalized_time: "2026-11-20 10:53:00.0",
    },
  },
};

function txBody(component: string, method: string): unknown {
  return {
    transaction: {
      instructions: [
        { CallMethod: { call: { Address: component }, method, args: [] } },
      ],
    },
  };
}

// A body in the indexer's full envelope shape, sealed by the
// given key: transaction.transaction.V1 carries the seal
// signature beside the body that holds the instructions.
function sealedTxBody(component: string, method: string, sealKey: string): unknown {
  return {
    transaction: {
      transaction: {
        V1: {
          seal_signature: { public_key: sealKey, signature: "00" },
          body: {
            transaction: {
              instructions: [
                { CallMethod: { call: { Address: component }, method, args: [] } },
              ],
            },
          },
        },
      },
    },
  };
}

describe("parseFinalizeResult", () => {
  it("reads a clean commit", () => {
    expect(parseFinalizeResult(COMMIT_RESULT)).toEqual({
      decision: "Commit",
      abortDetails: null,
    });
  });

  it("reads the fee-only commit's abort details", () => {
    const parsed = parseFinalizeResult(FEE_ONLY_RESULT);
    expect(parsed?.decision).toBe("Commit");
    expect(parsed?.abortDetails).toContain("no forfeits for the circle");
  });

  it("keeps an empty abort_details present: it is a failure marker, not an absence", () => {
    const parsed = parseFinalizeResult({
      result: {
        Finalized: { final_decision: "Commit", abort_details: "" },
      },
    });
    expect(parsed).toEqual({ decision: "Commit", abortDetails: "" });
  });

  it("returns null for payloads with no readable decision", () => {
    expect(parseFinalizeResult(null)).toBeNull();
    expect(parseFinalizeResult({})).toBeNull();
    expect(parseFinalizeResult({ result: {} })).toBeNull();
    expect(parseFinalizeResult({ result: { Finalized: {} } })).toBeNull();
  });
});

describe("sealSigner", () => {
  it("reads the seal from the envelope position", () => {
    expect(
      sealSigner(sealedTxBody(TENDER, "close_reveal", "ab".repeat(32))),
    ).toBe("ab".repeat(32));
  });

  it("ignores a seal_signature nested in instruction data", () => {
    const spoofed = {
      transaction: {
        transaction: {
          V1: {
            seal_signature: { public_key: "cd".repeat(32), signature: "00" },
            body: {
              transaction: {
                instructions: [
                  {
                    CallMethod: {
                      call: { Address: TENDER },
                      method: "close_reveal",
                      args: [{ seal_signature: { public_key: "ab".repeat(32) } }],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    };
    expect(sealSigner(spoofed)).toBe("cd".repeat(32));
  });

  it("returns null when the envelope carries no seal", () => {
    expect(sealSigner(txBody(TENDER, "close_reveal"))).toBeNull();
    expect(sealSigner(null)).toBeNull();
    expect(sealSigner({})).toBeNull();
  });
});

describe("plainReason", () => {
  it("extracts the template's own reason", () => {
    expect(
      plainReason(FEE_ONLY_RESULT.result.Finalized.abort_details),
    ).toBe("no forfeits for the circle");
  });

  it("falls back to the whole detail", () => {
    expect(plainReason("  some other failure ")).toBe("some other failure");
  });
});

describe("calledMethods and txCalls", () => {
  it("maps each component to the methods called on it", () => {
    const calls = calledMethods(buildCommitBid(ACCOUNT, TENDER, "ab".repeat(32), 100n));
    expect(calls.get(ACCOUNT)).toEqual(new Set(["withdraw"]));
    expect(calls.get(TENDER)).toEqual(new Set(["commit_bid"]));
  });

  it("ignores template function calls", () => {
    const calls = calledMethods(
      buildCreateCircle(CIRCLE_TEMPLATE, "circle", ["ab".repeat(32)], 1, null, TENDER_TEMPLATE),
    );
    expect(calls.size).toBe(0);
  });

  it("matches a transaction body against component and methods", () => {
    const body = txBody(TENDER, "close_reveal");
    expect(txCalls(body, TENDER, new Set(["close_reveal"]))).toBe(true);
    expect(txCalls(body, TENDER, new Set(["expire"]))).toBe(false);
    expect(txCalls(body, CIRCLE, new Set(["close_reveal"]))).toBe(false);
  });
});

interface FakeIndexerScript {
  events: { txId: string; topic: string }[][];
  bodies: Record<string, unknown>;
  results: Record<string, unknown>;
}

function fakeIndexer(script: FakeIndexerScript): Indexer {
  let eventCall = 0;
  return {
    events: async () => {
      const page = script.events[Math.min(eventCall, script.events.length - 1)];
      eventCall++;
      return page;
    },
    transaction: async (id: string) => {
      const body = script.bodies[id];
      if (!body) throw new Error("not found");
      return body;
    },
    transactionResult: async (id: string) => {
      const result = script.results[id];
      if (!result) throw new Error("not found");
      return result;
    },
  } as unknown as Indexer;
}

const FAST = { pollMs: 1, eventTries: 4, resultTries: 3 };

describe("confirmAction", () => {
  it("confirms when the action's transaction commits clean", async () => {
    const indexer = fakeIndexer({
      events: [
        [{ txId: OLD_TX, topic: "std.component.updated" }],
        [
          { txId: NEW_TX, topic: "std.component.updated" },
          { txId: OLD_TX, topic: "std.component.updated" },
        ],
      ],
      bodies: { [NEW_TX]: txBody(TENDER, "close_reveal") },
      results: { [NEW_TX]: COMMIT_RESULT },
    });
    const outcome = await confirmAction(
      indexer,
      TENDER,
      new Set(["close_reveal"]),
      new Set([OLD_TX]),
      FAST,
    );
    expect(outcome).toEqual({ kind: "confirmed", txId: NEW_TX, reason: null });
  });

  it("reports a fee-only commit as failed, with the template's reason", async () => {
    const indexer = fakeIndexer({
      events: [
        [
          { txId: NEW_TX, topic: "std.component.updated" },
          { txId: OLD_TX, topic: "std.component.updated" },
        ],
      ],
      bodies: { [NEW_TX]: txBody(TENDER, "close_reveal") },
      results: { [NEW_TX]: FEE_ONLY_RESULT },
    });
    const outcome = await confirmAction(
      indexer,
      TENDER,
      new Set(["close_reveal"]),
      new Set([OLD_TX]),
      FAST,
    );
    expect(outcome).toEqual({
      kind: "failed",
      txId: NEW_TX,
      reason: "no forfeits for the circle",
    });
  });

  it("does not claim a foreign transaction as the action's own", async () => {
    const indexer = fakeIndexer({
      events: [
        [
          { txId: FOREIGN_TX, topic: "std.component.updated" },
          { txId: OLD_TX, topic: "std.component.updated" },
        ],
      ],
      bodies: { [FOREIGN_TX]: txBody(TENDER, "confirm_delivery") },
      results: { [FOREIGN_TX]: FEE_ONLY_RESULT },
    });
    const outcome = await confirmAction(
      indexer,
      TENDER,
      new Set(["close_reveal"]),
      new Set([OLD_TX]),
      FAST,
    );
    expect(outcome.kind).toBe("unconfirmed");
    // An unmatched transaction is never named as the action's
    // own, not even in an unconfirmed outcome.
    expect(outcome.txId).toBeNull();
  });

  it("treats a commit with empty abort details as failed, not success", async () => {
    const indexer = fakeIndexer({
      events: [
        [
          { txId: NEW_TX, topic: "std.component.updated" },
          { txId: OLD_TX, topic: "std.component.updated" },
        ],
      ],
      bodies: { [NEW_TX]: txBody(TENDER, "close_reveal") },
      results: {
        [NEW_TX]: {
          result: {
            Finalized: { final_decision: "Commit", abort_details: "" },
          },
        },
      },
    });
    const outcome = await confirmAction(
      indexer,
      TENDER,
      new Set(["close_reveal"]),
      new Set([OLD_TX]),
      FAST,
    );
    expect(outcome).toEqual({
      kind: "failed",
      txId: NEW_TX,
      reason: "the chain accepted the fee but the execution failed",
    });
  });

  it("requires the seal of the signer's own key when the key is known", async () => {
    const myKey = "ab".repeat(32);
    const otherKey = "cd".repeat(32);
    const events = [
      [
        { txId: NEW_TX, topic: "std.component.updated" },
        { txId: OLD_TX, topic: "std.component.updated" },
      ],
    ];
    const foreignSealed = fakeIndexer({
      events,
      bodies: { [NEW_TX]: sealedTxBody(TENDER, "close_reveal", otherKey) },
      results: { [NEW_TX]: COMMIT_RESULT },
    });
    const notMine = await confirmAction(
      foreignSealed,
      TENDER,
      new Set(["close_reveal"]),
      new Set([OLD_TX]),
      { ...FAST, signer: myKey },
    );
    expect(notMine.kind).toBe("unconfirmed");
    expect(notMine.txId).toBeNull();

    const ownSealed = fakeIndexer({
      events,
      bodies: { [NEW_TX]: sealedTxBody(TENDER, "close_reveal", myKey) },
      results: { [NEW_TX]: COMMIT_RESULT },
    });
    const mine = await confirmAction(
      ownSealed,
      TENDER,
      new Set(["close_reveal"]),
      new Set([OLD_TX]),
      { ...FAST, signer: myKey },
    );
    expect(mine).toEqual({ kind: "confirmed", txId: NEW_TX, reason: null });
  });

  it("is unconfirmed when no new transaction appears", async () => {
    const indexer = fakeIndexer({
      events: [[{ txId: OLD_TX, topic: "std.component.updated" }]],
      bodies: {},
      results: {},
    });
    const outcome = await confirmAction(
      indexer,
      TENDER,
      new Set(["close_reveal"]),
      new Set([OLD_TX]),
      FAST,
    );
    expect(outcome).toEqual({ kind: "unconfirmed", txId: null, reason: null });
  });
});

// The wallet side of submitAction, driven by the same mock
// provider shape as the wallet submit flow tests.
class MockProvider implements TariProvider {
  polls = 0;
  async request(args: { method: string }): Promise<unknown> {
    switch (args.method) {
      case "tari_requestAccounts":
        return [ACCOUNT];
      case "tari_getNetwork":
        return "esmeralda";
      case "tari_createTransactionRequest":
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

const backing = new Map<string, string>();

beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
  (globalThis as { window?: unknown }).window = { tari: new MockProvider() };
});

async function connectedApp(): Promise<App> {
  // The mock provider reports esmeralda, so pin the app to
  // esmeralda: the submit-time guard compares the wallet's
  // network against the app's, and mainnet is the shipped
  // default now.
  backing.set("asiri:network", "esmeralda");
  const app = new App();
  // Poll the fake provider at full speed: riding the production
  // 700 ms poll made these tests take seconds of real time and
  // sit close to the runner's per-test timeout under load.
  app.wallet.pollMs = 1;
  await app.wallet.connect();
  return app;
}

describe("App.submitAction", () => {
  it("confirms a watched action from the indexer record", async () => {
    const app = await connectedApp();
    const indexer = fakeIndexer({
      events: [
        [{ txId: OLD_TX, topic: "std.component.updated" }],
        [
          { txId: NEW_TX, topic: "std.component.updated" },
          { txId: OLD_TX, topic: "std.component.updated" },
        ],
      ],
      bodies: { [NEW_TX]: txBody(TENDER, "close_reveal") },
      results: { [NEW_TX]: COMMIT_RESULT },
    });
    app.indexer.events = indexer.events;
    app.indexer.transaction = indexer.transaction;
    app.indexer.transactionResult = indexer.transactionResult;
    // No live indexer in tests: identity derivation reads the
    // account substate, and a real network read there made these
    // tests as slow as the network felt like being.
    app.indexer.substate = async () => null;
    const { outcome } = await app.submitAction(buildCloseReveal(TENDER), 2_000_000, FAST);
    expect(outcome).toEqual({ kind: "confirmed", txId: NEW_TX, reason: null });
  });

  it("surfaces a chain failure instead of looking like success", async () => {
    const app = await connectedApp();
    const indexer = fakeIndexer({
      events: [
        [{ txId: OLD_TX, topic: "std.component.updated" }],
        [
          { txId: NEW_TX, topic: "std.component.updated" },
          { txId: OLD_TX, topic: "std.component.updated" },
        ],
      ],
      bodies: { [NEW_TX]: txBody(TENDER, "close_reveal") },
      results: { [NEW_TX]: FEE_ONLY_RESULT },
    });
    app.indexer.events = indexer.events;
    app.indexer.transaction = indexer.transaction;
    app.indexer.transactionResult = indexer.transactionResult;
    // No live indexer in tests: identity derivation reads the
    // account substate, and a real network read there made these
    // tests as slow as the network felt like being.
    app.indexer.substate = async () => null;
    const { outcome } = await app.submitAction(buildCloseReveal(TENDER), 2_000_000, FAST);
    expect(outcome.kind).toBe("failed");
    expect(outcome.reason).toBe("no forfeits for the circle");
  });

  it("leaves a template create unconfirmed: there is no component to watch", async () => {
    const app = await connectedApp();
    let eventsRead = false;
    app.indexer.substate = async () => null;
    app.indexer.events = async () => {
      eventsRead = true;
      return [];
    };
    const { outcome } = await app.submitAction(
      buildCreateCircle(CIRCLE_TEMPLATE, "circle", ["ab".repeat(32)], 1, null, TENDER_TEMPLATE),
      2_000_000,
      FAST,
    );
    expect(outcome.kind).toBe("unconfirmed");
    expect(eventsRead).toBe(false);
  });
});
