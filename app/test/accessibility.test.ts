// Accessibility baseline checks: form labels are associated
// with their inputs, error and status regions are announced,
// the verifier's three states are told apart by glyph and
// words and never by colour alone, keyboard focus has a
// visible style in the palette, and the heading levels do not
// skip. The DOM here is a small fake implementing exactly what
// the screens touch, as in help.test.ts, extended with the
// attribute surface the accessibility work sets.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { App, errorBox } from "../src/app";
import { chainError, field, textInput } from "../src/screens/common";
import { checkRowEl, renderVerify } from "../src/screens/verify";

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

const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
});

function walkAll(root: FakeEl, out: FakeEl[] = []): FakeEl[] {
  for (const c of root.children) {
    out.push(c);
    walkAll(c, out);
  }
  return out;
}
const root = () => new FakeEl("div");

describe("labels", () => {
  it("associates every field label with its input, with a unique id", () => {
    const a = textInput();
    const b = textInput("mono");
    const fa = field("amount", a) as unknown as FakeEl;
    const fb = field("destination", b) as unknown as FakeEl;
    const labelOf = (f: FakeEl) => f.children.find((c) => c.tag === "label")!;
    expect(a.id).not.toBe("");
    expect(b.id).not.toBe("");
    expect(a.id).not.toBe(b.id);
    expect(labelOf(fa).htmlFor).toBe(a.id);
    expect(labelOf(fb).htmlFor).toBe(b.id);
    expect(labelOf(fa).textContent).toBe("amount");
  });

  it("keeps an id the input already carries", () => {
    const input = textInput();
    input.id = "given-id";
    field("amount", input);
    expect(input.id).toBe("given-id");
  });

  it("labels the verify screen's fields through the same helper", async () => {
    const app = new App();
    const r = root();
    await renderVerify(app, r as unknown as HTMLElement);
    const all = walkAll(r);
    const labels = all.filter((c) => c.tag === "label");
    const inputs = all.filter((c) => ["input", "textarea", "select"].includes(c.tag));
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(inputs.length).toBe(labels.length);
    for (const lab of labels) {
      expect(lab.htmlFor).not.toBe("");
      expect(inputs.some((i) => i.id === lab.htmlFor)).toBe(true);
    }
  });
});

describe("announced regions", () => {
  it("marks the error box as an alert", () => {
    const r = root();
    errorBox(r as unknown as HTMLElement, new Error("it broke"));
    const err = r.children.find((c) => c.classList.contains("err"))!;
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toBe("it broke");
  });

  it("marks a chain failure as an alert", () => {
    const app = new App();
    const r = root();
    chainError(app, r as unknown as HTMLElement, {
      kind: "failed",
      txId: null,
      reason: "the window has closed",
    });
    const err = r.children.find((c) => c.classList.contains("err"))!;
    expect(err.getAttribute("role")).toBe("alert");
  });

  it("gives the verify results region a live politeness", async () => {
    const app = new App();
    const r = root();
    await renderVerify(app, r as unknown as HTMLElement);
    const live = walkAll(r).find((c) => c.getAttribute("aria-live") === "polite");
    expect(live).toBeDefined();
  });
});

describe("verifier states are not colour alone", () => {
  it("gives pass, fail, and could not be read distinct glyphs and words", () => {
    const pass = checkRowEl({ check: "c1", ok: true, detail: "fine" }) as unknown as FakeEl;
    const fail = checkRowEl({ check: "c2", ok: false, detail: "wrong" }) as unknown as FakeEl;
    const unknown = checkRowEl({ check: "c3", ok: null, detail: "unread" }) as unknown as FakeEl;
    const tick = (r: FakeEl) => r.children.find((c) => c.classList.contains("tick"))!;
    expect(tick(pass).textContent).toBe("✓");
    expect(tick(fail).textContent).toBe("!");
    expect(tick(unknown).textContent).toBe("?");
    expect(fail.classList.contains("fail")).toBe(true);
    expect(unknown.classList.contains("unknown")).toBe(true);
    expect(pass.classList.contains("fail")).toBe(false);
    // The check's name and detail ride along as text in every state.
    for (const [row, name] of [[pass, "c1"], [fail, "c2"], [unknown, "c3"]] as const)
      expect(row.textContent).toContain(name);
  });
});

describe("focus and headings", () => {
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

  it("styles keyboard focus for links, buttons, and fields in the palette blue", () => {
    expect(css).toContain(":focus-visible");
    expect(css).toContain("button:focus-visible");
    expect(css).toContain("a:focus-visible");
    expect(css).toMatch(/:focus-visible[^{]*\{[^}]*outline: 2px solid var\(--blue\)/);
  });

  it("keeps the main-head and box heading styles on the new levels", () => {
    expect(css).toContain(".main-head h1");
    expect(css).toContain(".box-h h2");
  });

  it("renders a box heading as an h2 under the screen's h1", async () => {
    const app = new App();
    const r = root();
    await renderVerify(app, r as unknown as HTMLElement);
    const headings = walkAll(r).filter((c) => /^h[1-6]$/.test(c.tag));
    expect(headings.length).toBeGreaterThanOrEqual(1);
    expect(headings[0].tag).toBe("h2");
    expect(headings[0].textContent).toContain("verify a tender");
    // The frame's screen title is the h1 (main.ts is not
    // importable in a test: it runs the router on import).
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(main).toContain('el("h1"');
  });

  it("orders the sidebar as a tender runs, with a helper line on every entry", () => {
    // main.ts is read as source for the same reason as above.
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const order = [
      'key: "overview"',
      'key: "create"',
      'key: "seller"',
      'key: "approvals"',
      'key: "results"',
      'key: "verify"',
      'key: "help"',
    ].map((k) => main.indexOf(k));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Every entry renders its plain helper line, and every
    // screen opens with its purpose line under the title.
    expect(main).toContain("nav-help");
    expect(main).toContain("screen-purpose");
    for (const label of [
      "circles and tenders",
      "start a circle or tender",
      "bid and reveal",
    ]) {
      expect(main).toContain(label);
    }
  });
});
