import { describe, it, expect } from "vitest";
import { describeQueued, newlyEnhanced } from "./enhanceQueue";

const status = (waiting: string[], failed: string[] = []) => ({
  running: waiting[0] ?? null,
  waiting,
  failed: failed.map((path) => ({ path, error: "x" })),
});

describe("newlyEnhanced", () => {
  it("is what left the line", () => {
    expect(newlyEnhanced(status(["a", "b"]), status(["b"]))).toEqual(["a"]);
  });
  it("does not count a failure as done", () => {
    expect(newlyEnhanced(status(["a"]), status([], ["a"]))).toEqual([]);
  });
  it("says nothing on the first read", () => {
    expect(newlyEnhanced(null, status([]))).toEqual([]);
  });
});

describe("describeQueued", () => {
  const result = (queued: number, already_enhanced = 0, no_action = 0) =>
    ({ queued, already_enhanced, no_action, status: status([]) });
  it("is one sentence when nothing was left out", () => {
    expect(describeQueued(result(3))).toBe("Queued 3 for Enhance prompt.");
  });
  it("names what was left out", () => {
    expect(describeQueued(result(1, 2, 3))).toBe(
      "Queued 1 for Enhance prompt. 2 already have a prompt. 3 have no Action tag with a description.");
  });
});
