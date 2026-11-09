import { describe, expect, it } from "vitest";
import {
  applyMat4,
  averageSamples,
  calibrate,
  faceInViewer,
  LATENCIES_MS,
  projectFace,
  rotation,
  spreadM,
  centerJitter,
  depthFromSpan,
  faceInCamera,
  LM,
  pixelRay,
  sampleFromLandmarks,
} from "./faceSpike";
import type { CalSample, CameraModel, CamParams, Mat4, Pt2 } from "./faceSpike";

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


/** Column-major rigid transform from a position and yaw/pitch (degrees). */
function pose(x: number, y: number, z: number, yaw: number, pitch: number): number[] {
  const r = rotation(yaw, pitch, 0); // row-major
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, x, y, z, 1];
}

const DEFAULT: CamParams = {
  hfovDeg: 80, yawDeg: 0, pitchDeg: 0, rollDeg: 0, offX: 0, offY: 0, offZ: 0, flipX: false,
};

describe("faceInViewer / projectFace", () => {
  it("round-trip through a rotated, offset camera", () => {
    const p: CamParams = { ...DEFAULT, hfovDeg: 70, yawDeg: 6, pitchDeg: -4, rollDeg: 2, offX: 0.03, offY: -0.02 };
    const viewer = pose(0.1, 1.6, 0.2, 10, -5);
    const P = { x: 0.2, y: 1.5, z: -0.8 };
    const s = projectFace(P, viewer, p, 0.095, 4 / 3);
    const back = applyMat4(viewer, faceInViewer(s, p, 0.095, 4 / 3)!);
    expect(back.x).toBeCloseTo(P.x, 6);
    expect(back.y).toBeCloseTo(P.y, 6);
    expect(back.z).toBeCloseTo(P.z, 6);
  });
});

describe("calibrate", () => {
  // A plausible headset error: narrower FOV, camera turned and offset, 66 ms of latency.
  const truth: CamParams = { ...DEFAULT, hfovDeg: 68, yawDeg: -7, pitchDeg: 5, rollDeg: 1.5, offX: 0.032, offY: -0.015 };
  const P = { x: 0.05, y: 1.45, z: -1.0 };
  const aspect = 4 / 3;

  function session(t: CamParams, lagSteps: number): CalSample[] {
    // Head sways side to side and nods while looking roughly at the face, 30 Hz for 6 s.
    const poses: number[][] = [];
    for (let i = 0; i < 180 + 10; i++) {
      const tt = i / 30;
      poses.push(pose(0.15 * Math.sin(tt * 1.3), 1.6 + 0.05 * Math.sin(tt * 2.1), 0.05 * Math.cos(tt * 0.9),
        8 * Math.sin(tt * 1.3), -6 + 8 * Math.sin(tt * 1.7)));
    }
    const out: CalSample[] = [];
    for (let i = 10; i < poses.length; i += 2) {
      // The frame was captured lagSteps frames before the pose it is paired with.
      const sample = projectFace(P, poses[i - lagSteps], t, 0.095, aspect);
      const viewers: Mat4[] = LATENCIES_MS.map((ms) => poses[i - Math.round(ms / 33.3)]);
      out.push({ sample, viewers });
    }
    return out;
  }

  it("recovers a mis-modelled camera: the spread collapses", () => {
    const samples = session(truth, 2);
    const r = calibrate(samples, DEFAULT, 0.095, aspect)!;
    expect(r.spreadBeforeCm).toBeGreaterThan(3);
    expect(r.spreadAfterCm).toBeLessThan(0.5);
    expect(r.latencyMs).toBe(66);
    expect(r.params.flipX).toBe(false);
    // And the calibrated model puts the face where it really is.
    const v = faceInViewer(samples[0].sample, r.params, 0.095, aspect)!;
    const w = applyMat4(samples[0].viewers[2], v);
    expect(Math.hypot(w.x - P.x, w.y - P.y, w.z - P.z)).toBeLessThan(0.02);
  });

  it("detects a mirrored image", () => {
    const samples = session({ ...truth, flipX: true }, 0);
    const r = calibrate(samples, DEFAULT, 0.095, aspect)!;
    expect(r.params.flipX).toBe(true);
    expect(r.spreadAfterCm).toBeLessThan(0.5);
  });

  it("refuses too few samples", () => {
    expect(calibrate([], DEFAULT, 0.095, aspect)).toBeNull();
    expect(spreadM([], DEFAULT, 0.095, aspect)).toBe(Infinity);
  });
});
