// The guided helper: the next-step line must name the
// right thing for each screen, every task must be a walkable
// list of plain steps, and the panel must open, show a task,
// and move through its steps.
import { describe, expect, it } from "vitest";
import {
  GUIDE_TASKS,
  GuidePanel,
  nextForRoute,
  stepMatchesRoute,
} from "../src/guide";

class FakeElement {
  tagName: string;
  className = "";
  textContent = "";
  hidden = false;
  disabled = false;
  children: FakeElement[] = [];
  private handlers: Record<string, (() => void)[]> = {};
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.children = [...nodes];
  }
  addEventListener(kind: string, fn: () => void): void {
    (this.handlers[kind] ??= []).push(fn);
  }
  setAttribute(_name: string, _value: string): void {
    /* the panel only marks labels */
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

function findAll(root: FakeElement, cls: string): FakeElement[] {
  const out: FakeElement[] = [];
  const stack: FakeElement[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.className.split(" ").includes(cls)) out.push(n);
    stack.push(...n.children);
  }
  return out;
}

describe("nextForRoute", () => {
  it("names the next thing to do on each screen", () => {
    expect(nextForRoute("#/app/create")).toContain("Fill the form");
    expect(nextForRoute("#/app/seller")).toContain("Commit a sealed bid");
    expect(nextForRoute("#/app/tender/component_abc")).toContain("action its state allows");
    expect(nextForRoute("#/app/results")).toContain("claims the bond");
    expect(nextForRoute("#/app/verify")).toContain("Paste a tender address");
    expect(nextForRoute("#/")).toContain("Open the app");
  });
});

describe("stepMatchesRoute", () => {
  it("matches an exact screen and a tender page prefix", () => {
    expect(stepMatchesRoute({ title: "t", text: "x", route: "#/app/create" }, "#/app/create")).toBe(true);
    expect(stepMatchesRoute({ title: "t", text: "x", route: "#/app/create" }, "#/app/seller")).toBe(false);
    expect(stepMatchesRoute({ title: "t", text: "x", route: "#/app/tender/" }, "#/app/tender/component_abc")).toBe(true);
    expect(stepMatchesRoute({ title: "t", text: "x" }, "#/app/create")).toBe(false);
  });
});

describe("GUIDE_TASKS", () => {
  it("covers the whole loop in plain steps", () => {
    const ids = GUIDE_TASKS.map((t) => t.id);
    for (const id of ["create-circle", "create-tender", "bid", "reveal", "award", "delivery", "claim", "verify"]) {
      expect(ids).toContain(id);
    }
    for (const t of GUIDE_TASKS) {
      expect(t.steps.length).toBeGreaterThanOrEqual(3);
      for (const s of t.steps) {
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.text.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("GuidePanel", () => {
  it("opens the task list, shows a task's steps, and moves through them", () => {
    body.children = [];
    const panel = new GuidePanel();
    const btn = findAll(body, "guide-btn")[0];
    const panelEl = findAll(body, "guide-panel")[0];
    expect(panelEl.hidden).toBe(true);
    btn.click();
    expect(panelEl.hidden).toBe(false);
    const tasks = findAll(body, "guide-task");
    expect(tasks.length).toBe(GUIDE_TASKS.length);
    const createCircle = tasks.find((t) => t.textContent === "Create a circle")!;
    createCircle.click();
    const steps = findAll(body, "guide-step");
    expect(steps.length).toBe(GUIDE_TASKS[0].steps.length);
    const currentTitle = (list: FakeElement[]) => {
      const row = list.find((s) => s.className.split(" ").includes("on"))!;
      return findAll(row, "guide-step-title")[0].textContent;
    };
    expect(currentTitle(steps)).toBe(GUIDE_TASKS[0].steps[0].title);
    const nav = findAll(body, "guide-nav")[0];
    const next = nav.children.find((c) => c.textContent === "Next")!;
    next.click();
    const stepsAfter = findAll(body, "guide-step");
    expect(currentTitle(stepsAfter)).toBe(GUIDE_TASKS[0].steps[1].title);
  });
});
