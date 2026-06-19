import { describe, it, expect } from "vitest";
import { PushCache } from "./push-cache.js";

describe("PushCache", () => {
  it("reports unchanged only after marking the same id+hash", () => {
    const c = new PushCache(":memory:");
    expect(c.unchanged("a", "h1")).toBe(false); // never seen
    c.mark([{ id: "a", hash: "h1" }]);
    expect(c.unchanged("a", "h1")).toBe(true); // same content
    expect(c.unchanged("a", "h2")).toBe(false); // content changed
    c.close();
  });

  it("updates the hash on re-mark and handles batches", () => {
    const c = new PushCache(":memory:");
    c.mark([
      { id: "a", hash: "h1" },
      { id: "b", hash: "h1" },
    ]);
    c.mark([{ id: "a", hash: "h2" }]); // a's content changed
    expect(c.unchanged("a", "h2")).toBe(true);
    expect(c.unchanged("a", "h1")).toBe(false);
    expect(c.unchanged("b", "h1")).toBe(true);
    c.close();
  });
});
