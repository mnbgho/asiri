import { describe, it, expect, beforeEach } from "vitest";
import { App } from "../src/app";

// The watch list lives in localStorage. A first visit has nothing
// stored, and older or partial values must still read back as
// plain string lists: the overview and approvals screens spread
// these lists directly.
const backing = new Map<string, string>();

beforeEach(() => {
  backing.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
});

function stored(v: unknown): void {
  backing.set("asiri:watched", JSON.stringify(v));
}

describe("watched", () => {
  it("returns empty lists when nothing was ever stored", () => {
    const app = new App();
    expect(app.watched()).toEqual({ circles: [], tenders: [] });
  });

  it("returns empty lists for an empty stored object", () => {
    stored({});
    const app = new App();
    expect(app.watched()).toEqual({ circles: [], tenders: [] });
  });

  it("returns stored lists unchanged", () => {
    stored({ circles: ["component_a"], tenders: ["component_b"] });
    const app = new App();
    expect(app.watched()).toEqual({
      circles: ["component_a"],
      tenders: ["component_b"],
    });
  });

  it("drops stored values that are not string lists", () => {
    stored({ circles: "component_a", tenders: 3 });
    const app = new App();
    expect(app.watched()).toEqual({ circles: [], tenders: [] });
  });

  it("keeps only the string entries of a stored list", () => {
    stored({ circles: ["component_a", 7, null], tenders: [] });
    const app = new App();
    expect(app.watched().circles).toEqual(["component_a"]);
  });

  it("returns empty lists for malformed stored JSON", () => {
    backing.set("asiri:watched", "{not json");
    const app = new App();
    expect(app.watched()).toEqual({ circles: [], tenders: [] });
  });

  it("watch writes back a repaired value over a corrupted one", () => {
    stored({ circles: "component_a", tenders: [] });
    const app = new App();
    app.watch("tenders", "component_b");
    expect(JSON.parse(backing.get("asiri:watched")!)).toEqual({
      circles: [],
      tenders: ["component_b"],
    });
  });

  it("round-trips through watch on a fresh store", () => {
    const app = new App();
    app.watch("circles", "component_a");
    app.watch("tenders", "component_b");
    expect(app.watched()).toEqual({
      circles: ["component_a"],
      tenders: ["component_b"],
    });
  });
});
