// Network discovery: the event stream parsing, the candidate
// extraction, the paging rules, the confirmation of candidates
// against their substates, the cache, and the overview's
// rendering order (watched content first, discovery behind
// it). The stream is a server-sent-events replay: blocks of
// id:/data: lines, the data a JSON envelope whose event field
// is base64 CBOR decoding to [substate id, template, topic,
// payload], the substate id an enum [variant, [tagged
// address]] whose tag names the kind of substate.
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app";
import {
  Tagged,
  encArray,
  encBytes,
  encNull,
  encTagged,
  encText,
  encUint,
  hexToBytes,
  type CborValue,
} from "../src/cbor";
import {
  DISCOVERY_FRESH_MS,
  confirmCircle,
  confirmComponents,
  confirmTender,
  discoverNetwork,
  discoveryAgeText,
  readDiscoveryCache,
  writeDiscoveryCache,
} from "../src/discovery";
import {
  Indexer,
  NETWORKS,
  componentCandidates,
  parseStreamBlock,
  renderEventSubstate,
  type NetworkConfig,
  type StreamEvent,
} from "../src/indexer";
import type { CircleComponentState, TenderComponentState } from "../src/state";
import { renderOverview } from "../src/screens/overview";

const B = (hex: string): Uint8Array => hexToBytes(hex);
const COMP_A = `component_${"a1".repeat(32)}`;
const COMP_B = `component_${"b2".repeat(32)}`;
const VAULT = `vault_${"c3".repeat(32)}`;
const TENDER_TEMPLATE_HEX = NETWORKS.esmeralda.tenderTemplate!.slice(9);
const CIRCLE_TEMPLATE_HEX = NETWORKS.esmeralda.circleTemplate!.slice(9);

/** One event's data payload, encoded the way the indexer
 * serves it: base64 CBOR of [substate enum, template, topic,
 * payload]. */
