// Reads from the public Ootle indexer for the selected network.
// The app has no server: every read goes straight from the browser
// to the indexer, and every value shown is decoded from the
// substate the indexer serves.
import { base64ToBytes, bytesToHex, decode, Tagged, type CborValue } from "./cbor";

export type NetworkName = "mainnet" | "esmeralda";

export interface NetworkConfig {
  name: NetworkName;
  label: string;
  indexer: string;
  // A second indexer for the network, used when a large read
  // stalls on the first. Null when the network has only one.
  indexerFallback: string | null;
  explorer: string;
  // Template addresses for this network, filled in at publish time.
  circleTemplate: string | null;
  tenderTemplate: string | null;
  // SHA-256 of each template's published code, for the verifier.
  circleCodeHash: string | null;
  tenderCodeHash: string | null;
  // A circle anyone can open to see live tenders on this network.
  featuredCircle: string | null;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  mainnet: {
    name: "mainnet",
    label: "Mainnet",
    indexer: "https://indexer-a.ootle.tari.com",
    indexerFallback: null,
    explorer: "https://explorer.tari.mw",
    circleTemplate: "template_b86a46241753b8b8e4c2e9571c0db727925d77e1274009175e4f0b0e18cf466b",
    tenderTemplate: "template_267d1d73da73ec990e8711e492bccb9112076051d396922bdef2b9d667c684eb",
    circleCodeHash: "72c9bb84c7e77b2cdc724a5619aed6dd5c5be71d1bea9eb685b2bab5e0d4609c",
    tenderCodeHash: "ff672fdced3cccd2c7c7649b4b6107322872ff83d2a347c8a1a30a5461f531e9",
    featuredCircle: "component_46237d52379c5d9289814c67ca840f5fa2aad2b12ed2291acf0e74a5091aca71",
  },
  esmeralda: {
    name: "esmeralda",
    label: "Esmeralda testnet",
    indexer: "https://ootle-indexer-a.tari.com",
    indexerFallback: "https://esme-indexer-a.ootle.tari.com",
    explorer: "https://testnet-explorer.tari.mw",
    circleTemplate: "template_d2677930a7e9283c3ead76a54ba9e9cd360ee5dda8a8a56ead8e84a88f45bdd1",
    tenderTemplate: "template_ad7e4c4b5d19f0bc4c9a22d3dd52d73ad5e2d374d7c79361558d338919ccfbf2",
    circleCodeHash: "405cadc91fa0a32afa2221833a3110115c4051db60c3a85431b1bc2ef3c92cf0",
    tenderCodeHash: "f6cd9585c8a799caafc781450ca5d50496a8412640bb9de587f49049e0fc0803",
    featuredCircle: "component_a1dec38cf9e72a702eed7665730507928b10b823750a72f81a6a5c89a66c6181",
  },
};

/** A network carries live content once its templates are set. */
export function templatesConfigured(cfg: NetworkConfig): boolean {
  return cfg.circleTemplate !== null && cfg.tenderTemplate !== null;
}

/**
 * The header pill for a network, stated truthfully: a network
 * is live when its templates are published there. A network
 * with nothing published yet says so instead of borrowing the
 * word live.
 */
export function networkPill(cfg: NetworkConfig): string {
  return templatesConfigured(cfg)
    ? `${cfg.label} · Live`
    : `${cfg.label} · Templates not published yet`;
}

/**
 * The network a first visit lands on: the first network with
 * templates configured, mainnet preferred when it is configured.
 * A network with no templates yet has no live tenders to show, so
 * it is never the landing network while another network is live.
 * When nothing is configured, mainnet remains the default.
 */
export function defaultNetwork(
  configs: Record<NetworkName, NetworkConfig> = NETWORKS,
): NetworkName {
  if (templatesConfigured(configs.mainnet)) return "mainnet";
  if (templatesConfigured(configs.esmeralda)) return "esmeralda";
  return "mainnet";
}

/**
 * A read that failed in transit: the network, the proxy, or the
 * indexer did not deliver usable bytes. Bytes that arrived but
 * cannot be decoded are never a TransportError; they are data
 * errors, and callers report them as failures, not as unreadable.
 * Mirrors the standalone verifier's TransportError.
 */
export class TransportError extends Error {}

