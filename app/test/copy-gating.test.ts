// Copy and gating renders: the truthful network pill, the
// builder-run labels and the bond expiry exception on the
// landing, the watched-scope note on the approvals screen,
// and the create screen's forms staying hidden on an
// unconfigured network.
//
// The DOM here is a small fake implementing exactly what the
// screens touch, as in wallet-pack.test.ts. Indexer reads are
// stubbed on the App instance: these tests cover what renders,
// not the network.
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app";
import { INBOX_SCOPE_NOTE } from "../src/inbox";
import { NETWORKS, networkPill } from "../src/indexer";
import { renderApprovals } from "../src/screens/approvals";
import { renderCreate } from "../src/screens/create";
import { renderLanding } from "../src/screens/landing";

class FakeEl {
  className = "";
  value = "";
  rows = 0;
  placeholder = "";
  type = "";
  disabled = false;
  href = "";
  id = "";
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

const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
});

const go = () => {};
const root = () => new FakeEl("div") as unknown as HTMLElement;

describe("networkPill", () => {
  it("calls a configured network live and an unconfigured one unpublished", () => {
    expect(networkPill(NETWORKS.esmeralda)).toBe("esmeralda testnet · live");
    expect(networkPill(NETWORKS.mainnet)).toBe(
      "mainnet · templates not published yet",
    );
  });
});

describe("landing copy", () => {
  it("labels the featured circle's tenders as builder-run, never as live tenders", async () => {
    const app = new App();
    app.indexer.substate = async () => null;
    const r = root();
    await renderLanding(app, r, go);
    const text = (r as unknown as FakeEl).textContent;
    expect(text).toContain("tenders from the featured circle");
    expect(text).toContain(
      "builder-run: run by the builders across their own accounts",
    );
    expect(text).not.toContain("live tenders");
  });

  it("carries the expiry exception in the bond copy", async () => {
    const app = new App();
    app.indexer.substate = async () => null;
    const r = root();
    await renderLanding(app, r, go);
    const text = (r as unknown as FakeEl).textContent;
    expect(text).toContain("half to the circle, half locked forever");
    expect(text).toContain(
      "if the tender instead expires with no award, an unrevealed bond comes back whole",
    );
  });
});

describe("create screen on an unconfigured network", () => {
  it("shows the notices and the switch, and no forms", async () => {
    const app = new App();
    app.setNetwork("mainnet");
    const r = root();
    await renderCreate(app, r, go);
    const text = (r as unknown as FakeEl).textContent;
    expect(text).toContain("not published on mainnet yet");
    expect(text).toContain("switch to the esmeralda testnet");
    // Neither form renders under its notice.
    expect(text).not.toContain("circle name");
    expect(text).not.toContain("approval threshold");
    expect(text).not.toContain("budget cap (tari)");
    expect(text).not.toContain("create tender, register it, and lock the escrow");
  });
});

describe("create screen on esmeralda", () => {
  it("renders both forms, the known-circle picker, and the corrected bond hint", async () => {
    const app = new App();
    app.indexer.substate = async () => {
      throw new Error("stubbed read");
    };
    const r = root();
    await renderCreate(app, r, go);
    const text = (r as unknown as FakeEl).textContent;
    expect(text).toContain("circle name");
    expect(text).toContain("budget cap (tari)");
    expect(text).toContain("circle, from this browser");
    expect(text).toContain(
      "if the tender expires with no award, an unrevealed bond returns whole instead",
    );
  });
});

describe("approvals screen", () => {
  it("carries the inbox and its watched-scope note", async () => {
    const app = new App();
    app.indexer.substate = async () => null;
    app.indexer.epoch = async () => 0;
    const r = root();
    await renderApprovals(app, r, go);
    const text = (r as unknown as FakeEl).textContent;
    expect(text).toContain("needs you now");
    expect(text).toContain(INBOX_SCOPE_NOTE);
    expect(text).toContain("waiting for you");
  });
});
