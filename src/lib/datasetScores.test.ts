import { describe, it, expect } from "vitest";
import { byLikeness, COS_FLOOR, formatCos, verdictFor } from "./datasets";

/**
 * Scoring against a picked anchor answers the one question worth asking — is this the same
 * person as that. The rules here are about not lying with the answer.
 */
describe("verdictFor", () => {
  it("calls the anchor the anchor, whatever it scored", () => {
    expect(verdictFor({ cos: 1, is_anchor: true })).toBe("anchor");
  });

  it("separates a low score from an absent one", () => {
    // A null cos means the detector found no face. Rendering it as the worst match would send
    // you to delete a photo whose only problem is that the face is turned away.
    expect(verdictFor({ cos: 0.1, is_anchor: false })).toBe("below");
    expect(verdictFor({ cos: null, is_anchor: false })).toBe("no-face");
  });

  it("treats the floor itself as a match", () => {
    expect(verdictFor({ cos: COS_FLOOR, is_anchor: false })).toBe("match");
    expect(verdictFor({ cos: COS_FLOOR - 0.001, is_anchor: false })).toBe("below");
  });

  it("says unscored rather than guessing when there is no score at all", () => {
    expect(verdictFor(undefined)).toBe("unscored");
  });
});

describe("formatCos", () => {
  it("says 'no face' instead of a number that would be read as a score", () => {
    expect(formatCos(null)).toBe("no face");
  });

  it("shows two decimals, the resolution the 0.4 decision is made at", () => {
    expect(formatCos(0.41739)).toBe("0.42");
  });
});

describe("byLikeness", () => {
  const s = (cos: number | null, is_anchor = false) => ({ cos, is_anchor });

  it("puts the worst first, where a cull starts", () => {
    const out = [s(0.9), s(0.2), s(0.6)].sort(byLikeness).map((x) => x.cos);
    expect(out).toEqual([0.2, 0.6, 0.9]);
  });

  it("keeps the anchor last, never under the delete button", () => {
    // It scores 1.0 against itself, so a naive sort would float it — to the one place it must
    // not be.
    const out = [s(0.9), s(1, true), s(0.2)].sort(byLikeness);
    expect(out[out.length - 1].is_anchor).toBe(true);
  });

  it("sorts a missing face with the worst, since it is the other thing worth looking at", () => {
    const out = [s(0.9), s(null), s(0.2)].sort(byLikeness).map((x) => x.cos);
    expect(out).toEqual([null, 0.2, 0.9]);
  });
});
