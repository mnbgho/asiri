// Plain-language address errors and the seller desk's reveal
// pre-checks. A pasted address that is not a tender or a circle
// must be described in plain words, never in decoder vocabulary,
// and a reveal must be refused before submission when the wallet
// is not connected or the tender is outside its reveal window.
import { describe, expect, it } from "vitest";
import type { App } from "../src/app";
import { Tagged, hexToBytes, type CborValue } from "../src/cbor";
import { plainAddressError } from "../src/state";
import { checkRevealable } from "../src/screens/seller";

const COMPONENT = `component_${"bb".repeat(32)}`;
const VAULT = `vault_${"cc".repeat(32)}`;
const RESOURCE = `resource_${"dd".repeat(32)}`;
const TEMPLATE = `template_${"ee".repeat(32)}`;

describe("plainAddressError", () => {
  it("names a vault address as a vault, whatever the decoder said", () => {
    const out = plainAddressError(
      VAULT,
      new Error("expected an array for component substate"),
    );
    expect(out).toContain("belongs to a vault");
    expect(out).not.toContain("expected an array");
  });

  it("names resource and template addresses by their kind", () => {
    expect(plainAddressError(RESOURCE, new Error("anything"))).toContain(
      "belongs to a resource",
    );
    expect(plainAddressError(TEMPLATE, new Error("anything"))).toContain(
      "belongs to a template",
    );
  });

  it("maps an unknown component address to a not-found message", () => {
    const out = plainAddressError(
      COMPONENT,
      new Error(`not found on esmeralda testnet: /substates/${COMPONENT}`),
    );
    expect(out).toContain("Nothing was found at that address on this network");
  });

  it("maps a down component to a not-live message", () => {
    const out = plainAddressError(COMPONENT, new Error("that component is down"));
    expect(out).toContain("record is not live on this network");
  });

  it("maps decoder wording to not-a-tender-or-circle", () => {
    for (const wording of [
      "expected an array for component substate",
      "expected an integer for budget_cap",
      "tender state has 4 fields, expected 35 or 36",
      "unknown state index 9",
    ]) {
      const out = plainAddressError(COMPONENT, new Error(wording));
      expect(out).toContain("not a tender or a circle");
      expect(out).not.toContain("expected");
    }
  });

  it("does not claim a malformed prefix string belongs to that kind", () => {
    const out = plainAddressError(
      "vault_not-an-address",
      new Error("not found on esmeralda testnet: /substates/vault_not-an-address"),
    );
    expect(out).toContain("Nothing was found at that address on this network");
    expect(out).not.toContain("belongs to a vault");
  });

  it("passes unrelated errors through unchanged", () => {
    const out = plainAddressError(
      COMPONENT,
      new Error("the indexer did not answer in time"),
    );
    expect(out).toBe("the indexer did not answer in time");
  });
});

const B = (hex: string): Uint8Array => hexToBytes(hex);

function tenderRoot(stateEnum: number, revealDeadline: number): CborValue {
  const rules: CborValue = [
    B("07".repeat(32)),
    10000n,
    100n,
    5,
    5,
    3,
    5,
    3,
    4,
    2,
    3,
  ];
  const state: CborValue[] = [
    new Tagged(128, B("aa".repeat(32))),
    "Uyo Shopkeepers Circle",
    true,
    [B("11".repeat(32)), B("22".repeat(32)), B("33".repeat(32))],
    rules,
    B("99".repeat(32)),
    [stateEnum, []],
    new Tagged(132, B("cc".repeat(32))),
    new Tagged(132, B("dd".repeat(32))),
    null,
    10,
    15,
    revealDeadline,
    23,
    23,
    28,
    31,
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
  return [0, [[[B("ee".repeat(32)), 0], [state]]]];
}

function fakeApp(opts: {
  account: string | null;
  substate: CborValue | null;
  epoch?: number;
  substateError?: Error;
}): App {
  return {
    wallet: { account: opts.account },
    indexer: {
      substate: async () => {
        if (opts.substateError) throw opts.substateError;
        return opts.substate ? { version: 0, value: opts.substate } : null;
      },
      epoch: async () => opts.epoch ?? 0,
    },
  } as unknown as App;
}

describe("checkRevealable", () => {
  it("refuses before submission when the wallet is not connected", async () => {
    const app = fakeApp({ account: null, substate: tenderRoot(2, 20) });
    await expect(checkRevealable(app, COMPONENT)).rejects.toThrow(
      "Connect your wallet first",
    );
  });

  it("maps a rejecting indexer read to plain language", async () => {
    const app = fakeApp({
      account: COMPONENT,
      substate: null,
      substateError: new Error("expected an array for component substate"),
    });
    await expect(checkRevealable(app, COMPONENT)).rejects.toThrow(
      "not a tender or a circle",
    );
  });

  it("refuses when the component record is not live", async () => {
    const app = fakeApp({ account: COMPONENT, substate: null });
    await expect(checkRevealable(app, COMPONENT)).rejects.toThrow(
      "record is not live on this network",
    );
  });

  it("refuses in plain words when the address is not a tender", async () => {
    const app = fakeApp({ account: COMPONENT, substate: [0, []] });
    await expect(checkRevealable(app, COMPONENT)).rejects.toThrow(
      "not a tender or a circle",
    );
  });

  it("refuses when the tender is not in its reveal state", async () => {
    const app = fakeApp({
      account: COMPONENT,
      substate: tenderRoot(1, 20), // Open
      epoch: 12,
    });
    await expect(checkRevealable(app, COMPONENT)).rejects.toThrow(
      "not in its reveal window",
    );
  });

  it("refuses when the reveal deadline has passed", async () => {
    const app = fakeApp({
      account: COMPONENT,
      substate: tenderRoot(2, 20), // Reveal, deadline 20
      epoch: 21,
    });
    await expect(checkRevealable(app, COMPONENT)).rejects.toThrow(
      "The reveal window closed at epoch 20",
    );
  });

  it("passes inside the reveal window", async () => {
    const app = fakeApp({
      account: COMPONENT,
      substate: tenderRoot(2, 20),
      epoch: 20,
    });
    await expect(checkRevealable(app, COMPONENT)).resolves.toBeUndefined();
  });
});
