// Verifier consistency checks: the commitment records in a tender
// state must be internally consistent (one commitment per seller,
// no duplicated commitment hash, and the revealed flags must match
// the recorded reveals), or the record counts check fails. Built
// from a minimal open tender with no reveals, so every other check
// passes and the record counts row is the only one that can fail.
import { describe, expect, it } from "vitest";
import {
  Tagged,
  encArray,
  encBytes,
  encUint,
  hexToBytes,
  toHex,
  type CborValue,
} from "../src/cbor";
import { commitmentHash, rulesHash } from "../src/hash";
import { NETWORKS, type Indexer, type NetworkConfig } from "../src/indexer";
import type { TenderRules } from "../src/model";
import { verifyTender } from "../src/verify";

const TEMPLATE_HEX = "ee".repeat(32);
const TEMPLATE = `template_${TEMPLATE_HEX}`;
const TENDER = `component_${"bb".repeat(32)}`;
const ESCROW = `vault_${"cc".repeat(32)}`;
const BONDS = `vault_${"dd".repeat(32)}`;
const SELLER_A = "a1".repeat(32);
const SELLER_B = "b2".repeat(32);
const COMMIT = "c1".repeat(32);
const COMMIT2 = "c2".repeat(32);

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

const B = (hex: string): Uint8Array => hexToBytes(hex);

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

function commitment(
  seller: string,
  hash: string,
  revealed: boolean,
): CborValue {
  // [seller, commitment, epoch, revealed, bond enum Held]
  return [B(seller), B(hash), 10, revealed, [0, []]];
}

async function tenderRoot(
  commitments: CborValue[],
  reveals: CborValue[] = [],
  opts: {
    stateEnum?: number;
    award?: CborValue | null;
    settlement?: CborValue | null;
  } = {},
): Promise<CborValue> {
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
    "Uyo Shopkeepers Circle",
    true,
    [B("11".repeat(32)), B("22".repeat(32)), B("33".repeat(32))],
    rules,
    B(await rulesHash(RULES)),
    [opts.stateEnum ?? 1, []], // Open by default
    new Tagged(132, B("cc".repeat(32))),
    new Tagged(132, B("dd".repeat(32))),
    null,
    10,
    15,
    20,
    23,
    23,
    28,
    31,
    commitments,
    reveals,
    0,
    opts.award ?? null,
    [],
    null,
    [],
    null,
    [],
    opts.settlement ?? null,
    null,
    false,
    false,
    0n,
    0n,
    false,
    [],
    0,
  ];
  // 35 fields: the receipt id slot is omitted, as on chain.
  return [0, [[[B(TEMPLATE_HEX), 0], [state]]]];
}

async function fakeIndexer(
  commitments: CborValue[],
  opts: {
    reveals?: CborValue[];
    events?: () => Promise<{ txId: string; topic: string }[]>;
    transaction?: (id: string) => Promise<unknown>;
    stateEnum?: number;
    award?: CborValue | null;
    settlement?: CborValue | null;
  } = {},
): Promise<Indexer> {
  const cfg: NetworkConfig = {
    ...NETWORKS.esmeralda,
    tenderTemplate: TEMPLATE,
    tenderCodeHash: null,
  };
  const substates: Record<string, CborValue> = {
    [TENDER]: await tenderRoot(commitments, opts.reveals ?? [], opts),
    [TEMPLATE]: [0, [[wasm()]]],
    [ESCROW]: vault(10000n),
    [BONDS]: vault(BigInt(commitments.length) * 100n),
  };
  return {
    cfg,
    substate: async (id: string) =>
      id in substates ? { version: 0, value: substates[id] } : null,
    events: opts.events ?? (async () => []),
    transaction: opts.transaction ?? (async () => ({})),
  } as unknown as Indexer;
}

describe("verifier record counts", () => {
  it("passes for one consistent commitment", async () => {
    const { report } = await verifyTender(
      await fakeIndexer([commitment(SELLER_A, COMMIT, false)]),
      TENDER,
    );
    expect(report.failed).toEqual([]);
  });

  it("fails for a duplicated commitment hash", async () => {
    const { report } = await verifyTender(
      await fakeIndexer([
        commitment(SELLER_A, COMMIT, false),
        commitment(SELLER_B, COMMIT, false),
      ]),
      TENDER,
    );
    expect(report.failed.map((r) => r.check)).toEqual(["record counts"]);
  });

  it("fails for a duplicated seller", async () => {
    const { report } = await verifyTender(
      await fakeIndexer([
        commitment(SELLER_A, COMMIT, false),
        commitment(SELLER_A, COMMIT2, false),
      ]),
      TENDER,
    );
    expect(report.failed.map((r) => r.check)).toEqual(["record counts"]);
  });

  it("fails when a revealed flag has no matching reveal", async () => {
    const { report } = await verifyTender(
      await fakeIndexer([commitment(SELLER_A, COMMIT, true)]),
      TENDER,
    );
    expect(report.failed.map((r) => r.check)).toEqual(["record counts"]);
  });
});

