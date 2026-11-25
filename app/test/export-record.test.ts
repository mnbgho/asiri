// The circle record export's gathering: bounded, progressive,
// and honest when a read stalls. Measured live, one export of
// a nine-tender circle is 186 indexer reads and about 48
// seconds when every read answers promptly, and the indexers
// intermittently stall individual reads, so the gather gives
// each tender a time budget and the whole export a total one.
// A stalled tender stands in the record as unreadable, or with
// its checks marked as not run, rather than holding the click
// open in silence. The template's code substate, the largest
// read in the set, is read once per export, not once per
// tender.
import { describe, expect, it } from "vitest";
import {
  Tagged,
  hexToBytes,
  type CborValue,
} from "../src/cbor";
import {
  gatherCircleRecord,
  EXPORT_TENDER_BUDGET_MS,
  EXPORT_TOTAL_BUDGET_MS,
} from "../src/circle-export";
import { rulesHash } from "../src/hash";
import { NETWORKS, type Indexer, type NetworkConfig } from "../src/indexer";
import type { TenderRules } from "../src/model";
import type { CircleComponentState } from "../src/state";
import { verifyTender } from "../src/verify";

const B = (hex: string): Uint8Array => hexToBytes(hex);
const TEMPLATE_HEX = "ee".repeat(32);
const TEMPLATE = `template_${TEMPLATE_HEX}`;
const CIRCLE = `component_${"aa".repeat(32)}`;
const T_OK = `component_${"b1".repeat(32)}`;
const T_STALL = `component_${"b2".repeat(32)}`;
const T_DOWN = `component_${"b3".repeat(32)}`;
const T_VSTALL = `component_${"b4".repeat(32)}`;
const ESCROW = `vault_${"cc".repeat(32)}`;
const ESCROW_STALL = `vault_${"c9".repeat(32)}`;
const BONDS = `vault_${"dd".repeat(32)}`;
const TREASURY = `vault_${"d9".repeat(32)}`;

