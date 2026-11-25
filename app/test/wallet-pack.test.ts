// Batch 3: the wallet correctness pack, fee figures, funding
// guidance, and error banner replacement.
//
// The DOM here is a small fake implementing exactly what the
// app touches: createElement/createTextNode, append, prepend,
// replaceChildren, children, classList, querySelectorAll,
// remove, and text aggregation. Screens render against it the
// same way they render against a browser.
import { beforeEach, describe, expect, it } from "vitest";
import { App, clearErrors, errorBox, tari } from "../src/app";
import { decode, hexToBytes } from "../src/cbor";
import { chainError, feeNote } from "../src/screens/common";
import { renderCreate } from "../src/screens/create";
import { TYPICAL_FEES, feeText, type FeeAction } from "../src/fees";
import { fundingApplies, fundingGuidance } from "../src/funding";
import {
  Wallet,
  looksDeclined,
  networkMatch,
  type TariProvider,
} from "../src/wallet";

class FakeEl {
  className = "";
  value = "";
  rows = 0;
  placeholder = "";
  type = "";
  disabled = false;
  parent: FakeEl | null = null;
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
    for (const n of nodes) {
      const el = this.adopt(n);
      el.parent = this;
      this.children.push(el);
    }
  }
  prepend(...nodes: unknown[]): void {
    for (const n of [...nodes].reverse()) {
      const el = this.adopt(n);
      el.parent = this;
      this.children.unshift(el);
    }
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
  remove(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
  }
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

const ACCOUNT = "component_" + "aa".repeat(32);

class MockProvider implements TariProvider {
  calls: string[] = [];
  polls = 0;
  constructor(private network: string) {}
  async request(args: { method: string }): Promise<unknown> {
    this.calls.push(args.method);
    switch (args.method) {
      case "tari_requestAccounts":
        return [ACCOUNT];
      case "tari_getNetwork":
        return this.network;
      case "tari_createTransactionRequest":
        return { requestId: "req-1" };
      case "tari_getTransactionRequest":
        this.polls++;
        return this.polls < 2
          ? { status: "pending" }
          : { status: "submitted", result: { ok: true } };
      case "tari_submitTransactionRequest":
        return {};
      default:
        throw new Error(`unexpected method ${args.method}`);
    }
  }
}

describe("networkMatch", () => {
  it("matches only an equal, known network", () => {
    expect(networkMatch("esmeralda", "esmeralda")).toBe("match");
    expect(networkMatch("mainnet", "esmeralda")).toBe("mismatch");
    expect(networkMatch("esmeralda", "mainnet")).toBe("mismatch");
  });

  it("never calls an unread network a match", () => {
    expect(networkMatch(null, "esmeralda")).toBe("unknown");
    expect(networkMatch("", "esmeralda")).toBe("unknown");
  });
});

describe("looksDeclined", () => {
  it("recognises the words wallets use for a refusal", () => {
    for (const m of [
      "user rejected the request",
      "User denied transaction signature",
      "the request was declined",
      "cancelled by user",
      "user refused to switch networks",
    ]) {
      expect(looksDeclined(new Error(m))).toBe(true);
    }
  });

  it("does not call other failures a refusal", () => {
    expect(looksDeclined(new Error("the wallet returned no account"))).toBe(false);
    expect(looksDeclined(new Error("connection timed out"))).toBe(false);
  });

  it("does not call a negated refusal a refusal", () => {
    expect(looksDeclined(new Error("connection was not declined"))).toBe(false);
    expect(looksDeclined(new Error("the request was not rejected by the network"))).toBe(false);
    expect(looksDeclined(new Error("the request was not denied"))).toBe(false);
    expect(looksDeclined(new Error("the user did not reject the request"))).toBe(false);
    expect(looksDeclined(new Error("the switch wasn't cancelled by the wallet"))).toBe(false);
  });

  it("trusts the EIP-1193 user rejection code over the wording", () => {
    const err = Object.assign(new Error("something failed"), { code: 4001 });
    expect(looksDeclined(err)).toBe(true);
  });
});

describe("Wallet.refreshNetwork", () => {
  it("re-reads the network from the provider", async () => {
    (globalThis as { window?: unknown }).window = {
      tari: new MockProvider("mainnet"),
    };
    const w = new Wallet();
    w.network = "esmeralda";
    expect(await w.refreshNetwork()).toBe("mainnet");
    expect(w.network).toBe("mainnet");
  });

  it("reports unverified when the read fails, keeping the recorded network", async () => {
    const failing: TariProvider = {
      async request() {
        throw new Error("provider gone");
      },
    };
    (globalThis as { window?: unknown }).window = { tari: failing };
    const w = new Wallet();
    w.network = "esmeralda";
    expect(await w.refreshNetwork()).toBeNull();
    expect(w.network).toBe("esmeralda");
  });

  it("reports unverified when the read returns no usable value", async () => {
    const empty: TariProvider = {
      async request() {
        return null;
      },
    };
    (globalThis as { window?: unknown }).window = { tari: empty };
    const w = new Wallet();
    w.network = "esmeralda";
    expect(await w.refreshNetwork()).toBeNull();
  });

  it("reports unverified when the read returns only whitespace", async () => {
    const blank: TariProvider = {
      async request() {
        return "   ";
      },
    };
    (globalThis as { window?: unknown }).window = { tari: blank };
    const w = new Wallet();
    w.network = "esmeralda";
    expect(await w.refreshNetwork()).toBeNull();
    expect(w.network).toBe("esmeralda");
  });
});

describe("the submit-time network guard", () => {
  it("stops a submit on a mismatched wallet network, before any transaction is created", async () => {
    const mock = new MockProvider("mainnet");
    (globalThis as { window?: unknown }).window = { tari: mock };
    backing.set("asiri:network", "esmeralda");
    const app = new App();
    await app.wallet.connect();
    await expect(
      app.submitAction([
        { CallFunction: { address: "template_x", function: "new", args: [] } },
      ]),
    ).rejects.toThrow(/Your wallet is on mainnet, but the app is set to Esmeralda testnet/);
    expect(mock.calls).not.toContain("tari_createTransactionRequest");
  });

  it("stops a submit when the wallet's network cannot be re-read, instead of trusting the connect-time record", async () => {
    class FlakyProvider extends MockProvider {
      private reads = 0;
      override async request(args: { method: string }): Promise<unknown> {
        if (args.method === "tari_getNetwork") {
          this.reads++;
          if (this.reads > 1) throw new Error("provider stopped answering");
        }
        return super.request(args);
      }
    }
    const mock = new FlakyProvider("esmeralda");
    (globalThis as { window?: unknown }).window = { tari: mock };
    const app = new App();
    await app.wallet.connect();
    await expect(
      app.submitAction([
        { CallFunction: { address: "template_x", function: "new", args: [] } },
      ]),
    ).rejects.toThrow(/Your wallet's network could not be checked/);
    expect(mock.calls).not.toContain("tari_createTransactionRequest");
  });

  it("lets a submit proceed when the networks match", async () => {
    const mock = new MockProvider("esmeralda");
    (globalThis as { window?: unknown }).window = { tari: mock };
    backing.set("asiri:network", "esmeralda");
    const app = new App();
    await app.wallet.connect();
    await expect(app.guardWalletNetwork()).resolves.toBeUndefined();
  });

  it("does nothing before a wallet connects", async () => {
    const app = new App();
    await expect(app.guardWalletNetwork()).resolves.toBeUndefined();
  });
});

// The operator account and vault substates, the same live
// recordings account.test.ts decodes. The second vault differs
// only in its amount integer: 1,000,000 in place of 15,706,773.
const ACCOUNT_SUBSTATE =
  "8200818285582000000000000000000000000000000000000000000000000000000000000000008202815820a47e904bc63ebb9a22da57b4f59ad2cf1c299e972c0180de3235d577b4a64308" +
  "82a568617070726f76616c616e6365820080676465706f7369748200806c6765745f62616c616e6365738200807177697468647261775f617070726f766564820080820180417c8200808182a1d8835820" +
  "0101010101010101010101010101010101010101010101010101010101010101d88458207c66628b5547283e5cbe82d155c515972a3c2d13d2251d317bbb84aed7a9a344a0";
const OPERATOR_VAULT =
  "vault_7c66628b5547283e5cbe82d155c515972a3c2d13d2251d317bbb84aed7a9a344";
const VAULT_1 =
  "82028182820383d883582001010101010101010101010101010101010101010101010101010101010101011a00efaa950000";
const VAULT_2 =
  "82028182820383d883582001010101010101010101010101010101010101010101010101010101010101011a000f42400000";

describe("balance refresh and disconnect", () => {
  function stubReads(app: App, vaultHex: () => string): void {
    const accountRoot = decode(hexToBytes(ACCOUNT_SUBSTATE));
    app.indexer.substate = async (id: string) => {
      if (id === ACCOUNT) return { version: 0, value: accountRoot };
      if (id === OPERATOR_VAULT)
        return { version: 0, value: decode(hexToBytes(vaultHex())) };
      return null;
    };
  }

  it("re-derives the balance after a completed action", async () => {
    (globalThis as { window?: unknown }).window = {
      tari: new MockProvider("esmeralda"),
    };
    backing.set("asiri:network", "esmeralda");
    const app = new App();
    await app.wallet.connect();
    let vault = VAULT_1;
    stubReads(app, () => vault);
    await app.deriveIdentity();
    expect(app.balance).toBe(15_706_773n);
    vault = VAULT_2;
    const { outcome } = await app.submitAction([
      { CallFunction: { address: "template_x", function: "new", args: [] } },
    ]);
    expect(outcome.kind).toBe("unconfirmed");
    expect(app.balance).toBe(1_000_000n);
  });

  it("disconnect clears the account and everything derived from it", async () => {
    (globalThis as { window?: unknown }).window = {
      tari: new MockProvider("esmeralda"),
    };
    const app = new App();
    await app.wallet.connect();
    stubReads(app, () => VAULT_1);
    await app.deriveIdentity();
    expect(app.myKey).not.toBeNull();
    expect(app.balance).toBe(15_706_773n);
    app.disconnect();
    expect(app.wallet.account).toBeNull();
    expect(app.wallet.network).toBeNull();
    expect(app.balance).toBeNull();
    expect(app.myKey).toBeNull();
    expect(backing.get("asiri:mykey")).toBeUndefined();
  });
});

describe("fee figures", () => {
  // The measured season figures behind each typical, from
  // EVIDENCE.md: (lowest, highest) actually paid per action.
  const MEASURED: Record<FeeAction, [number, number]> = {
    createCircle: [3546, 3546],
    createTender: [4588, 5198],
    registerTender: [5420, 6395],
    lockAndFund: [2004, 5207],
    commitBid: [3113, 6231],
    proposeWithdrawal: [4045, 4045],
    proposeTenderApproverChange: [4456, 4456],
    approveTenderApproverChange: [4495, 4568],
    proposeOverride: [4665, 4665],
    signOverride: [2896, 5029],
    revealBid: [4714, 4808],
    closeReveal: [4709, 4910],
    advanceDelivery: [4760, 5012],
    confirmDelivery: [4821, 5177],
    claimDispute: [4929, 4929],
    resolveDispute: [4756, 5211],
    claimPayment: [4703, 5983],
    claimReceipt: [8322, 8668],
    claimBond: [4985, 5947],
    collectRefund: [5753, 6713],
    collectForfeits: [3712, 3825],
    expire: [4333, 4333],
  };

  it("gives every fee-bearing action a figure at its measured range, rounded to the nearest hundred", () => {
    for (const [action, [lo, hi]] of Object.entries(MEASURED)) {
      const typical = TYPICAL_FEES[action as FeeAction];
      expect(typical).toBeGreaterThanOrEqual(BigInt(lo) - 50n);
      expect(typical).toBeLessThanOrEqual(BigInt(hi) + 50n);
    }
    expect(Object.keys(TYPICAL_FEES).sort()).toEqual(
      Object.keys(MEASURED).sort(),
    );
  });

  it("labels the figure typical and points at the wallet for the exact cost", () => {
    for (const action of Object.keys(MEASURED) as FeeAction[]) {
      const text = feeText(action);
      expect(text).toContain(`Typical fee about ${tari(TYPICAL_FEES[action])} tari`);
      expect(text).toContain("The wallet shows the exact cost before you approve");
    }
  });

  it("renders as a note element carrying the figure", () => {
    const note = feeNote("claimReceipt") as unknown as FakeEl;
    expect(note.textContent).toContain("Typical fee about 0.0085 tari");
  });
});

describe("funding guidance", () => {
  it("esmeralda: the faucet is unreliable and pilot funding is on request", () => {
    const text = fundingGuidance("esmeralda");
    expect(text).toContain("faucet has been unreliable");
    expect(text).toContain("funded on request");
    expect(text).toContain("reply to the invitation");
  });

  it("mainnet: tari comes only from burning xtm one for one, with no other source promised", () => {
    const text = fundingGuidance("mainnet");
    expect(text).toContain("burning xtm");
    expect(text).toContain("one for one");
    expect(text).toContain("There is no faucet and no other source");
  });

  it("applies to a zero balance only", () => {
    expect(fundingApplies(0n)).toBe(true);
    expect(fundingApplies(1n)).toBe(false);
    expect(fundingApplies(null)).toBe(false);
  });

  it("renders on the create screen, where a new user meets the costs", async () => {
    backing.set("asiri:network", "esmeralda");
    const app = new App();
    const root = new FakeEl("div");
    await renderCreate(app, root as unknown as HTMLElement, () => {});
    expect(root.textContent).toContain("Costs, in plain words");
    expect(root.textContent).toContain(fundingGuidance("esmeralda"));
  });
});

describe("error banner replacement", () => {
  it("a second error replaces the first instead of stacking", () => {
    const root = new FakeEl("div");
    errorBox(root as unknown as HTMLElement, new Error("first failure"));
    errorBox(root as unknown as HTMLElement, new Error("second failure"));
    const errs = root.querySelectorAll(".err");
    expect(errs).toHaveLength(1);
    expect(errs[0].textContent).toBe("second failure");
  });

  it("a chain failure replaces a plain error, and the other way round", () => {
    const app = new App();
    const root = new FakeEl("div");
    errorBox(root as unknown as HTMLElement, new Error("plain failure"));
    chainError(app, root as unknown as HTMLElement, {
      kind: "failed",
      txId: null,
      reason: "no forfeits for the circle",
    });
    let errs = root.querySelectorAll(".err");
    expect(errs).toHaveLength(1);
    expect(errs[0].textContent).toContain("no forfeits for the circle");
    errorBox(root as unknown as HTMLElement, new Error("latest failure"));
    errs = root.querySelectorAll(".err");
    expect(errs).toHaveLength(1);
    expect(errs[0].textContent).toBe("latest failure");
  });

  it("clearErrors leaves other content alone", () => {
    const root = new FakeEl("div");
    const keep = new FakeEl("div");
    keep.textContent = "keep me";
    root.append(keep);
    errorBox(root as unknown as HTMLElement, new Error("gone soon"));
    clearErrors(root as unknown as HTMLElement);
    expect(root.querySelectorAll(".err")).toHaveLength(0);
    expect(root.textContent).toContain("keep me");
  });
});
