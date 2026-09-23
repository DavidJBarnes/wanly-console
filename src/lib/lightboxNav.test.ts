import { describe, it, expect } from "vitest";
import { isTypingTarget, lightboxNav, orderForBrowse, stepIndex } from "./lightboxNav";

const img = (path: string, lastModified: string) => ({ path, last_modified: lastModified });
const POOL = [img("a.jpg", "2026-01-01"), img("b.jpg", "2026-02-01"), img("c.jpg", "2026-03-01")];

describe("stepIndex", () => {
  it("steps forward and back", () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, -1)).toBe(1);
  });

  it("clamps at the ends instead of wrapping", () => {
    expect(stepIndex(0, 3, -1)).toBe(0);
    expect(stepIndex(2, 3, 1)).toBe(2);
  });

  it("stays put in a single-image pool", () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, 1, -1)).toBe(0);
  });

  it("stays put for an empty pool", () => {
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
});

describe("lightboxNav", () => {
  it("reports where the image sits in the pool", () => {
    expect(lightboxNav(POOL[1], POOL)).toEqual({ index: 1, total: 3 });
  });

  it("returns null for a closed lightbox", () => {
    expect(lightboxNav(null, POOL)).toBeNull();
  });

  it("returns null when the image left the pool (deleted or refetched away)", () => {
    const gone = img("gone.jpg", "2026-04-01");
    expect(lightboxNav(gone, POOL)).toBeNull();
  });
});

describe("orderForBrowse", () => {
  it("newest first, matching the folder grid", () => {
    const shuffled = [POOL[2], POOL[0], POOL[1]];
    expect(orderForBrowse(shuffled, true).map((i) => i.path)).toEqual([
      "c.jpg",
      "b.jpg",
      "a.jpg",
    ]);
  });

  it("oldest first when sort is flipped", () => {
    const shuffled = [POOL[2], POOL[0], POOL[1]];
    expect(orderForBrowse(shuffled, false).map((i) => i.path)).toEqual([
      "a.jpg",
      "b.jpg",
      "c.jpg",
    ]);
  });

  it("never reorders the caller's array", () => {
    const original = [POOL[2], POOL[0], POOL[1]];
    orderForBrowse(original, true);
    expect(original.map((i) => i.path)).toEqual(["c.jpg", "a.jpg", "b.jpg"]);
  });
});

describe("isTypingTarget", () => {
  const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable });

  it("leaves arrow keys to text inputs and textareas", () => {
    // The tag editor lives inside the lightbox: Left/Right must move the caret.
    expect(isTypingTarget(el("input"))).toBe(true);
    expect(isTypingTarget(el("INPUT"))).toBe(true);
    expect(isTypingTarget(el("textarea"))).toBe(true);
  });

  it("leaves arrow keys to selects and contenteditable hosts", () => {
    expect(isTypingTarget(el("select"))).toBe(true);
    expect(isTypingTarget(el("div", true))).toBe(true);
  });

  it("steps images for buttons, the dialog, and non-elements", () => {
    expect(isTypingTarget(el("button"))).toBe(false);
    expect(isTypingTarget(el("div"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget("nonsense")).toBe(false);
  });
});
