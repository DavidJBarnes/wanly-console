import { describe, it, expect } from "vitest";
import {
  isTypingTarget,
  lightboxNav,
  lightboxSteps,
  orderForBrowse,
  poolForView,
  stepIndex,
  successorAfterDelete,
} from "./lightboxNav";

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

describe("lightboxSteps", () => {
  it("steps either side of an image in the pool", () => {
    expect(lightboxSteps(POOL[1], POOL, null)).toEqual({ index: 1, total: 3, prev: 0, next: 2 });
  });

  it("has no previous at the start and no next at the end", () => {
    expect(lightboxSteps(POOL[0], POOL, null)).toMatchObject({ prev: null, next: 1 });
    expect(lightboxSteps(POOL[2], POOL, null)).toMatchObject({ prev: 1, next: null });
  });

  it("ignores lastIndex while the image is still in the pool", () => {
    expect(lightboxSteps(POOL[1], POOL, 0)).toMatchObject({ index: 1 });
  });

  it("keeps the arrows when the image leaves the pool — tagged out of Untagged", () => {
    // b was at 1 and was tagged: the untagged list is now [a, c].
    const after = [POOL[0], POOL[2]];
    expect(lightboxSteps(POOL[1], after, 1)).toEqual({ index: null, total: 2, prev: 0, next: 1 });
  });

  it("a detached image that was last has only a previous", () => {
    const after = [POOL[0], POOL[1]];
    expect(lightboxSteps(POOL[2], after, 2)).toEqual({ index: null, total: 2, prev: 1, next: null });
  });

  it("a detached image that was first has only a next", () => {
    const after = [POOL[1], POOL[2]];
    expect(lightboxSteps(POOL[0], after, 0)).toEqual({ index: null, total: 2, prev: null, next: 0 });
  });

  it("clamps a stale lastIndex into the pool", () => {
    expect(lightboxSteps(img("gone.jpg", "x"), [POOL[0]], 5)).toEqual({
      index: null, total: 1, prev: 0, next: null,
    });
  });

  it("returns null with nowhere to go", () => {
    expect(lightboxSteps(null, POOL, 0)).toBeNull();
    expect(lightboxSteps(img("gone.jpg", "x"), POOL, null)).toBeNull();
    expect(lightboxSteps(img("gone.jpg", "x"), [], 0)).toBeNull();
  });

  it("walks the untagged list while every image is tagged out of it in turn", () => {
    // The Untagged workflow: open the first, tag it (it leaves the list), press →, repeat.
    let pool = [...POOL];
    let on = pool[0];
    let last = 0;
    const seen = [on.path];
    for (;;) {
      last = pool.findIndex((i) => i.path === on.path);
      pool = pool.filter((i) => i.path !== on.path);             // tagged: gone from the view
      const steps = lightboxSteps(on, pool, last);
      if (!steps || steps.next === null) break;
      on = pool[steps.next];
      seen.push(on.path);
    }
    expect(seen).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });
});

describe("successorAfterDelete", () => {
  it("moves to the next image", () => {
    expect(successorAfterDelete(POOL, "a.jpg", null)?.path).toBe("b.jpg");
    expect(successorAfterDelete(POOL, "b.jpg", null)?.path).toBe("c.jpg");
  });

  it("moves to the previous image when the deleted one was last", () => {
    expect(successorAfterDelete(POOL, "c.jpg", null)?.path).toBe("b.jpg");
  });

  it("closes when nothing is left", () => {
    expect(successorAfterDelete([POOL[0]], "a.jpg", null)).toBeNull();
    expect(successorAfterDelete([], "a.jpg", 0)).toBeNull();
  });

  it("uses lastIndex for an image that had already left the pool", () => {
    // b was at 1, tagged out of Untagged ([a, c] now), then deleted: c took its place.
    expect(successorAfterDelete([POOL[0], POOL[2]], "b.jpg", 1)?.path).toBe("c.jpg");
    // c was last and left: a detached delete falls back to the new last.
    expect(successorAfterDelete([POOL[0], POOL[1]], "c.jpg", 2)?.path).toBe("b.jpg");
  });

  it("closes for a detached image with no remembered position", () => {
    expect(successorAfterDelete(POOL, "gone.jpg", null)).toBeNull();
  });

  it("deleting down to nothing visits next, next, then previous, then closes", () => {
    let pool = [...POOL];
    let on: { path: string } | null = pool[1];
    const seen: string[] = [];
    while (on) {
      seen.push(on.path);
      const gone: string = on.path;
      on = successorAfterDelete(pool, gone, null);
      pool = pool.filter((i) => i.path !== gone);
    }
    expect(seen).toEqual(["b.jpg", "c.jpg", "a.jpg"]);
  });
});

describe("poolForView", () => {
  const view = {
    filterActive: false, favoritesView: false, untaggedView: false,
    search: ["s"], favorites: ["f"], untagged: ["u"], folder: ["d"],
  };

  it("steps through the untagged list in the Untagged view", () => {
    expect(poolForView({ ...view, untaggedView: true })).toEqual(["u"]);
  });

  it("a filter wins wherever it was typed", () => {
    expect(poolForView({ ...view, untaggedView: true, filterActive: true })).toEqual(["s"]);
  });

  it("otherwise favourites, then the folder", () => {
    expect(poolForView({ ...view, favoritesView: true })).toEqual(["f"]);
    expect(poolForView(view)).toEqual(["d"]);
  });
});
