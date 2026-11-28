// The transaction status modal: every stage must say the
// right thing, spin only while waiting, and close itself
// only on a success, never on a failure.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app";
import type { TxStage } from "../src/app";
import { TxModal } from "../src/txmodal";

class FakeElement {
  tagName: string;
  className = "";
  textContent = "";
  hidden = false;
  href = "";
  target = "";
  rel = "";
  children: FakeElement[] = [];
  private handlers: Record<string, (() => void)[]> = {};
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
  prepend(...nodes: FakeElement[]): void {
    this.children.unshift(...nodes);
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.children = [...nodes];
  }
  addEventListener(kind: string, fn: () => void): void {
    (this.handlers[kind] ??= []).push(fn);
  }
  setAttribute(_name: string, _value: string): void {
    /* the modal only marks the card's role */
  }
  click(): void {
    this.handlers.click?.forEach((fn) => fn());
  }
}

const body = new FakeElement("body");

(globalThis as { document?: unknown }).document = {
  createElement: (tag: string) => new FakeElement(tag),
  createTextNode: (text: string) => {
    const n = new FakeElement("#text");
    n.textContent = text;
    return n;
  },
  body,
};

const fakeApp = () =>
  ({
    indexer: { explorerTx: (id: string) => `https://explorer.example/tx/${id}` },
  }) as unknown as App;

function find(modal: TxModal, cls: string): FakeElement {
  const overlay = (modal as unknown as { overlay: FakeElement }).overlay;
  const stack: FakeElement[] = [overlay];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.className.split(" ").includes(cls)) return n;
    stack.push(...n.children);
  }
  throw new Error(`no .${cls} in the modal`);
}

describe("TxModal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    body.children = [];
  });

  it("spins while waiting for the wallet, with no close button", () => {
    const modal = new TxModal();
    const app = fakeApp();
    modal.show(app, { stage: "wallet" });
    expect(find(modal, "tx-overlay").hidden).toBe(false);
    expect(find(modal, "tx-spin").hidden).toBe(false);
    expect(find(modal, "tx-title").textContent).toBe("Waiting for your wallet");
    expect(find(modal, "tx-msg").textContent).toContain("Approve the transaction");
    expect(find(modal, "tx-close").hidden).toBe(true);
  });

  it("spins while waiting for the chain, with the time it usually takes", () => {
    const modal = new TxModal();
    modal.show(fakeApp(), { stage: "confirming" });
    expect(find(modal, "tx-spin").hidden).toBe(false);
    expect(find(modal, "tx-title").textContent).toBe("Waiting for the chain");
    expect(find(modal, "tx-msg").textContent).toContain("under a minute");
  });

  it("stops spinning on confirmation, links the transaction, and closes itself", () => {
    const modal = new TxModal();
    modal.show(fakeApp(), { stage: "confirmed", txId: "aa".repeat(32) });
    expect(find(modal, "tx-spin").hidden).toBe(true);
    expect(find(modal, "tx-title").textContent).toBe("Confirmed on chain.");
    expect(find(modal, "tx-close").hidden).toBe(false);
    const link = find(modal, "tx-link");
    expect(link.children).toHaveLength(1);
    expect(link.children[0].href).toContain("aa".repeat(32));
    vi.advanceTimersByTime(5000);
    expect(find(modal, "tx-overlay").hidden).toBe(true);
  });

  it("stays open on a chain failure until the visitor closes it", () => {
    const modal = new TxModal();
    const detail: TxStage = {
      stage: "failed",
      txId: "bb".repeat(32),
      reason: "no forfeits for the circle",
    };
    modal.show(fakeApp(), detail);
    expect(find(modal, "tx-title").textContent).toBe("This transaction failed on chain.");
    expect(find(modal, "tx-msg").textContent).toBe("no forfeits for the circle");
    vi.advanceTimersByTime(60000);
    expect(find(modal, "tx-overlay").hidden).toBe(false);
    find(modal, "tx-close").click();
    expect(find(modal, "tx-overlay").hidden).toBe(true);
  });

  it("stays open on a wallet error until the visitor closes it", () => {
    const modal = new TxModal();
    modal.show(fakeApp(), {
      stage: "error",
      message: "You declined the transaction in your wallet.",
    });
    expect(find(modal, "tx-title").textContent).toBe("Nothing was submitted.");
    expect(find(modal, "tx-msg").textContent).toContain("declined");
    vi.advanceTimersByTime(60000);
    expect(find(modal, "tx-overlay").hidden).toBe(false);
  });
});
