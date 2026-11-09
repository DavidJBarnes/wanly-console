import { describe, expect, it } from "vitest";
import {
  cameraToHead,
  centerJitter,
  eyeLineDepth,
  headToCamera,
  landmarkInHead,
  LM,
  profileForLabel,
  projectToImage,
  QUEST_3S_CAMERAS,
  sampleFromLandmarks,
  streamIntrinsics,
  triangulate,
} from "./faceSpike";
import type { Pt2 } from "./faceSpike";

const right = QUEST_3S_CAMERAS.right;
const k = streamIntrinsics(right, 1280, 960);

describe("streamIntrinsics", () => {
  it("1280x960 from the 1728² sensor: full width, middle 1296 rows, scaled by 1280/1728", () => {
    const s = 1280 / 1728;
    expect(k.fx).toBeCloseTo(right.fx * s, 6);
    expect(k.cx).toBeCloseTo(right.cx * s, 6);
    expect(k.cy).toBeCloseTo((right.cy - 216) * s, 6);
  });
  it("gives the FOV run 2's (independent) motion fit found: ~73°", () => {
    const hfov = (2 * Math.atan(640 / k.fx) * 180) / Math.PI;
    expect(hfov).toBeGreaterThan(72.5);
    expect(hfov).toBeLessThan(74);
  });
});

describe("camera pose (factory, Meta's convention)", () => {
  it("the optical axis points forward and ~6° down, as the hardware is mounted", () => {
    const o = cameraToHead({ x: 0, y: 0, z: 0 }, right);
    const a = cameraToHead({ x: 0, y: 0, z: 1 }, right);
    const dir = { x: a.x - o.x, y: a.y - o.y, z: a.z - o.z };
    expect(dir.z).toBeLessThan(-0.99); // forward is -z in the head frame
    const pitchDeg = (Math.atan2(dir.y, -dir.z) * 180) / Math.PI;
    expect(pitchDeg).toBeGreaterThan(-7);
    expect(pitchDeg).toBeLessThan(-5.5);
  });
  it("image-up is head-up, image-right is head-right (no mirror, no flip)", () => {
    const o = cameraToHead({ x: 0, y: 0, z: 0 }, right);
    const up = cameraToHead({ x: 0, y: -1, z: 0 }, right); // camera y points DOWN
    const r = cameraToHead({ x: 1, y: 0, z: 0 }, right);
    expect(up.y - o.y).toBeGreaterThan(0.9);
    expect(r.x - o.x).toBeGreaterThan(0.9);
  });
  it("the lens sits 3 cm right, 1.3 cm down, 7.5 cm forward of the head origin", () => {
    const o = cameraToHead({ x: 0, y: 0, z: 0 }, right);
    expect(o.x).toBeCloseTo(0.031, 3);
    expect(o.y).toBeCloseTo(-0.0135, 3);
    expect(o.z).toBeCloseTo(-0.075, 3);
  });
  it("headToCamera inverts cameraToHead", () => {
    const p = { x: 0.1, y: -0.2, z: -0.9 };
    const back = cameraToHead(headToCamera(p, right), right);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
    expect(back.z).toBeCloseTo(p.z, 9);
  });
});

function landmarks(points: Record<number, { x: number; y: number; z?: number }>) {
  const out = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [i, p] of Object.entries(points)) out[Number(i)] = { z: 0, ...p };
  return out;
}