/** Bytes arrived from the indexer but are not shaped like the
 *  record they claim to be. Distinct from TransportError: a
 *  malformed response is a failure of the record, never an
 *  unreadable read. */
export class MalformedResponseError extends Error {}

export function isTransportError(e: unknown): boolean {
  return e instanceof TransportError;
}

export class Indexer {
  constructor(public cfg: NetworkConfig) {}

  private async get(path: string, base?: string, timeoutMs?: number): Promise<unknown> {
    const init: RequestInit = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs) {
      const ctl = new AbortController();
      timer = setTimeout(() => ctl.abort(), timeoutMs);
      init.signal = ctl.signal;
    }
    let res: Response;
    try {
      res = await fetch(`${base ?? this.cfg.indexer}${path}`, init);
    } catch (e) {
      // The fetch never returned, or the timeout aborted it:
      // nothing usable arrived, so this is a transport failure,
      // never evidence about the record.
      throw new TransportError(e instanceof Error ? e.message : String(e));
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 404)
      throw new TransportError(`Not found on ${this.cfg.label}: ${path}`);
    if (!res.ok)
      throw new TransportError(`The ${this.cfg.label} indexer answered ${res.status}`);
    // A body that will not parse as JSON is a data error, not a
    // transport one: bytes arrived and they are not a record.
    return res.json();
  }

  /** Current epoch from the network endpoint. */
  async epoch(): Promise<number> {
    const body = (await this.get("/network")) as { epoch?: number };
    if (typeof body.epoch !== "number") throw new Error("Indexer gave no epoch");
    return body.epoch;
  }

  /**
   * Fetch one substate and decode its value. Returns null when the
   * substate is down (replaced or deleted); throws when it does not
   * exist at all.
   */
  async substate(
    id: string,
    opts?: { large?: boolean },
  ): Promise<{ version: number; value: CborValue } | null> {
    // The public indexers intermittently stall, sometimes on
    // any read and sometimes only on the template substate,
    // which carries the whole WASM binary. Every substate read
    // retries across both indexers before giving up; a large
    // read gets a long timeout per attempt, a small one 30
    // seconds. A down answer is definitive and returns at once.
    const timeoutMs = opts?.large ? 120_000 : 30_000;
    const bases = [this.cfg.indexer];
    if (this.cfg.indexerFallback) bases.push(this.cfg.indexerFallback);
    bases.push(this.cfg.indexer);
    let last: unknown = null;
    for (const base of bases) {
      try {
        return await this.readSubstate(id, base, timeoutMs);
      } catch (e) {
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  private async readSubstate(
    id: string,
    base: string,
    timeoutMs?: number,
  ): Promise<{ version: number; value: CborValue } | null> {
    const body = (await this.get(`/substates/${id}`, base, timeoutMs)) as {
      version?: number;
      state?: { up?: { substate?: string }; down?: unknown };
    };
    if (body.state?.down) return null;
    const raw = body.state?.up?.substate;
    if (!raw) throw new Error(`Substate ${id} has no live value`);
    return { version: body.version ?? 0, value: decode(base64ToBytes(raw)) };
  }

  /**
   * Events for one substate (a component), newest first. The
   * indexer serves each event as a [transaction id, base64 CBOR]
   * pair; the CBOR decodes to [substate, template, topic, payload],
   * so normalize to plain {txId, topic} objects here.
   */
  // The same failover as the substate reads: the public
  // indexers intermittently stall or answer a transient error,
  // and a verification makes many of these reads.
  private async getJson(path: string): Promise<unknown> {
    const bases = [this.cfg.indexer];
    if (this.cfg.indexerFallback) bases.push(this.cfg.indexerFallback);
    bases.push(this.cfg.indexer);
    // The same rule as the standalone verifier: failover can
    // rescue a read, so every base is tried whatever the previous
    // failure was, but the error that survives is chosen by what
    // it means. Bytes that arrived but would not parse are
    // evidence the record is invalid and win; only when every
    // attempt failed in transit is the failure a transport error.
    let lastTransport: unknown = null;
    let firstData: unknown = null;
    for (const base of bases) {
      try {
        return await this.get(path, base, 30_000);
      } catch (e) {
        if (isTransportError(e)) lastTransport = e;
        else if (!firstData) firstData = e;
      }
    }
    const err = firstData ?? lastTransport;
    throw err instanceof Error ? err : new Error(String(err));
  }

  async events(substateId: string): Promise<{ txId: string; topic: string }[]> {
    const body = (await this.getJson(
      `/transactions/events?substate_id=${encodeURIComponent(substateId)}`,
    )) as { events?: unknown[] } | unknown[];
    // The indexer serves a list, or an object with a list under
    // "events". Anything else is malformed delivered data: an
    // event entry without a transaction id cannot be read as an
    // event list with fewer transactions, because a skipped entry
    // could be the one carrying a reveal. An object without an
    // "events" key reads as no events; the failure mode stays
    // safe, since the reveal check reports the reveals as could
    // not be checked when nothing was read.
    const raw: unknown = Array.isArray(body)
      ? body
      : (body as { events?: unknown } | null)?.events;
    if (raw === undefined && body !== null && typeof body === "object" && !("events" in body)) {
      return [];
    }
    if (!Array.isArray(raw)) {
      throw new MalformedResponseError("The event list is not a list");
    }
    return raw.map((entry) => {
      if (Array.isArray(entry)) {
        if (entry.length === 0 || typeof entry[0] !== "string" || !entry[0]) {
          throw new MalformedResponseError("malformed event entry");
        }
        let topic = "event";
        if (typeof entry[1] === "string") {
          try {
            const decoded = decode(base64ToBytes(entry[1]));
            if (Array.isArray(decoded) && typeof decoded[2] === "string")
              topic = decoded[2];
          } catch {
            /* keep the default topic */
          }
        }
        return { txId: entry[0], topic };
      }
      if (entry !== null && typeof entry === "object") {
        const obj = entry as Record<string, unknown>;
        const txId = obj.transaction_id ?? obj.tx_id ?? "";
        if (typeof txId !== "string" || !txId) {
          throw new MalformedResponseError("malformed event entry");
        }
        return {
          txId,
          topic: String(obj.topic ?? "event"),
        };
      }
      throw new MalformedResponseError("malformed event entry");
    });
  }

  /** A transaction's finalize result, for explorer-style detail. */
  async transactionResult(id: string): Promise<unknown> {
    return this.getJson(`/transactions/${id}/result`);
  }

  /** A transaction's full body, instructions included. */
  async transaction(id: string): Promise<unknown> {
    return this.getJson(`/transactions/${id}`);
  }

  /**
   * Recent transactions, newest first. Each entry is wrapped
   * to the same shape the single-transaction body endpoint
   * serves, so the seal, the instructions and the summary
   * outcome read the same way. Best effort: the indexer holds
   * what it observed on gossip, so a transaction can be
   * missing here even when it committed.
   */
  async recentTransactions(
    limit = 20,
  ): Promise<{ txId: string; body: unknown }[]> {
    const body = (await this.getJson(
      `/transactions/recent?limit=${limit}`,
    )) as { transactions?: unknown[] } | unknown[];
    const raw: unknown = Array.isArray(body)
      ? body
      : (body as { transactions?: unknown } | null)?.transactions;
    if (!Array.isArray(raw)) {
      throw new MalformedResponseError("The recent list is not a list");
    }
    return raw.map((entry) => {
      if (entry === null || typeof entry !== "object") {
        throw new MalformedResponseError("malformed recent transaction entry");
      }
      const obj = entry as Record<string, unknown>;
      const txId = obj.transaction_id ?? obj.tx_id ?? "";
      if (typeof txId !== "string" || !txId) {
        throw new MalformedResponseError("malformed recent transaction entry");
      }
      return { txId, body: { transaction: entry } };
    });
  }

  explorerTx(id: string): string {
    return `${this.cfg.explorer}/tx/${id}`;
  }
  explorerComponent(id: string): string {
    return `${this.cfg.explorer}/substate/${id}`;
  }

  /**
   * Every component that has ever emitted an event under one
   * template, found by replaying the indexer's event stream
   * for that template from the start of the chain. The stream
   * endpoint is the one route that filters by template: the
   * bare hex form is the filter (the template_-prefixed form is
   * rejected), after_id pages through the replay, and a page
   * that yields no events means the head has been reached.
   * Pages are read one at a time and each is closed as soon as
   * it goes quiet, because the indexer caps concurrent stream
   * connections. The all-zero address is refused outright: the
   * indexer treats it as no filter at all and would answer
   * with the whole network's event record.
   *
   * Throws when no indexer could be read at all. An empty
   * result from one indexer is not trusted while another
   * indexer exists to ask, so the first non-empty answer wins.
   * Empty is the answer only when every indexer answered and
   * none failed: an empty replay from one indexer while the
   * other could not be read at all is not proof that nothing
   * exists, so that case throws and the caller retries later.
   */
  async templateEventComponents(
    templateAddress: string,
    opts: StreamReadOptions = {},
  ): Promise<string[]> {
    const hex = templateAddress.startsWith("template_")
      ? templateAddress.slice("template_".length)
      : templateAddress;
    if (!/^[0-9a-f]{64}$/.test(hex))
      throw new Error("That template address cannot be read on this network");
    if (/^0{64}$/.test(hex))
      throw new Error("The all-zero template address is not a filter");
    const bases = [this.cfg.indexer];
    if (this.cfg.indexerFallback) bases.push(this.cfg.indexerFallback);
    let last: unknown = null;
    let lastEmpty: string[] | null = null;
    for (const base of bases) {
      try {
        const found = await this.replayTemplateEvents(base, hex, opts);
        if (found.length) return found;
        lastEmpty = found;
      } catch (e) {
        last = e;
      }
    }
    if (lastEmpty && last === null) return lastEmpty;
    throw last instanceof Error ? last : new Error(String(last));
  }

  private async replayTemplateEvents(
    base: string,
    templateHex: string,
    opts: StreamReadOptions,
  ): Promise<string[]> {
    const maxPages = opts.maxPages ?? STREAM_MAX_PAGES;
    const all: StreamEvent[] = [];
    let after = 0;
    let reachedHead = false;
    for (let page = 0; page < maxPages; page++) {
      const { events, maxId } = await this.readEventPage(
        base,
        templateHex,
        after,
        opts,
      );
      if (events.length === 0) {
        reachedHead = true;
        break;
      }
      all.push(...events);
      // Paging continues only while the replay moves forward:
      // a page whose ids do not pass the last one seen is the
      // head, whatever it carried.
      if (maxId === null || maxId <= after) {
        reachedHead = true;
        break;
      }
      after = maxId;
    }
    // The page cap bounds one pass. Reaching it without
    // seeing the head throws rather than returning a partial
    // set as if it were the whole network.
    if (!reachedHead)
      throw new Error(
        "That template's event history is longer than one read covers",
      );
    return componentCandidates(all);
  }

  /**
   * One page of the event stream: open at after_id, collect
   * events until the stream closes, goes quiet for the idle
   * window, or reaches the page's time cap, whichever comes
   * first. Quiet is measured from the last event, not the last
   * byte: once the replay reaches the head the indexer holds
   * the stream open and sends only keepalive comments, and a
   * capture holding nothing but keepalives is how the head is
   * recognised. A read that fails before any timer fires is a
   * real failure and throws; a page ended by a timer returns
   * what it gathered.
   */
  private async readEventPage(
    base: string,
    templateHex: string,
    after: number,
    opts: StreamReadOptions,
  ): Promise<{ events: StreamEvent[]; maxId: number | null }> {
    const idleMs = opts.idleMs ?? STREAM_IDLE_MS;
    const pageMs = opts.pageMs ?? STREAM_PAGE_MS;
    const ctl = new AbortController();
    const res = await fetch(
      `${base}/transactions/events/stream?template_address=${templateHex}&after_id=${after}`,
      { signal: ctl.signal },
    );
    if (!res.ok)
      throw new Error(`The ${this.cfg.label} indexer answered ${res.status}`);
    if (!res.body) throw new Error("The indexer sent no event stream");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const events: StreamEvent[] = [];
    let maxId: number | null = null;
    let buffer = "";
    let endedByTimer = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        endedByTimer = true;
        ctl.abort();
      }, idleMs);
    };
    const pageTimer = setTimeout(() => {
      endedByTimer = true;
      ctl.abort();
    }, pageMs);
    armIdle();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut = buffer.indexOf("\n\n");
        while (cut >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const ev = parseStreamBlock(block);
          if (ev) {
            events.push(ev);
            if (ev.id !== null && (maxId === null || ev.id > maxId))
              maxId = ev.id;
            opts.onEvent?.();
            armIdle();
          }
          cut = buffer.indexOf("\n\n");
        }
      }
    } catch (e) {
      if (!endedByTimer) throw e;
    } finally {
      clearTimeout(pageTimer);
      if (idleTimer) clearTimeout(idleTimer);
    }
    return { events, maxId };
  }
}

