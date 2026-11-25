// The landing page at its full Section 15A scope: the three
// part pill nav, the hero and its seal, the letter grid, the
// seven steps, the rig panel answered from the record, the
// questions, the manifesto stat card, and the blue footer.
// The DOM here is the same small fake as copy-gating.test.ts;
// indexer reads are stubbed, so these tests cover what
// renders and what the rig answers quote, not the network.
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/app";
import {
  MAINNET_ATTACK_OVERRIDE,
  MAINNET_ATTACK_RECORD,
  MAINNET_ATTACKS,
} from "../src/mainnet-attack-data";
import { MAINNET_TENDER_RECORDS } from "../src/mainnet-results-data";
import { LEDGER } from "../src/proof-data";
import {
  mainnetProofFacts,
  renderLanding,
  rigAnswer,
} from "../src/screens/landing";

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

async function render(): Promise<FakeEl> {
  const app = new App();
  app.indexer.substate = async () => null;
  const r = root();
  await renderLanding(app, r, go);
  return r as unknown as FakeEl;
}

describe("landing at full Section 15A scope", () => {
  it("opens with the three part nav: network pill, link pill, sign in pill", async () => {
    const r = await render();
    const verpill = r.querySelectorAll(".verpill");
    expect(verpill).toHaveLength(1);
    expect(verpill[0].textContent).toContain("mainnet");
    const signin = r.querySelectorAll(".signin");
    expect(signin).toHaveLength(1);
    expect(signin[0].textContent).toContain("open the app");
    expect(signin[0].textContent).toContain("asiri");
    const text = r.textContent;
    for (const link of ["Tenders", "How it works", "Questions", "The proof"]) {
      expect(text).toContain(link);
    }
  });

  it("hero states the mechanism and the proof, with the seal", async () => {
    const r = await render();
    const text = r.textContent;
    expect(text).toContain("Everyone says their tender is fair");
    expect(text).toContain("the proof.");
    expect(text).toContain("the template awards the lowest valid revealed price");
    expect(text).toContain("even the buyer cannot peek");
    for (const chip of [
      "rules locked",
      "budget escrowed",
      "bids sealed as hashes",
      "opened only by their owners",
    ]) {
      expect(text).toContain(chip);
    }
  });

  it("carries the mainnet proof strip in the hero, figures from the record data", async () => {
    const r = await render();
    const strips = r.querySelectorAll(".proofstrip");
    expect(strips).toHaveLength(1);
    // Every figure the strip prints is recomputed here
    // from the same data modules, so the test fails if the
    // strip ever drifts from the record.
    const records = [...MAINNET_TENDER_RECORDS, MAINNET_ATTACK_RECORD];
    const total = records.reduce((s, t) => s + t.standaloneTotal, 0);
    const passed = records.reduce((s, t) => s + t.standalonePass, 0);
    const facts = mainnetProofFacts();
    expect(facts.tenders).toBe(records.length);
    expect(facts.attacksRefused).toBe(MAINNET_ATTACKS.length);
    expect(facts.checks).toEqual({ passed, total });
    const text = strips[0].textContent;
    expect(text).toContain(`${records.length}`);
    expect(text).toContain("tenders run on mainnet");
    expect(text).toContain(`${passed} of ${total}`);
    expect(text).toContain("checks passed by two verifiers");
    expect(text).toContain(`${MAINNET_ATTACKS.length}`);
    expect(text).toContain("attacks refused by the chain");
    const links = strips[0].querySelectorAll(".ps-link");
    expect(links).toHaveLength(1);
    expect((links[0] as unknown as { href: string }).href).toBe(
      "#/app/results",
    );
  });

  it("spells A-S-I-R-I in the letter grid, one mechanism per letter", async () => {
    const r = await render();
    const letters = r.querySelectorAll(".L").map((e) => e.textContent);
    expect(letters).toEqual(["A", "S", "I", "R", "I"]);
    const text = r.textContent;
    for (const head of [
      "award by template",
      "sealed bids",
      "immutable rules",
      "reveal to win",
      "inspect everything",
    ]) {
      expect(text).toContain(head);
    }
  });

  it("runs the seven steps in order, each linked to its screen", async () => {
    const r = await render();
    const steps = r.querySelectorAll(".lstep");
    expect(steps).toHaveLength(7);
    const titles = steps.map((s) => s.textContent);
    expect(titles[0]).toContain("Form a circle");
    expect(titles[1]).toContain("Lock the rules and the budget");
    expect(titles[2]).toContain("Sellers commit sealed bids");
    expect(titles[3]).toContain("Bids open only on reveal");
    expect(titles[4]).toContain("The lowest revealed bid wins");
    expect(titles[5]).toContain("Delivery is confirmed");
    expect(titles[6]).toContain("Then the winner is paid");
    // Each step links to the screen where that step is done
    // or proven, in the app's own route order.
    const hrefs = r
      .querySelectorAll(".step-link")
      .map((a) => (a as unknown as { href: string }).href);
    expect(hrefs).toEqual([
      "#/app/create",
      "#/app/create",
      "#/app/seller",
      "#/app/seller",
      "#/app/results",
      "#/app/approvals",
      "#/app/results",
    ]);
  });

  it("answers the rig attacks with the live mainnet attack record", () => {
    const byKey = new Map(MAINNET_ATTACKS.map((a) => [a.key, a]));
    const friend = rigAnswer("friend");
    const joined = friend.rejected.join(" ");
    expect(joined).toContain(
      byKey.get("override-zero-rationale")!.rejection,
    );
    expect(joined).toContain(byKey.get("override-zero-rationale")!.tx);
    expect(joined).toContain(
      byKey.get("override-unrevealed")!.rejection,
    );
    expect(joined).toContain(MAINNET_ATTACK_OVERRIDE.proposeTx);
    expect(joined).toContain(MAINNET_ATTACK_OVERRIDE.signTx);
    expect(joined).toContain("no award method to call");
    expect(friend.source).toContain("live on mainnet");
    const money = rigAnswer("money");
    const mJoined = money.rejected.join(" ");
    for (const k of [
      "claim-payment-loser",
      "claim-bond-nonbidder",
      "claim-payment-twice",
      "release-refund-direct",
    ]) {
      expect(mJoined).toContain(byKey.get(k)!.rejection);
      expect(mJoined).toContain(byKey.get(k)!.tx);
    }
    expect(money.source).toContain("live on mainnet");
  });

  it("answers the construction attacks, with the live record behind them", () => {
    const peek = rigAnswer("peek");
    expect(peek.rejected.join(" ")).toContain("there is no method to call");
    expect(peek.rejected.join(" ")).toContain("stayed sealed");
    expect(peek.source).toContain("by construction");
    // Peeking still quotes no transaction: there is no
    // attempt to quote, only the unrevealed bid's outcome.
    expect(peek.call + peek.rejected.join(" ") + peek.source).not.toMatch(
      /transaction [0-9a-f]{64}/,
    );
    const rules = rigAnswer("rules");
    expect(rules.rejected.join(" ")).toContain("no setter on a locked tender");
    const upd = MAINNET_ATTACKS.find((a) => a.key === "update-rules")!;
    expect(rules.rejected.join(" ")).toContain(upd.rejection);
    expect(rules.rejected.join(" ")).toContain(upd.tx);
    expect(rules.source).toContain("refused live on mainnet");
  });

  it("carries a mobile menu: ASIRI logo and a hamburger, with the nav parts inside the menu", async () => {
    const r = await render();
    const logo = r.querySelectorAll(".lp-logo");
    expect(logo).toHaveLength(1);
    expect(logo[0].textContent).toBe("ASIRI");
    const burger = r.querySelectorAll(".lp-burger");
    expect(burger).toHaveLength(1);
    const menu = r.querySelectorAll(".lp-menu");
    expect(menu).toHaveLength(1);
    // The three desktop nav parts live inside the menu, so the
    // mobile dropdown shows the same links and the same open
    // the app action, not a copy of them.
    const menuText = menu[0].textContent;
    expect(menuText).toContain("mainnet");
    for (const link of ["Tenders", "How it works", "Questions", "The proof"]) {
      expect(menuText).toContain(link);
    }
    expect(menuText).toContain("open the app");
  });

  it("renders the rig console pre-filled with the first attack's answer, with all four attack buttons", async () => {
    const r = await render();
    const text = r.textContent;
    // The console opens on the peek answer, not empty: the
    // visitor sees what the chain does to a rig attempt
    // without clicking anything.
    expect(text).toContain("read the price inside a sealed commitment");
    expect(text).toContain("there is no method to call");
    expect(text).toContain("the tender is untouched.");
    expect(text).not.toContain("waiting for an attack…");
    for (const label of [
      "peek at the sealed bids",
      "change the budget after bids",
      "award my friend instead",
      "move the escrow to my wallet",
    ]) {
      expect(text).toContain(label);
    }
  });

  it("carries the stat card number from the ledger data itself", async () => {
    const r = await render();
    const stat = r.querySelectorAll(".statcard");
    expect(stat).toHaveLength(1);
    expect(LEDGER.totals.operatorPaid).toBe(0);
    expect(stat[0].textContent).toContain("0 tari");
    expect(stat[0].textContent).toContain(
      `across all ${LEDGER.rows.length} evidence tenders`,
    );
  });

  it("closes with the blue footer: brand, three link columns, credits", async () => {
    const r = await render();
    const text = r.textContent;
    expect(text).toContain("asiri means a secret that stays kept");
    for (const col of ["Product", "Verify", "The app"]) {
      expect(text).toContain(col);
    }
    expect(text).toContain("asiri, a sealed tender protocol.");
    expect(text).toContain(
      "every figure on this page is read from the chain or recomputed from its record",
    );
    // No newsletter surface: no mailing list exists, and the
    // footer must not pretend one does.
    expect(text).not.toContain("launch notes");
    expect(text).not.toContain("subscribe");
  });

  it("keeps every claim inside the boundary", async () => {
    const r = await render();
    const text = r.textContent;
    expect(text).toContain("lowest valid revealed price");
    expect(text).not.toContain("burned");
    expect(text).not.toContain("guarantee");
    expect(text).not.toContain("lowest bid wins");
  });
});
