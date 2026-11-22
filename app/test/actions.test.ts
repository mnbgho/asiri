// The shared action button: a handler that fails must hand
// its error to the screen's error handler instead of dying as
// an unhandled rejection with the button silently re-enabling.
// The DOM here is the smallest stub the button touches:
// createElement, className, textContent, disabled, and a
// click listener.
import { describe, expect, it } from "vitest";
import { actionButton } from "../src/screens/common";

class FakeButton {
  className = "";
  textContent = "";
  disabled = false;
  private clickHandler: (() => void) | null = null;
  addEventListener(kind: string, fn: () => void): void {
    if (kind === "click") this.clickHandler = fn;
  }
  click(): void {
    this.clickHandler?.();
  }
}

(globalThis as { document?: unknown }).document = {
  createElement: () => new FakeButton(),
  createTextNode: (text: string) => ({ text }),
};

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

describe("actionButton error routing", () => {
  it("hands an async handler's failure to the error handler", async () => {
    const seen: unknown[] = [];
    const btn = actionButton(
      "do it",
      "btn-blue",
      async () => {
        throw new Error("connect your wallet first");
      },
      (e) => seen.push(e),
    ) as unknown as FakeButton;
    btn.click();
    await flush();
    expect(seen).toHaveLength(1);
    expect((seen[0] as Error).message).toBe("connect your wallet first");
    expect(btn.disabled).toBe(false);
  });

  it("hands a sync handler's failure to the error handler", async () => {
    const seen: unknown[] = [];
    const btn = actionButton(
      "save",
      "btn-white",
      () => {
        throw new Error("that is not 64 hex characters");
      },
      (e) => seen.push(e),
    ) as unknown as FakeButton;
    btn.click();
    await flush();
    expect(seen).toHaveLength(1);
    expect((seen[0] as Error).message).toBe("that is not 64 hex characters");
    expect(btn.disabled).toBe(false);
  });

  it("does not call the error handler when the action succeeds", async () => {
    const seen: unknown[] = [];
    let ran = false;
    const btn = actionButton(
      "fine",
      "btn-blue",
      async () => {
        ran = true;
      },
      (e) => seen.push(e),
    ) as unknown as FakeButton;
    btn.click();
    await flush();
    expect(ran).toBe(true);
    expect(seen).toHaveLength(0);
    expect(btn.disabled).toBe(false);
  });
});
