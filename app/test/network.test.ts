import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { App } from "../src/app";
import {
  NETWORKS,
  defaultNetwork,
  templatesConfigured,
  type NetworkConfig,
  type NetworkName,
} from "../src/indexer";

// The landing network rule: a first visit lands on the first
// network with templates configured, mainnet preferred. A saved
// preference always wins over the rule.
const backing = new Map<string, string>();

beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
});

function cfg(partial: Partial<NetworkConfig>): NetworkConfig {
  return {
    name: "mainnet",
    label: "mainnet",
    indexer: "https://example.invalid",
    indexerFallback: null,
    explorer: "https://example.invalid",
    circleTemplate: null,
    tenderTemplate: null,
    circleCodeHash: null,
    tenderCodeHash: null,
    featuredCircle: null,
    ...partial,
  };
}

const LIVE = { circleTemplate: "template_a", tenderTemplate: "template_b" };

function configs(
  mainnet: Partial<NetworkConfig>,
  esmeralda: Partial<NetworkConfig>,
): Record<NetworkName, NetworkConfig> {
  return { mainnet: cfg(mainnet), esmeralda: cfg(esmeralda) };
}

describe("templatesConfigured", () => {
  it("is false while either template address is missing", () => {
    expect(templatesConfigured(cfg({}))).toBe(false);
    expect(templatesConfigured(cfg({ circleTemplate: "template_a" }))).toBe(false);
    expect(templatesConfigured(cfg({ tenderTemplate: "template_b" }))).toBe(false);
  });

  it("is true once both template addresses are set", () => {
    expect(templatesConfigured(cfg(LIVE))).toBe(true);
  });
});

describe("defaultNetwork", () => {
  it("defaults to esmeralda while mainnet has no templates configured", () => {
    expect(defaultNetwork(configs({}, LIVE))).toBe("esmeralda");
  });

  it("defaults to mainnet once mainnet templates are configured", () => {
    expect(defaultNetwork(configs(LIVE, LIVE))).toBe("mainnet");
  });

  it("defaults to mainnet when only mainnet is configured", () => {
    expect(defaultNetwork(configs(LIVE, {}))).toBe("mainnet");
  });

  it("falls back to mainnet when no network is configured", () => {
    expect(defaultNetwork(configs({}, {}))).toBe("mainnet");
  });

  it("reads the live config: esmeralda is the configured network today", () => {
    expect(templatesConfigured(NETWORKS.mainnet)).toBe(false);
    expect(templatesConfigured(NETWORKS.esmeralda)).toBe(true);
    expect(defaultNetwork()).toBe("esmeralda");
  });
});

describe("app first visit", () => {
  it("lands on esmeralda with nothing stored, while mainnet is unconfigured", () => {
    const app = new App();
    expect(app.network).toBe("esmeralda");
    expect(app.indexer.cfg.name).toBe("esmeralda");
  });

  it("keeps a saved mainnet preference even while mainnet is unconfigured", () => {
    backing.set("asiri:network", "mainnet");
    const app = new App();
    expect(app.network).toBe("mainnet");
  });

  it("keeps a saved esmeralda preference", () => {
    backing.set("asiri:network", "esmeralda");
    const app = new App();
    expect(app.network).toBe("esmeralda");
  });

  it("ignores a stored value that is not a network name", () => {
    backing.set("asiri:network", "igor");
    const app = new App();
    expect(app.network).toBe("esmeralda");
  });
});

describe("app first visit with mainnet configured", () => {
  const savedMainnet = { ...NETWORKS.mainnet };

  beforeEach(() => {
    NETWORKS.mainnet.circleTemplate = "template_a";
    NETWORKS.mainnet.tenderTemplate = "template_b";
  });

  afterEach(() => {
    Object.assign(NETWORKS.mainnet, savedMainnet);
  });

  it("lands on mainnet once its templates are configured", () => {
    const app = new App();
    expect(app.network).toBe("mainnet");
    expect(app.indexer.cfg.name).toBe("mainnet");
  });
});
