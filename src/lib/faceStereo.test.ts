import { describe, expect, it } from "vitest";
import { ANCHOR_MIN_SAMPLES, median, medianAnchors, PLACE_ANCHORS, PoseHistory } from "./faceStereo";

const rotY = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  // column-major 4x4
  return [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
};

describe("medianAnchors", () => {
  it("keeps anchors seen often enough, by median, and ignores outliers", () => {
    const good = (i: number, dx = 0) => ({ x: i + dx, y: 0, z: -0.5 });
    const samples = Array.from({ length: 5 }, (_, k) =>
      PLACE_ANCHORS.map((_, i) => (i === 0 && k > 0 ? null : good(i, k === 4 ? 0.5 : 0))),
    );
    const got = medianAnchors(samples);
    // anchor 0 is seen once (< ANCHOR_MIN_SAMPLES), so it is dropped
    expect(ANCHOR_MIN_SAMPLES).toBeGreaterThan(1);
    expect(got.map((g) => g.index)).toEqual(PLACE_ANCHORS.map((_, i) => i).slice(1));
    // one sample off by 0.5 does not move the median
    expect(got[0].point.x).toBe(1);
  });
  it("skips samples with no anchors at all", () => {
    expect(medianAnchors([null, null])).toEqual([]);
  });
});

describe("median", () => {
  it("handles odd and even lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe("PoseHistory", () => {
  it("picks the nearest pose and measures turn rate", () => {
    const h = new PoseHistory();
    h.push(0, rotY(0));
    h.push(33, rotY(1));
    expect(h.at(30)).toEqual(rotY(1));
    expect(h.turnRate(33)).toBeCloseTo(1 / 0.033, 0);
  });
  it("forgets poses older than the history window", () => {
    const h = new PoseHistory();
    h.push(0, rotY(10));
    h.push(1000, rotY(0));
    expect(h.at(0)).toEqual(rotY(0));
  });
});