/** One event from the indexer's event stream. */
export interface StreamEvent {
  // The stream's own event id, used to page the replay. Null
  // when the block carried no parseable id.
  id: number | null;
  // The substate the event belongs to, rendered with its kind
  // prefix: component_, vault_, resource_, or template_. A
  // template's replay also carries the events of the vaults
  // and resources its components own, so this is a candidate
  // to filter, never a finding on its own.
  substate: string;
  topic: string;
}

export interface StreamReadOptions {
  // Stop a page after this long with no new event. The replay
  // is a fast burst followed by keepalives at the head, so a
  // quiet window is how a page recognises the head.
  idleMs?: number;
  // Hard cap on one page's read, however much arrives.
  pageMs?: number;
  // Hard cap on pages per replay.
  maxPages?: number;
  // Called as each event arrives, for progress reporting.
  onEvent?: () => void;
}

// The replay's measured shape today: a template's whole
// history is a few hundred events arriving in a burst, so a
// page goes quiet within seconds of the head. The caps keep a
// pathological stream from holding a screen open forever.
export const STREAM_IDLE_MS = 4_000;
export const STREAM_PAGE_MS = 30_000;
export const STREAM_MAX_PAGES = 12;

const SUBSTATE_PREFIXES: Record<number, string> = {
  128: "component_",
  131: "resource_",
  132: "vault_",
  137: "template_",
};