function eventData(tag: number, bodyHex: string, topic: unknown): string {
  const bytes = new Uint8Array(
    encArray([
      encArray([encUint(0), encArray([encTagged(tag, encBytes(B(bodyHex)))])]),
      encBytes(B("22".repeat(32))),
      typeof topic === "string" ? encText(topic) : encUint(Number(topic)),
      encNull,
    ]),
  );
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function block(id: number | null, data: string): string {
  return (id === null ? "" : `id: ${id}\n`) + `data: ${JSON.stringify({ event: data })}`;
}

describe("stream block parsing", () => {
  it("parses a component event with its id and topic", () => {
    const ev = parseStreamBlock(
      block(31924, eventData(128, "a1".repeat(32), "Tender.tender_state")),
    );
    expect(ev).toEqual({ id: 31924, substate: COMP_A, topic: "Tender.tender_state" });
  });

  it("renders vault, resource, and template ids with their own prefixes", () => {
    expect(
      parseStreamBlock(block(1, eventData(132, "c3".repeat(32), "std.vault.pay_fee")))?.substate,
    ).toBe(VAULT);
    expect(
      parseStreamBlock(block(2, eventData(131, "d4".repeat(32), "std.resource")))?.substate,
    ).toBe(`resource_${"d4".repeat(32)}`);
    expect(
      parseStreamBlock(block(3, eventData(137, "e5".repeat(32), "std.template.publish")))?.substate,
    ).toBe(`template_${"e5".repeat(32)}`);
  });

  it("parses an event with no id line as id null", () => {
    const ev = parseStreamBlock(block(null, eventData(128, "a1".repeat(32), "x")));
    expect(ev?.id).toBeNull();
    expect(ev?.substate).toBe(COMP_A);
  });

  it("treats an id that is not a plain safe integer as no id", () => {
    // The id is the paging cursor: an empty, fractional, or
    // beyond-exact-range id must not be allowed to move it.
    const data = eventData(128, "a1".repeat(32), "x");
    for (const raw of ["id: ", "id: 1.5", "id: 9007199254740993", "id: -4"]) {
      const ev = parseStreamBlock(`${raw}\ndata: ${JSON.stringify({ event: data })}`);
      expect(ev?.id).toBeNull();
      expect(ev?.substate).toBe(COMP_A);
    }
  });

  it("falls back to a plain topic when the topic is not text", () => {
    const ev = parseStreamBlock(block(1, eventData(128, "a1".repeat(32), 7)));
    expect(ev?.topic).toBe("event");
  });

  it("parses keepalive and empty blocks to null", () => {
    expect(parseStreamBlock(":")).toBeNull();
    expect(parseStreamBlock(": keepalive")).toBeNull();
    expect(parseStreamBlock("")).toBeNull();
  });

  it("parses malformed data to null instead of throwing", () => {
    expect(parseStreamBlock("data: not json")).toBeNull();
    expect(parseStreamBlock(`data: ${JSON.stringify({ other: 1 })}`)).toBeNull();
    expect(parseStreamBlock(`data: ${JSON.stringify({ event: 42 })}`)).toBeNull();
    expect(parseStreamBlock(`data: ${JSON.stringify({ event: "!!!not-base64!!!" })}`)).toBeNull();
    // Valid base64 and CBOR, but not an event array.
    const notEvent = btoa(String.fromCharCode(0x05));
    expect(parseStreamBlock(`data: ${JSON.stringify({ event: notEvent })}`)).toBeNull();
    // An array too short to hold a topic.
    const short = new Uint8Array(encArray([encUint(1), encUint(2)]));
    let bin = "";
    for (const b of short) bin += String.fromCharCode(b);
    expect(parseStreamBlock(`data: ${JSON.stringify({ event: btoa(bin) })}`)).toBeNull();
  });

  it("parses an event whose substate id has an unknown tag to null", () => {
    expect(parseStreamBlock(block(1, eventData(999, "a1".repeat(32), "x")))).toBeNull();
  });

  it("renders no substate for shapes that are not the id enum", () => {
    expect(renderEventSubstate(5n)).toBeNull();
    expect(renderEventSubstate([0, []])).toBeNull();
    expect(renderEventSubstate([0, [B("a1".repeat(32))]])).toBeNull();
    expect(renderEventSubstate([0, [new Tagged(128, "text")]])).toBeNull();
  });
});

describe("candidate extraction", () => {
  it("keeps only components, deduplicated, in first-seen order", () => {
    const events: StreamEvent[] = [
      { id: 1, substate: COMP_A, topic: "a" },
      { id: 2, substate: VAULT, topic: "b" },
      { id: 3, substate: COMP_B, topic: "c" },
      { id: 4, substate: COMP_A, topic: "d" },
      { id: 5, substate: `resource_${"d4".repeat(32)}`, topic: "e" },
      { id: 6, substate: `template_${"e5".repeat(32)}`, topic: "f" },
    ];
    expect(componentCandidates(events)).toEqual([COMP_A, COMP_B]);
  });

  it("finds no candidates in an empty replay", () => {
    expect(componentCandidates([])).toEqual([]);
  });
});

// ---------- the stream paging, against a stubbed fetch ----------

const PRIMARY = "https://primary.test";
const FALLBACK = "https://fallback.test";

interface PageScript {
  chunks?: string[];
  // After the chunks: close the stream (true) or hang until
  // aborted (false / unset).
  close?: boolean;
  error?: boolean;
  status?: number;
}

let fetchCalls: string[] = [];
let pages: Record<string, PageScript> = {};
const realFetch = globalThis.fetch;

function installFetch(): void {
  globalThis.fetch = (async (url: unknown, init?: { signal?: AbortSignal }) => {
    const u = String(url);
    fetchCalls.push(u);
    const base = u.startsWith(PRIMARY) ? PRIMARY : FALLBACK;
    const after = new URL(u).searchParams.get("after_id");
    const script = pages[`${base}|${after}`] ?? {};
    if (script.error) throw new Error("network down");
    if (script.status)
      return { ok: false, status: script.status, body: null } as Response;
    const chunks = script.chunks ?? [];
    let i = 0;
    const reader = {
      read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
        if (i < chunks.length)
          return Promise.resolve({
            done: false,
            value: new TextEncoder().encode(chunks[i++]),
          });
        if (script.close) return Promise.resolve({ done: true });
        // Hang, as a live tail with nothing to say does, until
        // the reader aborts.
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        });
      },
    };
    return { ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response;
  }) as typeof fetch;
}

