import { describe, it, expect } from "vitest";
import { buildTracks, sampleAt } from "./trajectorySeries";

const seq = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

describe("buildTracks", () => {
  it("normalises each axis to its own range so all four are comparable in shape", () => {
    // Identity is a 0-1 cosine, detail is in the hundreds. Plotted raw on one axis, identity
    // would be a flat line at the bottom.
    const [identity, detail] = buildTracks({
      series: seq(20, (i) => 0.9 - i * 0.001),
      series_detail: seq(20, (i) => 200 + i),
    });

    // One falls, one rises, and their units differ by five orders of magnitude — but after
    // normalisation they are the same shape reflected, which is what makes them plottable
    // together. Asserted as a mirror rather than as exact 0-1 endpoints because the line is a
    // rolling mean: it approaches the extremes without landing on them.
    for (let i = 0; i < identity.points.length; i++) {
      expect(identity.points[i] + detail.points[i]).toBeCloseTo(1, 5);
    }
    expect(Math.min(...identity.points)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...identity.points)).toBeLessThanOrEqual(1);
    // Not the full 0-1: averaging pulls the endpoints of a monotone ramp inward, more so on a
    // short series like this one. A real trend still has to travel most of the plot.
    expect(Math.max(...identity.points) - Math.min(...identity.points)).toBeGreaterThan(0.85);
  });

  it("keeps the real values alongside the normalised ones", () => {
    const [t] = buildTracks({ series: seq(20, () => 0.5) });
    expect(t.raw[0]).toBe(0.5);
  });

  it("renders a flat series down the middle rather than dropping it", () => {
    // "This never changed" is information. An absent line reads as missing data.
    const [t] = buildTracks({ series: seq(20, () => 0.77) });
    expect(t.points.every((p) => p === 0.5)).toBe(true);
  });

  it("skips series too short to be a trajectory", () => {
    expect(buildTracks({ series: [0.1, 0.2, 0.3] })).toEqual([]);
  });

  it("skips absent axes without disturbing the present ones", () => {
    const tracks = buildTracks({ series: seq(20, (i) => i / 20) });
    expect(tracks.map((t) => t.key)).toEqual(["identity"]);
  });

  it("survives a series containing nulls", () => {
    const dirty = [...seq(10, (i) => i), null, undefined, "x"] as unknown[];
    const tracks = buildTracks({ series: dirty });
    expect(tracks[0].raw).toHaveLength(10);
  });

  it("smooths the plotted line but reports the raw extremes", () => {
    // The real case (job 9c7243a7): motion swung 0.13-1.06 per frame around a mean that was
    // flat at ~0.62 for the whole clip. Drawn raw it read as chaos. The chips must still say
    // how extreme it actually got, or smoothing has hidden the thing worth knowing.
    const spiky = seq(200, (i) => (i % 2 === 0 ? 0.2 : 1.0));
    const [t] = buildTracks({ series_motion: spiky });

    // The chips must still say how extreme it actually got.
    expect(t.min).toBeCloseTo(0.2, 5);
    expect(t.max).toBeCloseTo(1.0, 5);
    // ...while the line stays near the middle, because nothing actually trended.
    expect(t.points.every((p) => p > 0.35 && p < 0.65)).toBe(true);
  });

  it("still shows a sustained trend after smoothing", () => {
    // Smoothing that flattened a genuine decay would defeat the panel entirely. This is the
    // case the "stationary stays flat" test above must not be bought at the expense of.
    const decay = seq(200, (i) => 0.95 - i * 0.001);
    const [t] = buildTracks({ series: decay });
    expect(t.points[0]).toBeGreaterThan(0.9);
    expect(t.points[t.points.length - 1]).toBeLessThan(0.1);
  });

  it("returns nothing for absent metrics", () => {
    expect(buildTracks(null)).toEqual([]);
    expect(buildTracks(undefined)).toEqual([]);
  });
});

describe("sampleAt", () => {
  it("reads by proportion, not index, because the series have different lengths", () => {
    // Identity is sampled with a stride; motion is one value per frame pair. Aligning on index
    // would compare frame 40 of one axis against frame 12 of another.
    const short = buildTracks({ series: seq(10, (i) => i) })[0];
    const long = buildTracks({ series_motion: seq(100, (i) => i) })[0];
    expect(sampleAt(short, 0)).toBe(0);
    expect(sampleAt(short, 1)).toBe(9);
    expect(sampleAt(long, 0.5)).toBeCloseTo(50, 0);
  });

  it("clamps out-of-range fractions instead of returning undefined", () => {
    const t = buildTracks({ series: seq(10, (i) => i) })[0];
    expect(sampleAt(t, -1)).toBe(0);
    expect(sampleAt(t, 2)).toBe(9);
  });
});