// The reveal hunt reads the tender's transactions from the
// indexer. When no indexer will serve them, the reveals recorded
// in the tender state are still chain data; what is missing is
// the corroborating read. The check must report could-not-read
// (ok null), never a failure accusing the record, and it must
// still fail when a read history that answers holds no reveal.
// Mirrors the same cases in scripts/test_verify.py.
describe("verifier reveal reads", () => {
  const IDENTITY = SELLER_A;
  const PRICE = 1950n;
  const SALT = new Uint8Array(32).map((_, i) => i);

  function revealRecord(commitmentHex: string): CborValue {
    // [seller, price, epoch, counter, valid, commitment]
    return [B(IDENTITY), PRICE, 12, 0, true, B(commitmentHex)];
  }

  function revealTxBody(): unknown {
    const lit = (b: number[]) => ({ Literal: toHex(b) });
    return {
      transaction: {
        instructions: [
          {
            CallMethod: {
              call: { Address: TENDER },
              method: "reveal_bid",
              args: [
                lit(encUint(PRICE)),
                lit(encArray([...SALT].map((x) => encUint(x)))),
                lit(encBytes(B(IDENTITY))),
              ],
            },
          },
        ],
      },
    };
  }

  async function revealedIndexer(
    transaction: (id: string) => Promise<unknown>,
  ): Promise<Indexer> {
    const digest = await commitmentHash(PRICE, SALT, IDENTITY);
    return fakeIndexer([commitment(IDENTITY, digest, true)], {
      reveals: [revealRecord(digest)],
      events: async () => [{ txId: "tx-reveal", topic: "event" }],
      transaction,
    });
  }

  it("passes when the reveal transaction recomputes", async () => {
    const { report } = await verifyTender(
      await revealedIndexer(async () => revealTxBody()),
      TENDER,
    );
    const row = report.rows.find(
      (r) => r.check === "reveals verify against commitments",
    );
    expect(row?.ok).toBe(true);
    expect(report.failed).toEqual([]);
  });

  it("reports could not read when every transaction read fails", async () => {
    const { report } = await verifyTender(
      await revealedIndexer(async () => {
        throw new Error("not found on esmeralda testnet: /transactions/tx-reveal");
      }),
      TENDER,
    );
    const row = report.rows.find(
      (r) => r.check === "reveals verify against commitments",
    );
    expect(row?.ok).toBeNull();
    expect(row?.detail).toContain("could not be read");
    expect(report.failed.map((r) => r.check)).not.toContain(
      "reveals verify against commitments",
    );
    expect(report.unknown.map((r) => r.check)).toContain(
      "reveals verify against commitments",
    );
  });

  it("names a component that is not a tender in plain words", async () => {
    const indexer = await fakeIndexer([commitment(SELLER_A, COMMIT, false)]);
    // Rebuild the root with a different template in the header,
    // the shape a circle component has.
    const inner = indexer as unknown as {
      substate: (id: string) => Promise<{ version: number; value: CborValue } | null>;
    };
    const original = inner.substate.bind(inner);
    inner.substate = async (id: string) => {
      const got = await original(id);
      if (!got || id !== TENDER) return got;
      const root = structuredClone(got.value) as unknown[];
      const entry = (root[1] as unknown[])[0] as unknown[];
      const header = entry[0] as unknown[];
      header[0] = B("ff".repeat(32));
      return { version: 0, value: root as CborValue };
    };
    const { report } = await verifyTender(indexer, TENDER);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].check).toBe("tender exists");
    expect(report.rows[0].ok).toBe(false);
    expect(report.rows[0].detail).toContain("does not run the tender template");
  });

  it("still fails when a readable history holds no reveal", async () => {
    const { report } = await verifyTender(
      await revealedIndexer(async () => ({ transaction: { instructions: [] } })),
      TENDER,
    );
    const row = report.rows.find(
      (r) => r.check === "reveals verify against commitments",
    );
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain("no reveal transaction found");
  });
});

// The settlement row's detail must state the comparison it
// actually made: a record whose settlement names a different
// winner than the award fails, and its sentence must say the
// winner does not match, never the fixed words "winner matches
// the award". Mirrors the same cases in scripts/test_verify.py.
describe("verifier settlement wording", () => {
  const PRICE = 2140n;
  const award: CborValue = [B(SELLER_A), B(COMMIT), PRICE, 1, 1];

  it("says the winner matches when the settlement names the award winner", async () => {
    const { report } = await verifyTender(
      await fakeIndexer([commitment(SELLER_A, COMMIT, false)], {
        stateEnum: 5, // Settled
        award,
        settlement: [B(SELLER_A), PRICE, 25],
      }),
      TENDER,
    );
    const row = report.rows.find(
      (r) => r.check === "settlement equals the award",
    );
    expect(row?.ok).toBe(true);
    expect(row?.detail).toContain("winner matches the award");
  });

  it("says the winner does not match when the settlement names another winner", async () => {
    const { report } = await verifyTender(
      await fakeIndexer([commitment(SELLER_A, COMMIT, false)], {
        stateEnum: 5, // Settled
        award,
        settlement: [B(SELLER_B), PRICE, 25],
      }),
      TENDER,
    );
    const row = report.rows.find(
      (r) => r.check === "settlement equals the award",
    );
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain("winner does not match the award");
    expect(row?.detail).not.toContain("winner matches the award");
  });
});