function streamIndexer(): Indexer {
  const cfg: NetworkConfig = {
    ...NETWORKS.esmeralda,
    indexer: PRIMARY,
    indexerFallback: FALLBACK,
  };
  return new Indexer(cfg);
}

const TEMPLATE = `template_${"ab".repeat(32)}`;
const FAST = { idleMs: 25, pageMs: 5_000 };

describe("template event replay", () => {
  beforeEach(() => {
    fetchCalls = [];
    pages = {};
    installFetch();
  });

  it("pages by after_id until a page yields no events, collecting components only", async () => {
    pages[`${PRIMARY}|0`] = {
      chunks: [
        block(5, eventData(128, "a1".repeat(32), "Tender.tender_state")) +
          "\n\n" +
          block(6, eventData(132, "c3".repeat(32), "std.vault.pay_fee")) +
          "\n\n" +
          block(7, eventData(128, "b2".repeat(32), "Tender.tender_state")) +
          "\n\n",
      ],
      close: true,
    };
    pages[`${PRIMARY}|7`] = { chunks: [":\n\n"] }; // head: keepalives only, then hang
    let seen = 0;
    const found = await streamIndexer().templateEventComponents(TEMPLATE, {
      ...FAST,
      onEvent: () => seen++,
    });
    expect(found).toEqual([COMP_A, COMP_B]);
    expect(seen).toBe(3);
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0]).toContain("after_id=0");
    expect(fetchCalls[0]).toContain(`template_address=${"ab".repeat(32)}`);
    expect(fetchCalls[1]).toContain("after_id=7");
  });

  it("stops when a page's ids do not move past the last one seen", async () => {
    pages[`${PRIMARY}|0`] = {
      chunks: [block(0, eventData(128, "a1".repeat(32), "x")) + "\n\n"],
      close: true,
    };
    const found = await streamIndexer().templateEventComponents(TEMPLATE, FAST);
    expect(found).toEqual([COMP_A]);
    expect(fetchCalls).toHaveLength(1);
  });

  it("throws at the page cap rather than returning a partial set", async () => {
    // Every page moves forward, so the head is never seen:
    // the pass must fail loudly instead of presenting the
    // first pages' components as the whole network.
    for (let p = 0; p < 6; p++) {
      pages[`${PRIMARY}|${p}`] = {
        chunks: [
          block(p + 1, eventData(128, `f${p}`.repeat(32).slice(0, 64), "x")) + "\n\n",
        ],
        close: true,
      };
    }
    await expect(
      streamIndexer().templateEventComponents(TEMPLATE, { ...FAST, maxPages: 3 }),
    ).rejects.toThrow("longer than one read");
    expect(fetchCalls.filter((u) => u.startsWith(PRIMARY))).toHaveLength(3);
  });

  it("refuses the all-zero template address without opening a stream", async () => {
    await expect(
      streamIndexer().templateEventComponents(`template_${"00".repeat(32)}`, FAST),
    ).rejects.toThrow("all-zero");
    expect(fetchCalls).toEqual([]);
  });

  it("refuses a malformed template address without opening a stream", async () => {
    await expect(
      streamIndexer().templateEventComponents("template_zz", FAST),
    ).rejects.toThrow("cannot be read");
    expect(fetchCalls).toEqual([]);
  });

  it("uses the fallback indexer when the primary's stream fails", async () => {
    pages[`${PRIMARY}|0`] = { error: true };
    pages[`${FALLBACK}|0`] = {
      chunks: [block(9, eventData(128, "a1".repeat(32), "x")) + "\n\n"],
      close: true,
    };
    pages[`${FALLBACK}|9`] = { chunks: [":\n\n"] };
    const found = await streamIndexer().templateEventComponents(TEMPLATE, FAST);
    expect(found).toEqual([COMP_A]);
    expect(fetchCalls[0]).toContain(PRIMARY);
    expect(fetchCalls[1]).toContain(FALLBACK);
  });

  it("uses the fallback indexer when the primary answers an error status", async () => {
    pages[`${PRIMARY}|0`] = { status: 503 };
    pages[`${FALLBACK}|0`] = {
      chunks: [block(9, eventData(128, "a1".repeat(32), "x")) + "\n\n"],
      close: true,
    };
    pages[`${FALLBACK}|9`] = { chunks: [":\n\n"] };
    const found = await streamIndexer().templateEventComponents(TEMPLATE, FAST);
    expect(found).toEqual([COMP_A]);
  });

  it("does not trust an empty primary while a fallback exists to ask", async () => {
    pages[`${PRIMARY}|0`] = { chunks: [":\n\n"] }; // nothing, then hang
    pages[`${FALLBACK}|0`] = {
      chunks: [block(9, eventData(128, "a1".repeat(32), "x")) + "\n\n"],
      close: true,
    };
    pages[`${FALLBACK}|9`] = { chunks: [":\n\n"] };
    const found = await streamIndexer().templateEventComponents(TEMPLATE, FAST);
    expect(found).toEqual([COMP_A]);
  });

  it("does not accept an empty answer from one indexer while the other fails", async () => {
    // An empty replay is proof of nothing existing only when
    // it can be cross-checked; with the fallback unreachable
    // the pass fails and discovery retries later.
    pages[`${PRIMARY}|0`] = { chunks: [":\n\n"] }; // nothing, then hang
    pages[`${FALLBACK}|0`] = { error: true };
    await expect(
      streamIndexer().templateEventComponents(TEMPLATE, FAST),
    ).rejects.toThrow("network down");
  });

  it("throws when every indexer's stream fails", async () => {
    pages[`${PRIMARY}|0`] = { error: true };
    pages[`${FALLBACK}|0`] = { error: true };
    await expect(
      streamIndexer().templateEventComponents(TEMPLATE, FAST),
    ).rejects.toThrow("network down");
  });

  it("returns empty, and does not throw, when the stream stalls on every indexer", async () => {
    // No chunks at all, on either indexer: each page ends by
    // its idle window with no events, which is the head.
    const found = await streamIndexer().templateEventComponents(TEMPLATE, FAST);
    expect(found).toEqual([]);
  });
});

