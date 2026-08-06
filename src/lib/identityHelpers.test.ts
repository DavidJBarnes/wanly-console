import { describe, it, expect } from "vitest";
import {
  band,
  totalDrift,
  fmt,
  median,
  tailVerdict,
  DIP_THRESHOLD,
} from "./identityHelpers";

describe("band", () => {
  it("null and undefined are 'default', not 'error'", () => {
    // An unscored segment must not render as a failure.
    expect(band(null)).toBe("default");
    expect(band(undefined)).toBe("default");
  });

  it.each([
    [0.0, "error"],
    [0.499, "error"],
    [0.5, "warning"],
    [0.699, "warning"],
    [0.7, "success"],
    [1.0, "success"],
  ])("%s -> %s", (v, expected) => {
    expect(band(v as number)).toBe(expected);
  });
});

describe("totalDrift", () => {
  it("is slope across the gaps, not across the frames", () => {
    // frames-1 gaps, not frames. Off by one here silently misreports every clip.
    expect(totalDrift(-0.002, 177)).toBeCloseTo(-0.352, 6);
  });

  it("returns null when it cannot be computed", () => {
    expect(totalDrift(null, 177)).toBeNull();
    expect(totalDrift(-0.002, null)).toBeNull();
    expect(totalDrift(-0.002, 0)).toBeNull();
    expect(totalDrift(-0.002, 1)).toBeNull(); // one frame = no interval
  });
});

describe("fmt", () => {
  it("renders an em dash for missing values rather than 0.000", () => {
    expect(fmt(null)).toBe("—");
    expect(fmt(undefined)).toBe("—");
    expect(fmt(0)).toBe("0.000");
  });
});

describe("median", () => {
  it("averages the middle pair on even length", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("takes the middle on odd length", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("does not mutate its input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("tailVerdict — the discrimination the panel exists for", () => {
  // Both series END at ~0.506. Endpoint numbers alone cannot tell them apart, and they call for
  // opposite responses: one is genuine drift, the other is a bad anchor frame that the next
  // segment would inherit.
  const steadyDecay = Array.from({ length: 177 }, (_, i) => 0.851 - (0.345 * i) / 176);
  const endBlip = Array.from({ length: 177 }, (_, i) =>
    i < 20 ? 0.851 - (0.2 * i) / 20 : i < 171 ? 0.65 : 0.65 - (0.145 * (i - 170)) / 6,
  );

  it("a steady decay is NOT flagged — the endpoint is where the clip really is", () => {
    const v = tailVerdict(steadyDecay);
    expect(v.end).toBeCloseTo(0.506, 2);
    expect(v.isDip).toBe(false);
  });

  it("an end blip IS flagged, at the same endpoint", () => {
    const v = tailVerdict(endBlip);
    expect(v.end).toBeCloseTo(0.505, 2);
    expect(v.isDip).toBe(true);
    expect(v.dip!).toBeGreaterThan(DIP_THRESHOLD);
  });

  it("reports what a better anchor in the tail would be worth", () => {
    const v = tailVerdict(endBlip);
    expect(v.bestTail - v.end).toBeGreaterThan(0.1);
    expect(v.bestOffset).toBeGreaterThan(0);
  });

  it("a rising tail gives a negative dip, never a flag", () => {
    const rising = [...Array(20).fill(0.5), 0.55, 0.6, 0.65, 0.7];
    const v = tailVerdict(rising);
    expect(v.dip!).toBeLessThan(0);
    expect(v.isDip).toBe(false);
  });

  it("too short to judge yields a null median rather than a wrong verdict", () => {
    const v = tailVerdict([0.9, 0.8, 0.7]);
    expect(v.bodyMedian).toBeNull();
    expect(v.isDip).toBe(false);
  });
});