const RULES: TenderRules = {
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

function wasm(): Uint8Array {
  const out = new Uint8Array(2001).fill(1);
  out[0] = 0;
  out[1] = 0x61;
  out[2] = 0x73;
  out[3] = 0x6d;
  return out;
}

function vault(balance: bigint): CborValue {
  return [0, [[new Tagged(131, B("01".repeat(32))), balance]]];
}

async function tenderRoot(escrow: string = ESCROW): Promise<CborValue> {
  const rules: CborValue = [
    B(RULES.specificationHash),
    RULES.budgetCap,
    RULES.bondAmount,
    RULES.bidWindowEpochs,
    RULES.revealWindowEpochs,
    RULES.overrideWindowEpochs,
    RULES.deliveryWindowEpochs,
    RULES.claimGraceEpochs,
    RULES.disputeWindowEpochs,
    RULES.approvalThreshold,
    RULES.disputeThreshold,
  ];
  const state: CborValue[] = [
    new Tagged(128, B("aa".repeat(32))),
    "uyo provisions circle",
    true,
    [B("11".repeat(32)), B("22".repeat(32)), B("33".repeat(32))],
    rules,
    B(await rulesHash(RULES)),
    [1, []], // Open
    new Tagged(132, B(escrow.slice(6))),
    new Tagged(132, B("dd".repeat(32))),
    null,
    10, 15, 20, 23, 23, 28, 31,
    [],
    [],
    0,
    null,
    [],
    null,
    [],
    null,
    [],
    null,
    null,
    false,
    false,
    0n,
    0n,
    false,
    [],
    0,
  ];
  return [0, [[[B(TEMPLATE_HEX), 0], [state]]]];
}

function circle(tenders: string[]): CircleComponentState {
  return {
    template: "template_circle",
    name: "uyo provisions circle",
    members: ["11".repeat(32)],
    approvers: ["11".repeat(32), "22".repeat(32)],
    threshold: 2,
    auditor: null,
    treasuryVault: TREASURY,
    tenders,
    withdrawals: [],
    approverChanges: [],
    nextProposalId: 1,
  };
}

interface FakeOpts {
  stall?: Set<string>;
  down?: Set<string>;
  delay?: Map<string, number>;
}

async function fakeIndexer(opts: FakeOpts = {}): Promise<{
  indexer: Indexer;
  calls: string[];
}> {
  const cfg: NetworkConfig = {
    ...NETWORKS.esmeralda,
    tenderTemplate: TEMPLATE,
    tenderCodeHash: null,
  };
  const values: Record<string, CborValue> = {
    [TREASURY]: vault(50_000_000n),
    [TEMPLATE]: [0, [[wasm()]]],
    [T_OK]: await tenderRoot(),
    [T_VSTALL]: await tenderRoot(ESCROW_STALL),
    [ESCROW]: vault(10000n),
    [ESCROW_STALL]: vault(10000n),
    [BONDS]: vault(0n),
  };
  const calls: string[] = [];
  const indexer = {
    cfg,
    substate: async (id: string) => {
      calls.push(id);
      if (opts.stall?.has(id)) return new Promise(() => {});
      const d = opts.delay?.get(id);
      if (d) await new Promise((r) => setTimeout(r, d));
      if (opts.down?.has(id)) return null;
      return id in values ? { version: 0, value: values[id] } : null;
    },
    events: async () => [],
    transaction: async () => ({}),
  } as unknown as Indexer;
  return { indexer, calls };
}

describe("gathering a circle record", () => {
  it("reads the template's code once for the whole export, however many tenders", async () => {
    const { indexer, calls } = await fakeIndexer();
    const got = await gatherCircleRecord(indexer, CIRCLE, circle([T_OK, T_OK]));
    expect(calls.filter((c) => c === TEMPLATE)).toHaveLength(1);
    expect(got.input.treasuryBalance).toBe(50_000_000n);
    expect(got.unreadable).toBe(0);
    expect(got.unchecked).toBe(0);
    for (const entry of got.input.tenders) {
      expect(entry.read).toBe("ok");
      if (entry.read === "ok") {
        expect(entry.verification.status).toBe("checked");
        expect(entry.verification.fail).toBe(0);
      }
    }
  });

  it("reports progress as it reads, tender by tender", async () => {
    const { indexer } = await fakeIndexer();
    const messages: string[] = [];
    await gatherCircleRecord(indexer, CIRCLE, circle([T_OK]), {
      onProgress: (m) => messages.push(m),
    });
    expect(messages[0]).toBe("Reading the treasury…");
    expect(messages).toContain("Reading the tender template's code…");
    expect(messages).toContain("Reading tender 1 of 1…");
    expect(messages).toContain("Checking tender 1 of 1…");
  });

  it("carries a stalled tender as unreadable and still finishes, in bounded time", async () => {
    const { indexer } = await fakeIndexer({ stall: new Set([T_STALL]) });
    const started = Date.now();
    const got = await gatherCircleRecord(
      indexer,
      CIRCLE,
      circle([T_OK, T_STALL, T_DOWN]),
      { tenderBudgetMs: 40, templateBudgetMs: 40, totalBudgetMs: 5_000 },
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(got.input.tenders).toHaveLength(3);
    const [ok, stalled, down] = got.input.tenders;
    expect(ok.read).toBe("ok");
    expect(stalled.read).toBe("unreadable");
    if (stalled.read === "unreadable")
      expect(stalled.note).toContain("stalled");
    expect(down.read).toBe("unreadable");
    if (down.read === "unreadable")
      expect(down.note).toContain("not live");
    expect(got.unreadable).toBe(2);
  });

  it("keeps a tender whose state read fine but whose checks stalled, with the checks marked not run", async () => {
    const { indexer } = await fakeIndexer({ stall: new Set([ESCROW_STALL]) });
    const got = await gatherCircleRecord(indexer, CIRCLE, circle([T_VSTALL]), {
      tenderBudgetMs: 40,
      templateBudgetMs: 40,
      totalBudgetMs: 5_000,
    });
    const [entry] = got.input.tenders;
    expect(entry.read).toBe("ok");
    if (entry.read === "ok") {
      expect(entry.verification.status).toBe("could not be checked");
      expect(entry.verification.note).toContain("could not be completed");
    }
    expect(got.unchecked).toBe(1);
  });

  it("marks the tenders it never reached when the total budget runs out", async () => {
    const { indexer } = await fakeIndexer({
      delay: new Map([[T_OK, 60]]),
    });
    const got = await gatherCircleRecord(
      indexer,
      CIRCLE,
      circle([T_OK, T_OK, T_OK]),
      { tenderBudgetMs: 1_000, templateBudgetMs: 1_000, totalBudgetMs: 20 },
    );
    expect(got.input.tenders).toHaveLength(3);
    expect(got.input.tenders[0].read).toBe("ok");
    for (const entry of got.input.tenders.slice(1)) {
      expect(entry.read).toBe("unreadable");
      if (entry.read === "unreadable")
        expect(entry.note).toContain("time limit");
    }
  });

  it("keeps the budgets generous against the measured live read", () => {
    // The measured full export of a nine-tender circle took
    // about 48 seconds with every read answering promptly.
    expect(EXPORT_TENDER_BUDGET_MS).toBeGreaterThanOrEqual(30_000);
    expect(EXPORT_TOTAL_BUDGET_MS).toBeGreaterThanOrEqual(120_000);
  });
});

describe("the verifier's pre-read template digest", () => {
  it("checks the code hash from the given digest without reading the template", async () => {
    const { indexer, calls } = await fakeIndexer();
    const { report } = await verifyTender(indexer, T_OK, {
      templateDigest: "ab".repeat(32),
    });
    const row = report.rows.find((r) => r.check === "template code hash");
    expect(row?.ok).toBe(true); // the recorded hash is null in this fixture config
    expect(row?.detail).toContain("ab".repeat(32));
    expect(calls).not.toContain(TEMPLATE);
  });

  it("marks the code check could-not-read when the pre-read could not be completed", async () => {
    const { indexer } = await fakeIndexer();
    const { report } = await verifyTender(indexer, T_OK, {
      templateDigest: null,
    });
    const row = report.rows.find((r) => r.check === "template code hash");
    expect(row?.ok).toBeNull();
    expect(row?.detail).toContain("could not be read");
  });
});