// ---------- candidate confirmation and the discovery pass ----------

function tenderRoot(templateHex: string, circleName = "uyo provisions circle"): CborValue {
  const rules: CborValue = [
    B("07".repeat(32)), 10000n, 100n, 5, 5, 3, 5, 3, 4, 2, 3,
  ];
  const state: CborValue[] = [
    new Tagged(128, B("aa".repeat(32))),
    circleName,
    true,
    [B("11".repeat(32)), B("22".repeat(32)), B("33".repeat(32))],
    rules,
    B("08".repeat(32)),
    [1, []], // Open
    new Tagged(132, B("cc".repeat(32))),
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
  return [0, [[[B(templateHex), 0], [state]]]];
}

function circleRoot(templateHex: string, tenders: CborValue[] = []): CborValue {
  const state: CborValue[] = [
    "uyo provisions circle",
    [B("11".repeat(32))],
    [B("11".repeat(32)), B("22".repeat(32))],
    2,
    null,
    new Tagged(132, B("dd".repeat(32))),
    tenders,
    [],
    [],
    1,
    0,
    0,
  ];
  return [0, [[[B(templateHex), 0], [state]]]];
}

const CIRCLE_OK = `component_${"c1".repeat(32)}`;
const CIRCLE_WRONG = `component_${"c2".repeat(32)}`;
const TENDER_OK = `component_${"d1".repeat(32)}`;

function stubIndexer(values: Record<string, CborValue | null>): Indexer {
  return {
    cfg: NETWORKS.esmeralda,
    substate: async (id: string) =>
      id in values && values[id] ? { version: 0, value: values[id]! } : null,
  } as unknown as Indexer;
}

describe("candidate confirmation", () => {
  it("confirms a tender that runs the tender template and decodes", async () => {
    const idx = stubIndexer({ [TENDER_OK]: tenderRoot(TENDER_TEMPLATE_HEX) });
    const state = await confirmTender(idx, TENDER_OK);
    expect(state?.template).toBe(NETWORKS.esmeralda.tenderTemplate);
    expect(state?.state).toBe("Open");
  });

  it("drops a tender candidate running a different template", async () => {
    const idx = stubIndexer({ [TENDER_OK]: tenderRoot("ff".repeat(32)) });
    expect(await confirmTender(idx, TENDER_OK)).toBeNull();
  });

  it("drops a candidate whose substate is down", async () => {
    const idx = stubIndexer({ [TENDER_OK]: null });
    expect(await confirmTender(idx, TENDER_OK)).toBeNull();
  });

  it("confirms a circle and drops one running a different template", async () => {
    const idx = stubIndexer({
      [CIRCLE_OK]: circleRoot(CIRCLE_TEMPLATE_HEX),
      [CIRCLE_WRONG]: circleRoot("ff".repeat(32)),
    });
    expect((await confirmCircle(idx, CIRCLE_OK))?.name).toBe("uyo provisions circle");
    expect(await confirmCircle(idx, CIRCLE_WRONG)).toBeNull();
  });

  it("keeps the candidates the read accepts and drops the ones it rejects", async () => {
    const read = async (addr: string): Promise<TenderComponentState | null> => {
      if (addr === COMP_A) return { template: "t" } as TenderComponentState;
      return null;
    };
    const out = await confirmComponents([COMP_A, COMP_B, VAULT], read);
    expect([...out.keys()]).toEqual([COMP_A]);
  });

  it("fails the pass when a confirming read fails, rather than dropping the candidate quietly", async () => {
    const read = async (addr: string): Promise<TenderComponentState | null> => {
      if (addr === COMP_A) return { template: "t" } as TenderComponentState;
      throw new Error("the indexer could not be reached");
    };
    await expect(confirmComponents([COMP_A, COMP_B], read)).rejects.toThrow(
      "could not be reached",
    );
  });
});

describe("the discovery pass", () => {
  it("gathers the confirmed circles and tenders from both templates", async () => {
    const values: Record<string, CborValue | null> = {
      [CIRCLE_OK]: circleRoot(CIRCLE_TEMPLATE_HEX),
      [CIRCLE_WRONG]: circleRoot("ff".repeat(32)),
      [TENDER_OK]: tenderRoot(TENDER_TEMPLATE_HEX),
    };
    const calls: string[] = [];
    const fake = {
      cfg: NETWORKS.esmeralda,
      templateEventComponents: async (t: string) => {
        calls.push(t);
        return t === NETWORKS.esmeralda.circleTemplate
          ? [CIRCLE_OK, CIRCLE_WRONG]
          : [TENDER_OK];
      },
      substate: async (id: string) =>
        id in values && values[id] ? { version: 0, value: values[id]! } : null,
    } as unknown as Indexer;
    const before = Date.now();
    const set = await discoverNetwork(fake);
    expect(set.circles).toEqual([CIRCLE_OK]);
    expect(set.tenders).toEqual([TENDER_OK]);
    expect(set.at).toBeGreaterThanOrEqual(before);
    expect(set.at).toBeLessThanOrEqual(Date.now());
    // One stream at a time: circles first, then tenders.
    expect(calls).toEqual([
      NETWORKS.esmeralda.circleTemplate,
      NETWORKS.esmeralda.tenderTemplate,
    ]);
  });

  it("refuses a network with no templates configured before any stream opens", async () => {
    let streams = 0;
    const fake = {
      cfg: { ...NETWORKS.mainnet, circleTemplate: null, tenderTemplate: null },
      templateEventComponents: async () => {
        streams++;
        return [];
      },
      substate: async () => null,
    } as unknown as Indexer;
    await expect(discoverNetwork(fake)).rejects.toThrow("not published");
    expect(streams).toBe(0);
  });
});

// ---------- the cache and the age wording ----------

const backing = new Map<string, string>();

beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
});

