// Human time for epoch deadlines: the
// epoch-to-wall-clock maths, the countdown rendering, the
// unknown-epoch degradation, and the live span refresh the
// ticker in main.ts drives.
//
// The DOM here is the smallest fake the span helpers touch:
// dataset, textContent, and a querySelectorAll that understands
// the one attribute selector updateDeadlineSpans uses.
import { beforeEach, describe, expect, it } from "vitest";
import {
  EPOCH_SECONDS,
  clockText,
  deadlineSpan,
  deadlineText,
  durationText,
  revealWindowText,
  updateDeadlineSpans,
} from "../src/time";

class FakeEl {
  className = "";
  dataset: Record<string, string> = {};
  children: FakeEl[] = [];
  private ownText = "";
  constructor(public tag: string) {}
  set textContent(v: string) {
    this.ownText = v;
    this.children = [];
  }
  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  append(...nodes: FakeEl[]): void {
    this.children.push(...nodes);
  }
  querySelectorAll(sel: string): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (el: FakeEl) => {
      for (const c of el.children) {
        if (sel === "[data-epoch]" && c.dataset.epoch !== undefined) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

beforeEach(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => new FakeEl(tag),
    createTextNode: (text: string) => ({ text }),
  };
});

const NOW = new Date(2026, 10, 20, 10, 0, 0); // a friday, 10:00 local

describe("epoch lengths", () => {
  it("matches the lengths the create hints state", () => {
    expect(EPOCH_SECONDS.esmeralda).toBe(3600); // about an hour
    expect(EPOCH_SECONDS.mainnet).toBe(1200); // about twenty minutes
  });
});

describe("durationText", () => {
  it("renders minutes, hours, and days in plain words", () => {
    expect(durationText(60)).toBe("about a minute");
    expect(durationText(25 * 60)).toBe("about 25 minutes");
    expect(durationText(3600)).toBe("about an hour");
    expect(durationText(3 * 3600)).toBe("about 3 hours");
    expect(durationText(86400)).toBe("about a day");
    expect(durationText(2 * 86400)).toBe("about 2 days");
  });
});

describe("clockText", () => {
  it("names today and tomorrow, and dates further out", () => {
    expect(clockText(new Date(2026, 10, 20, 14, 30), NOW)).toBe("14:30 today");
    expect(clockText(new Date(2026, 10, 21, 9, 15), NOW)).toBe("09:15 tomorrow");
    const later = clockText(new Date(2026, 10, 25, 14, 30), NOW);
    expect(later).toContain("14:30 on");
    expect(later).toContain("25 nov");
  });
});

describe("deadlineText", () => {
  it("shows the epoch alone when the current epoch is unknown", () => {
    expect(deadlineText("esmeralda", 105, 0, NOW)).toBe("epoch 105");
  });

  it("counts down in the network's own epoch length", () => {
    // three esmeralda epochs out from 10:00 is about 13:00.
    expect(deadlineText("esmeralda", 103, 100, NOW)).toBe(
      "epoch 103 · in about 3 hours (about 13:00 today)",
    );
    // three mainnet epochs is about an hour.
    expect(deadlineText("mainnet", 103, 100, NOW)).toBe(
      "epoch 103 · in about an hour (about 11:00 today)",
    );
  });

  it("names the current epoch and the past plainly", () => {
    expect(deadlineText("esmeralda", 100, 100, NOW)).toBe("epoch 100 · this epoch");
    expect(deadlineText("esmeralda", 97, 100, NOW)).toBe(
      "epoch 97 · about 3 hours ago",
    );
  });
});

describe("revealWindowText", () => {
  it("states when reveals open and close, as promised at commitment", () => {
    const text = revealWindowText("esmeralda", 110, 120, 100, NOW);
    expect(text).toContain("reveals open at epoch 110");
    expect(text).toContain("close at epoch 120 · in about 20 hours");
  });

  it("is null when the tender carries no deadlines yet", () => {
    expect(revealWindowText("esmeralda", null, 120, 100, NOW)).toBeNull();
    expect(revealWindowText("esmeralda", 110, null, 100, NOW)).toBeNull();
  });
});

describe("deadline spans and the refresh", () => {
  it("renders the deadline text and carries its epoch", () => {
    const span = deadlineSpan("esmeralda", 103, 100);
    expect(span.textContent).toContain("epoch 103");
    expect((span as unknown as FakeEl).dataset.epoch).toBe("103");
    expect((span as unknown as FakeEl).dataset.gate).toBeUndefined();
    const gate = deadlineSpan("esmeralda", 103, 100, { gate: true });
    expect((gate as unknown as FakeEl).dataset.gate).toBe("1");
  });

  it("re-renders countdowns for a newly read epoch", () => {
    const root = new FakeEl("div");
    const span = deadlineSpan("esmeralda", 105, 100) as unknown as FakeEl;
    root.append(span);
    const crossed = updateDeadlineSpans(root as never, "esmeralda", 103, 100, NOW);
    expect(crossed).toBe(false);
    expect(span.textContent).toContain("in about 2 hours");
  });

  it("reports a gate crossing only with a known baseline", () => {
    const root = new FakeEl("div");
    root.append(deadlineSpan("esmeralda", 105, 100, { gate: true }) as unknown as FakeEl);
    // baseline unknown: the text updates, no crossing is claimed.
    expect(updateDeadlineSpans(root as never, "esmeralda", 106, 0, NOW)).toBe(false);
    // baseline at the deadline, now past it: crossed.
    expect(updateDeadlineSpans(root as never, "esmeralda", 106, 105, NOW)).toBe(true);
    // already past at the baseline: not a new crossing.
    expect(updateDeadlineSpans(root as never, "esmeralda", 107, 106, NOW)).toBe(false);
  });

  it("does not report crossings for plain deadlines", () => {
    const root = new FakeEl("div");
    root.append(deadlineSpan("esmeralda", 105, 100) as unknown as FakeEl);
    expect(updateDeadlineSpans(root as never, "esmeralda", 106, 105, NOW)).toBe(false);
  });
});
