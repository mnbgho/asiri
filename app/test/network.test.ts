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

  it("reads the live config: both networks are configured today", () => {
    expect(templatesConfigured(NETWORKS.mainnet)).toBe(true);
    expect(templatesConfigured(NETWORKS.esmeralda)).toBe(true);
    expect(defaultNetwork()).toBe("mainnet");
  });

  it("pins the published mainnet values", () => {
    expect(NETWORKS.mainnet.circleTemplate).toBe(
      "template_b86a46241753b8b8e4c2e9571c0db727925d77e1274009175e4f0b0e18cf466b",
    );
    expect(NETWORKS.mainnet.tenderTemplate).toBe(
      "template_267d1d73da73ec990e8711e492bccb9112076051d396922bdef2b9d667c684eb",
    );
    expect(NETWORKS.mainnet.circleCodeHash).toBe(
      "72c9bb84c7e77b2cdc724a5619aed6dd5c5be71d1bea9eb685b2bab5e0d4609c",
    );
    expect(NETWORKS.mainnet.tenderCodeHash).toBe(
      "ff672fdced3cccd2c7c7649b4b6107322872ff83d2a347c8a1a30a5461f531e9",
    );
    expect(NETWORKS.mainnet.featuredCircle).toBe(
      "component_46237d52379c5d9289814c67ca840f5fa2aad2b12ed2291acf0e74a5091aca71",
    );
    expect(NETWORKS.mainnet.indexer).toBe("https://indexer-a.ootle.tari.com");
  });
});

describe("app first visit", () => {
  it("lands on mainnet with nothing stored, now that mainnet is configured", () => {
    const app = new App();
    expect(app.network).toBe("mainnet");
    expect(app.indexer.cfg.name).toBe("mainnet");
  });

  it("keeps a saved esmeralda preference", () => {
    backing.set("asiri:network", "esmeralda");
    const app = new App();
    expect(app.network).toBe("esmeralda");
  });
});

// While mainnet is unconfigured the default is esmeralda, so a
// saved mainnet preference and a garbage stored value can each
// be told apart from the default: that is what gives the two
// preference tests below their teeth, which they cannot have
// against the shipped config where mainnet is the default.
describe("app first visit while mainnet is unconfigured", () => {
  const savedMainnet = { ...NETWORKS.mainnet };

  beforeEach(() => {
    NETWORKS.mainnet.circleTemplate = null;
    NETWORKS.mainnet.tenderTemplate = null;
  });

  afterEach(() => {
    Object.assign(NETWORKS.mainnet, savedMainnet);
  });

  it("lands on esmeralda with nothing stored", () => {
    const app = new App();
    expect(app.network).toBe("esmeralda");
    expect(app.indexer.cfg.name).toBe("esmeralda");
  });

  it("keeps a saved mainnet preference even while mainnet is unconfigured", () => {
    backing.set("asiri:network", "mainnet");
    const app = new App();
    expect(app.network).toBe("mainnet");
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