describe("discovery cache", () => {
  it("round-trips a set per network", () => {
    const set = { at: 123_000, circles: [CIRCLE_OK], tenders: [TENDER_OK] };
    writeDiscoveryCache("esmeralda", set);
    expect(readDiscoveryCache("esmeralda")).toEqual(set);
    expect(readDiscoveryCache("mainnet")).toBeNull();
  });

  it("reads malformed stored values as no cache", () => {
    backing.set("asiri:discovery:esmeralda", "{not json");
    expect(readDiscoveryCache("esmeralda")).toBeNull();
    backing.set(
      "asiri:discovery:esmeralda",
      JSON.stringify({ at: "soon", circles: [], tenders: [] }),
    );
    expect(readDiscoveryCache("esmeralda")).toBeNull();
  });

  it("reads a future-dated stored set as no cache", () => {
    // A stamp ahead of now would never age, and would hold
    // the automatic re-read off for good.
    backing.set(
      "asiri:discovery:esmeralda",
      JSON.stringify({ at: Date.now() + 3_600_000, circles: [], tenders: [] }),
    );
    expect(readDiscoveryCache("esmeralda")).toBeNull();
  });

  it("keeps only string entries in the stored lists", () => {
    backing.set(
      "asiri:discovery:esmeralda",
      JSON.stringify({ at: 5, circles: [CIRCLE_OK, 7, null], tenders: "x" }),
    );
    expect(readDiscoveryCache("esmeralda")).toEqual({
      at: 5,
      circles: [CIRCLE_OK],
      tenders: [],
    });
  });

  it("words the age of a read", () => {
    const now = 1_700_000_000_000;
    expect(discoveryAgeText(now, now)).toBe("just now");
    expect(discoveryAgeText(now - 5 * 60_000, now)).toBe("about 5 minutes ago");
    expect(discoveryAgeText(now - 2 * 3_600_000, now)).toBe("about 2 hours ago");
    expect(DISCOVERY_FRESH_MS).toBe(600_000);
  });
});

