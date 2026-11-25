// The wallet gate: acting needs a wallet, reading never
// does. An unconnected visitor gets a modal in a real
// browser; in the unit test fake DOM, which has no body and
// no querySelector, the gate simply refuses without
// crashing.
import { describe, expect, it } from "vitest";
import { App } from "../src/app";
import { requireWallet } from "../src/screens/common";

class FakeEl {
  className = "";
  textContent = "";
  disabled = false;
  children: FakeEl[] = [];
  constructor(public tag: string) {}
  append(...nodes: unknown[]): void {
    for (const n of nodes) this.children.push(n as FakeEl);
  }
  addEventListener(): void {}
  remove(): void {}
}

(globalThis as { document?: unknown }).document = {
  createElement: (tag: string) => new FakeEl(tag),
  createTextNode: (text: string) => ({ text }),
};

describe("requireWallet", () => {
  it("lets a connected wallet through, returning its account", () => {
    const app = { wallet: { account: "component_abc" } } as unknown as App;
    expect(requireWallet(app, "create a circle")).toBe("component_abc");
  });

  it("refuses without a wallet, and does not crash without a real DOM", () => {
    const app = { wallet: { account: null } } as unknown as App;
    expect(requireWallet(app, "create a circle")).toBeNull();
  });
});