describe("landmarkInHead", () => {
  it("round-trips a face 1 m ahead of the head through the real camera model", () => {
    // Outer eye corners 9.5 cm apart, eye line 1 m in front of the head at eye height.
    const eyeR = { x: -0.0475, y: 0, z: -1 };
    const eyeL = { x: 0.0475, y: 0, z: -1 };
    const nose = { x: 0, y: -0.04, z: -0.97 };
    const iR = projectToImage(eyeR, right, k);
    const iL = projectToImage(eyeL, right, k);
    const iN = projectToImage(nose, right, k);
    // MediaPipe z: relative depth in x-normalised units. Eye line 0; nose 3 cm nearer.
    const unitsPerM = Math.hypot(iL.x - iR.x, (iL.y - iR.y) * (960 / 1280)) / 0.095;
    const lm = landmarks({
      [LM.rightEyeOuter]: { x: iR.x, y: iR.y },
      [LM.leftEyeOuter]: { x: iL.x, y: iL.y },
      [LM.noseTip]: { x: iN.x, y: iN.y, z: -0.03 * unitsPerM },
      [LM.forehead]: { x: iN.x, y: iN.y - 0.1 },
      [LM.chin]: { x: iN.x, y: iN.y + 0.1 },
    });
    const s = sampleFromLandmarks(lm, 1280 / 960)!;
    const got = landmarkInHead(lm[LM.noseTip], 0, s, right, k, 0.095)!;
    // The eye span is foreshortened slightly off-axis, so allow a cm or so.
    expect(Math.hypot(got.x - nose.x, got.y - nose.y, got.z - nose.z)).toBeLessThan(0.015);
    const eye = landmarkInHead(lm[LM.rightEyeOuter], 0, s, right, k, 0.095)!;
    expect(Math.hypot(eye.x - eyeR.x, eye.y - eyeR.y, eye.z - eyeR.z)).toBeLessThan(0.015);
  });

  it("a wrong eye span moves the point ALONG the camera ray only", () => {
    const pt = { x: 0.55, y: 0.45, z: 0 };
    const s = { center: { x: 0.55, y: 0.45 }, eyeSpan: 0.06, faceHeight: 0.2 };
    const a = landmarkInHead(pt, 0, s, right, k, 0.095)!;
    const b = landmarkInHead(pt, 0, s, right, k, 0.12)!;
    const o = cameraToHead({ x: 0, y: 0, z: 0 }, right);
    const da = { x: a.x - o.x, y: a.y - o.y, z: a.z - o.z };
    const db = { x: b.x - o.x, y: b.y - o.y, z: b.z - o.z };
    const cos = (da.x * db.x + da.y * db.y + da.z * db.z) / (Math.hypot(da.x, da.y, da.z) * Math.hypot(db.x, db.y, db.z));
    expect(cos).toBeCloseTo(1, 9);
  });

  it("eyeLineDepth rejects a degenerate span", () => {
    expect(eyeLineDepth({ center: { x: 0.5, y: 0.5 }, eyeSpan: 0, faceHeight: 0 }, k, 0.095)).toBeNaN();
  });
});

describe("profileForLabel", () => {
  it("camera 1 → left, camera 2 → right, override wins", () => {
    expect(profileForLabel("camera 1, facing back").name).toBe("left");
    expect(profileForLabel("camera 2, facing back").name).toBe("right");
    expect(profileForLabel("camera 2, facing back", "left").name).toBe("left");
  });
});

describe("sampleFromLandmarks / centerJitter", () => {
  it("returns null when landmarks are missing", () => {
    expect(sampleFromLandmarks([] as Pt2[], 1)).toBeNull();
  });
  it("measures spread", () => {
    const a = { center: { x: 0.4, y: 0.5 }, eyeSpan: 0.04, faceHeight: 0.1 };
    const b = { center: { x: 0.6, y: 0.5 }, eyeSpan: 0.06, faceHeight: 0.2 };
    expect(centerJitter([a, b])).toBeCloseTo(0.1);
  });
});


describe("triangulate (stereo depth)", () => {
  const left = QUEST_3S_CAMERAS.left;
  const kL = streamIntrinsics(left, 1280, 960);
  it("recovers a point seen by both calibrated cameras, with no size assumption", () => {
    for (const P of [
      { x: 0.02, y: -0.05, z: -0.7 },
      { x: -0.1, y: 0.08, z: -1.3 },
      { x: 0.0, y: 0.0, z: -2.0 },
    ]) {
      const r = triangulate(projectToImage(P, left, kL), left, kL, projectToImage(P, right, k), right, k)!;
      expect(r.gapM).toBeLessThan(1e-6);
      expect(Math.hypot(r.point.x - P.x, r.point.y - P.y, r.point.z - P.z)).toBeLessThan(1e-6);
    }
  });
  it("one pixel of disagreement at 1 m costs ~2 cm of depth, not more", () => {
    const P = { x: 0, y: 0, z: -1 };
    const pl = projectToImage(P, left, kL);
    const r = triangulate({ x: pl.x + 1 / 1280, y: pl.y }, left, kL, projectToImage(P, right, k), right, k)!;
    expect(Math.abs(r.point.z - P.z)).toBeLessThan(0.03);
  });
  it("rejects a mismatched pair whose rays meet behind the cameras", () => {
    const P = { x: 0, y: 0, z: -1 };
    const pl = projectToImage(P, left, kL);
    const pr = projectToImage(P, right, k);
    // Swap which camera saw which point: the rays now diverge.
    expect(triangulate({ x: pr.x - 0.2, y: pr.y }, left, kL, { x: pl.x + 0.2, y: pl.y }, right, k)).toBeNull();
  });
});
