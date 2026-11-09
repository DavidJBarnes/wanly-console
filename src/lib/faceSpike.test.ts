import { describe, expect, it } from "vitest";
import {
  averageSamples,
  centerJitter,
  depthFromSpan,
  faceInCamera,
  LM,
  pixelRay,
  sampleFromLandmarks,
} from "./faceSpike";
import type { CameraModel, Pt2 } from "./faceSpike";

const cam: CameraModel = { hfovDeg: 90, width: 1280, height: 960 };

describe("pixelRay", () => {
  it("image centre is straight down -z", () => {
    expect(pixelRay({ x: 0.5, y: 0.5 }, cam)).toEqual({ x: 0, y: 0, z: -1 });
  });
  it("right edge at 90° hfov is 45° right; top is up (+y)", () => {
    const r = pixelRay({ x: 1, y: 0 }, cam);
    expect(r.x).toBeCloseTo(1);
    expect(r.y).toBeCloseTo(0.75); // aspect 4:3
  });
});

describe("depthFromSpan", () => {
  it("round-trips: a 0.1 m span at 1 m fills 0.05 of a 90° frame", () => {
    // at depth 1, 90° hfov spans 2 m; 0.1 m = 0.05 of the width
    expect(depthFromSpan(0.05, 0.1, cam)).toBeCloseTo(1);
    expect(depthFromSpan(0.025, 0.1, cam)).toBeCloseTo(2);
  });
  it("rejects a degenerate span", () => {
    expect(depthFromSpan(0, 0.1, cam)).toBeNaN();
  });
});

function landmarks(points: Record<number, Pt2>): Pt2[] {
  const out: Pt2[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [i, p] of Object.entries(points)) out[Number(i)] = p;
  return out;
}

describe("sampleFromLandmarks → faceInCamera", () => {
  it("a centred face with a 0.05 eye span lands 1 m ahead with a 9 cm eye span", () => {
    const lm = landmarks({
      [LM.rightEyeOuter]: { x: 0.475, y: 0.45 },
      [LM.leftEyeOuter]: { x: 0.525, y: 0.45 },
      [LM.noseTip]: { x: 0.5, y: 0.55 },
      [LM.forehead]: { x: 0.5, y: 0.4 },
      [LM.chin]: { x: 0.5, y: 0.6 },
    });
    const s = sampleFromLandmarks(lm, 1280 / 960)!;
    expect(s.eyeSpan).toBeCloseTo(0.05);
    expect(s.center).toEqual({ x: 0.5, y: 0.5 });
    const f = faceInCamera(s, cam, 0.09)!;
    expect(f.position.z).toBeCloseTo(-0.9);
    expect(f.position.x).toBeCloseTo(0);
    // faceHeight 0.2 in y → 0.15 in x-units; scaled by 0.09/0.05
    expect(f.heightM).toBeCloseTo(0.27);
  });
  it("returns null when landmarks are missing", () => {
    expect(sampleFromLandmarks([], 1)).toBeNull();
  });
});

describe("averageSamples / centerJitter", () => {
  it("averages and measures spread", () => {
    const a = { center: { x: 0.4, y: 0.5 }, eyeSpan: 0.04, faceHeight: 0.1 };
    const b = { center: { x: 0.6, y: 0.5 }, eyeSpan: 0.06, faceHeight: 0.2 };
    const m = averageSamples([a, b])!;
    expect(m.center.x).toBeCloseTo(0.5);
    expect(m.eyeSpan).toBeCloseTo(0.05);
    expect(centerJitter([a, b])).toBeCloseTo(0.1);
    expect(averageSamples([])).toBeNull();
  });
});