/**
 * Render the substate id an event names. The event's first
 * element is the id as an enum, [variant, [tagged address]]:
 * the tag says what kind of substate it is. Anything that
 * does not match that shape renders null, so a malformed
 * event is skipped rather than misread.
 */
export function renderEventSubstate(v: CborValue): string | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const inner = v[1];
  if (!Array.isArray(inner) || inner.length !== 1) return null;
  const tagged = inner[0];
  if (!(tagged instanceof Tagged)) return null;
  const prefix = SUBSTATE_PREFIXES[tagged.tag];
  if (!prefix || !(tagged.value instanceof Uint8Array)) return null;
  return prefix + bytesToHex(tagged.value);
}

/** The component ids among a replay's events, deduplicated,
 * in the order the replay first named them. Vault, resource,
 * and template ids ride along in a template's replay and are
 * not components, so they never become candidates. */
export function componentCandidates(events: StreamEvent[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ev of events) {
    if (!ev.substate.startsWith("component_")) continue;
    if (seen.has(ev.substate)) continue;
    seen.add(ev.substate);
    out.push(ev.substate);
  }
  return out;
}

/**
 * Parse one block of the event stream (the lines between two
 * blank lines) into an event. A block holding only comments
 * is a keepalive and parses to null, as does a block whose
 * data is not the expected JSON envelope or whose event does
 * not decode: one malformed event must never break the
 * replay, it is simply not evidence of anything.
 */
export function parseStreamBlock(block: string): StreamEvent | null {
  let id: number | null = null;
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("id:")) {
      // Event ids are the paging cursor, so they are taken
      // only as plain non-negative integers inside the safe
      // range. Anything else (empty, fractional, or beyond
      // what a number holds exactly) leaves the id unset
      // rather than corrupting the next page's position.
      const raw = line.slice(3).trim();
      if (/^\d+$/.test(raw)) {
        const n = Number(raw);
        if (Number.isSafeInteger(n)) id = n;
      }
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (!dataLines.length) return null;
  let envelope: unknown;
  try {
    envelope = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }
  const encoded = (envelope as { event?: unknown } | null)?.event;
  if (typeof encoded !== "string") return null;
  let decoded: CborValue;
  try {
    decoded = decode(base64ToBytes(encoded));
  } catch {
    return null;
  }
  if (!Array.isArray(decoded) || decoded.length < 3) return null;
  const substate = renderEventSubstate(decoded[0]);
  if (!substate) return null;
  return {
    id,
    substate,
    topic: typeof decoded[2] === "string" ? decoded[2] : "event",
  };
}