// ---------- the overview: watched first, discovery behind it ----------

class FakeEl {
  className = "";
  value = "";
  rows = 0;
  placeholder = "";
  type = "";
  disabled = false;
  href = "";
  id = "";
  htmlFor = "";
  title = "";
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: FakeEl[] = [];
  private ownText = "";
  constructor(public tag: string) {}
  get classList() {
    const self = this;
    return {
      contains: (c: string) => self.className.split(/\s+/).includes(c),
      add: (c: string) => {
        if (!self.classList.contains(c))
          self.className = self.className ? `${self.className} ${c}` : c;
      },
    };
  }
  set textContent(v: string) {
    this.ownText = v;
    this.children = [];
  }
  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  private adopt(node: unknown): FakeEl {
    if (node instanceof FakeEl) return node;
    const t = new FakeEl("#text");
    t.ownText = (node as { text?: string })?.text ?? String(node);
    return t;
  }
  append(...nodes: unknown[]): void {
    for (const n of nodes) this.children.push(this.adopt(n));
  }
  prepend(...nodes: unknown[]): void {
    for (const n of [...nodes].reverse()) this.children.unshift(this.adopt(n));
  }
  replaceChildren(...nodes: unknown[]): void {
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(): void {}
  querySelectorAll(sel: string): FakeEl[] {
    const cls = sel.replace(/^\./, "");
    const out: FakeEl[] = [];
    const walk = (el: FakeEl) => {
      for (const c of el.children) {
        if (c.classList.contains(cls)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  remove(): void {}
}

(globalThis as { document?: unknown }).document = {
  createElement: (tag: string) => new FakeEl(tag),
  createTextNode: (text: string) => ({ text }),
};

const FEATURED = NETWORKS.esmeralda.featuredCircle!;
const T_FEATURED = `component_${"f1".repeat(32)}`;
const T_WATCHED = `component_${"f2".repeat(32)}`;
const C_DISC = `component_${"f3".repeat(32)}`;
const T_DISC = `component_${"f4".repeat(32)}`;
const T_DISC_LONE = `component_${"f5".repeat(32)}`;

async function flush(times = 40): Promise<void> {
  for (let i = 0; i < times; i++)
    await new Promise((r) => setTimeout(r, 0));
}

describe("overview discovery rendering", () => {
  it("renders watched and featured tenders before discovery completes, then marks the discovered ones", async () => {
    // The fixtures are the esmeralda featured circle and its
    // templates, so the app is pinned to esmeralda: mainnet is
    // the shipped default now.
    backing.set("asiri:network", "esmeralda");
    backing.set(
      "asiri:watched",
      JSON.stringify({ circles: [], tenders: [T_WATCHED] }),
    );
    const values: Record<string, CborValue | null> = {
      [FEATURED]: circleRoot(CIRCLE_TEMPLATE_HEX, [
        new Tagged(128, B("f1".repeat(32))),
      ]),
      [T_FEATURED]: tenderRoot(TENDER_TEMPLATE_HEX, "featured circle tenders"),
      [T_WATCHED]: tenderRoot(TENDER_TEMPLATE_HEX, "watched tender"),
      [C_DISC]: circleRoot(CIRCLE_TEMPLATE_HEX, [
        new Tagged(128, B("f4".repeat(32))),
      ]),
      [T_DISC]: tenderRoot(TENDER_TEMPLATE_HEX, "discovered circle tender"),
      [T_DISC_LONE]: tenderRoot(TENDER_TEMPLATE_HEX, "lone discovered tender"),
    };
    const app = new App();
    app.indexer.substate = (async (id: string) =>
      id in values && values[id]
        ? { version: 0, value: values[id]! }
        : null) as typeof app.indexer.substate;
    app.indexer.epoch = async () => 100;
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    app.indexer.templateEventComponents = (async (t: string) => {
      await held;
      return t === NETWORKS.esmeralda.circleTemplate
        ? [C_DISC]
        : [T_DISC, T_DISC_LONE];
    }) as typeof app.indexer.templateEventComponents;

    const rootEl = new FakeEl("div");
    await renderOverview(app, rootEl as unknown as HTMLElement, () => {});

    // Watched and featured content is already there, and
    // nothing claims to be discovered yet: the pass is still
    // reading behind it.
    expect(rootEl.textContent).toContain("featured circle tenders");
    expect(rootEl.textContent).toContain("watched tender");
    expect(rootEl.textContent).not.toContain("discovered on the network");
    expect(rootEl.textContent).toContain("reads this network's public event record");

    release();
    await flush();

    // The discovered tenders join the list, marked, and the
    // discovery section reports the found set and lists the
    // discovered circle.
    expect(rootEl.textContent).toContain("discovered circle tender");
    expect(rootEl.textContent).toContain("lone discovered tender");
    expect(rootEl.textContent).toContain("Discovered on the network");
    expect(rootEl.textContent).toContain(
      "Discovery found 1 circle and 2 tenders on this network, read just now.",
    );
    expect(rootEl.textContent).toContain("Open circle");
    // The pass was cached for the next screen that gathers.
    expect(readDiscoveryCache("esmeralda")?.circles).toEqual([C_DISC]);
    expect(readDiscoveryCache("esmeralda")?.tenders).toEqual([
      T_DISC,
      T_DISC_LONE,
    ]);
  });

  it("shows the cached set at once on a later visit and does not re-read while it is fresh", async () => {
    backing.set("asiri:network", "esmeralda");
    writeDiscoveryCache("esmeralda", {
      at: Date.now(),
      circles: [C_DISC],
      tenders: [T_DISC_LONE],
    });
    const values: Record<string, CborValue | null> = {
      [FEATURED]: circleRoot(CIRCLE_TEMPLATE_HEX, []),
      [C_DISC]: circleRoot(CIRCLE_TEMPLATE_HEX, []),
      [T_DISC_LONE]: tenderRoot(TENDER_TEMPLATE_HEX, "cached discovered tender"),
    };
    const app = new App();
    app.indexer.substate = (async (id: string) =>
      id in values && values[id]
        ? { version: 0, value: values[id]! }
        : null) as typeof app.indexer.substate;
    app.indexer.epoch = async () => 100;
    let streams = 0;
    app.indexer.templateEventComponents = (async () => {
      streams++;
      return [];
    }) as typeof app.indexer.templateEventComponents;

    const rootEl = new FakeEl("div");
    await renderOverview(app, rootEl as unknown as HTMLElement, () => {});
    await flush(5);
    expect(rootEl.textContent).toContain("cached discovered tender");
    expect(rootEl.textContent).toContain("read just now");
    expect(streams).toBe(0);
  });

  it("on mainnet, discovery runs and reports the empty set it found", async () => {
    backing.set("asiri:network", "mainnet");
    const app = new App();
    app.indexer.substate = (async () => null) as typeof app.indexer.substate;
    let streams = 0;
    app.indexer.templateEventComponents = (async () => {
      streams++;
      return [];
    }) as typeof app.indexer.templateEventComponents;
    const rootEl = new FakeEl("div");
    await renderOverview(app, rootEl as unknown as HTMLElement, () => {});
    await flush(5);
    // One stream per template: circles first, then tenders.
    expect(streams).toBe(2);
    expect(rootEl.textContent).toContain(
      "Discovery found 0 circles and 0 tenders on this network",
    );
    expect(rootEl.textContent).toContain("No public tenders are listed on Mainnet yet");
    expect(rootEl.textContent).not.toContain(
      "There is nothing to discover on Mainnet yet",
    );
  });

  it("on a network with no templates published, says there is nothing to discover and opens no stream", async () => {
    // Both shipped networks are configured today, so the
    // unconfigured case clears the mainnet templates for the
    // length of the test and restores them after.
    const savedMainnet = { ...NETWORKS.mainnet };
    NETWORKS.mainnet.circleTemplate = null;
    NETWORKS.mainnet.tenderTemplate = null;
    try {
      backing.set("asiri:network", "mainnet");
      const app = new App();
      app.indexer.substate = (async () => null) as typeof app.indexer.substate;
      let streams = 0;
      app.indexer.templateEventComponents = (async () => {
        streams++;
        return [];
      }) as typeof app.indexer.templateEventComponents;
      const rootEl = new FakeEl("div");
      await renderOverview(app, rootEl as unknown as HTMLElement, () => {});
      expect(rootEl.textContent).toContain("There is nothing to discover on Mainnet yet");
      expect(rootEl.textContent).toContain("No public tenders are listed on Mainnet yet");
      expect(streams).toBe(0);
    } finally {
      Object.assign(NETWORKS.mainnet, savedMainnet);
    }
  });

  it("falls back to the watched set with a plain note when discovery cannot read the network", async () => {
    backing.set("asiri:network", "esmeralda");
    const values: Record<string, CborValue | null> = {
      [FEATURED]: circleRoot(CIRCLE_TEMPLATE_HEX, [
        new Tagged(128, B("f1".repeat(32))),
      ]),
      [T_FEATURED]: tenderRoot(TENDER_TEMPLATE_HEX, "featured circle tenders"),
    };
    const app = new App();
    app.indexer.substate = (async (id: string) =>
      id in values && values[id]
        ? { version: 0, value: values[id]! }
        : null) as typeof app.indexer.substate;
    app.indexer.epoch = async () => 100;
    app.indexer.templateEventComponents = (async () => {
      throw new Error("network down");
    }) as typeof app.indexer.templateEventComponents;
    const rootEl = new FakeEl("div");
    await renderOverview(app, rootEl as unknown as HTMLElement, () => {});
    await flush();
    expect(rootEl.textContent).toContain("featured circle tenders");
    expect(rootEl.textContent).toContain(
      "Discovery could not read the network this time.",
    );
    expect(readDiscoveryCache("esmeralda")).toBeNull();
  });
});
