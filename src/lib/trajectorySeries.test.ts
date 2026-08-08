import { describe, it, expect } from "vitest";
import { buildTracks, sampleAt } from "./trajectorySeries";

const seq = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

describe("buildTracks", () => {
  it("normalises each axis to its own range so all four are comparable in shape", () => {
    // Identity is a 0-1 cosine, detail is in the hundreds. Plotted raw on one axis, identity
    // would be a flat line at the bottom.
    const tracks = buildTracks({
      series: seq(20, (i) => 0.9 - i * 0.001),
      series_detail: seq(20, (i) => 200 + i),
    });
    for (const t of tracks) {
      expect(Math.min(...t.points)).toBeCloseTo(0, 5);
      expect(Math.max(...t.points)).toBeCloseTo(1, 5);
    }
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
