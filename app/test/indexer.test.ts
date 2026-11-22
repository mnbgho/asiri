import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Indexer, NETWORKS } from "../src/indexer";

// The template substate carries the whole WASM binary and the
// public indexers intermittently stall serving it, so a large
// read retries across both indexers with a long timeout. These
// tests stub fetch and record which base each attempt used.
const PRIMARY = "https://ootle-indexer-a.tari.com";
const FALLBACK = "https://esme-indexer-a.ootle.tari.com";

type Call = { url: string; signal: boolean };
let calls: Call[] = [];
let behaviour: (url: string) => unknown;
const realFetch = globalThis.fetch;

function upBody() {
  // CBOR for the integer 7 is the single byte 0x07.
  return { version: 0, state: { up: { substate: "Bw==" } } };
}

beforeEach(() => {
  calls = [];
  behaviour = () => upBody();
  globalThis.fetch = (async (url: unknown, init?: { signal?: unknown }) => {
    const u = String(url);
    calls.push({ url: u, signal: Boolean(init?.signal) });
    const body = behaviour(u);
    return { ok: true, status: 200, json: async () => body };
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function indexer(): Indexer {
  return new Indexer(NETWORKS.esmeralda);
}

describe("indexer large reads", () => {
  it("falls back to the second indexer when the first throws", async () => {
    behaviour = (url) => {
      if (url.startsWith(PRIMARY)) throw new Error("stalled");
      return upBody();
    };
    const got = await indexer().substate("template_x", { large: true });
    expect(got?.value).toBe(7n);
    expect(calls.map((c) => c.url.split("/")[2])).toEqual([
      "ootle-indexer-a.tari.com",
      "esme-indexer-a.ootle.tari.com",
    ]);
    expect(calls.every((c) => c.signal)).toBe(true);
  });

  it("throws after the primary, the fallback, and the primary again all fail", async () => {
    behaviour = () => {
      throw new Error("stalled");
    };
    await expect(indexer().substate("template_x", { large: true })).rejects.toThrow("stalled");
    expect(calls).toHaveLength(3);
  });

  it("treats a down answer as definitive and does not retry", async () => {
    behaviour = () => ({ version: 3, state: { down: { version: 3 } } });
    const got = await indexer().substate("template_x", { large: true });
    expect(got).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("reads small substates from the primary once", async () => {
    const got = await indexer().substate("component_x");
    expect(got?.value).toBe(7n);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith(PRIMARY)).toBe(true);
    expect(calls[0].signal).toBe(true);
  });

  it("falls back to the second indexer on a small read too", async () => {
    behaviour = (url) => {
      if (url.startsWith(PRIMARY)) throw new Error("stalled");
      return upBody();
    };
    const got = await indexer().substate("component_x");
    expect(got?.value).toBe(7n);
    expect(calls.map((c) => c.url.split("/")[2])).toEqual([
      "ootle-indexer-a.tari.com",
      "esme-indexer-a.ootle.tari.com",
    ]);
  });

  it("falls back to the second indexer on a transaction read", async () => {
    behaviour = (url) => {
      if (url.startsWith(PRIMARY)) throw new Error("not found");
      return { transaction_id: "tx1" };
    };
    const got = (await indexer().transaction("tx1")) as { transaction_id: string };
    expect(got.transaction_id).toBe("tx1");
    expect(calls.map((c) => c.url.split("/")[2])).toEqual([
      "ootle-indexer-a.tari.com",
      "esme-indexer-a.ootle.tari.com",
    ]);
  });

  it("has the esmeralda fallback configured", () => {
    expect(NETWORKS.esmeralda.indexerFallback).toBe(FALLBACK);
    expect(NETWORKS.mainnet.indexerFallback).toBeNull();
  });
});
