import { describe, expect, it } from "vitest";
import type { Similarity } from "./faceMask";
import {
  approach, DriftJudge, lookAngles, place, placementDiff, TURN_MAX_PITCH_DEG, TURN_MAX_YAW_DEG, unplace,
} from "./faceTrack";

const DEG = Math.PI / 180;
const rotY = (a: number) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const P = (x: number, yawDeg = 0, scale = 0.001): Similarity => ({
  scale, rotation: rotY(yawDeg * DEG), translation: { x, y: 1.2, z: -0.8 }, rmsM: 0,
});
const probe = { x: 0, y: 0, z: 0 };

describe("placements", () => {
  it("unplace inverts place", () => {
    const p = P(0.3, 25, 0.0012);
    const v = { x: 40, y: -70, z: 15 };
    const back = unplace(p, place(p, v));
    expect(back.x).toBeCloseTo(v.x, 6);
    expect(back.y).toBeCloseTo(v.y, 6);
    expect(back.z).toBeCloseTo(v.z, 6);
  });
  it("measures move and turn", () => {
    const d = placementDiff(P(0), P(0.03, 10), probe);
    expect(d.moveM).toBeCloseTo(0.03, 6);
    expect(d.turnDeg).toBeCloseTo(10, 4);
    expect(d.scaleRatio).toBeCloseTo(1, 9);
  });
});

describe("DriftJudge", () => {
  it("never moves for measurement noise", () => {
    const j = new DriftJudge(probe);
    for (const dx of [0.004, -0.006, 0.009, -0.002, 0.007]) expect(j.judge(P(0), P(dx, 1.5)).kind).toBe("hold");
  });
  it("moves after two agreeing estimates of a real bump (2.5 cm)", () => {
    const j = new DriftJudge(probe);
    expect(j.judge(P(0), P(0.025)).kind).toBe("wait");
    const v = j.judge(P(0), P(0.028));
    expect(v.kind).toBe("move");
    if (v.kind === "move") expect(v.to.translation.x).toBeCloseTo(0.028);
  });
  it("does not move on two disagreeing outliers", () => {
    const j = new DriftJudge(probe);
    expect(j.judge(P(0), P(0.03)).kind).toBe("wait");
    expect(j.judge(P(0), P(-0.03)).kind).toBe("wait");
    expect(j.judge(P(0), P(0.001)).kind).toBe("hold"); // and quiet again clears it
    expect(j.judge(P(0), P(-0.03)).kind).toBe("wait");
  });
  it("treats a wrong-scale fit as bad evidence, not a move", () => {
    const j = new DriftJudge(probe);
    expect(j.judge(P(0), P(0.05, 0, 0.0013)).kind).toBe("hold");
  });
  it("catches a twist with no slide", () => {
    const j = new DriftJudge(probe);
    expect(j.judge(P(0), P(0, 8)).kind).toBe("wait");
    expect(j.judge(P(0), P(0, 9)).kind).toBe("move");
  });
});

describe("turning toward the viewer", () => {
  const pivot = { x: 0, y: 0, z: 0 };
  it("faces a viewer straight ahead", () => {
    const a = lookAngles({ x: 0, y: 0, z: 800 }, pivot);
    expect(a.yaw).toBeCloseTo(0);
    expect(a.pitch).toBeCloseTo(0);
  });
  it("turns toward +x for a viewer off to +x, within the limit", () => {
    const a = lookAngles({ x: 100, y: 0, z: 800 }, pivot);
    expect(a.yaw).toBeCloseTo(Math.atan2(100, 800));
  });
  it("clamps yaw and pitch", () => {
    const a = lookAngles({ x: 800, y: 800, z: 300 }, pivot);
    expect(a.yaw).toBeCloseTo(TURN_MAX_YAW_DEG * DEG);
    expect(a.pitch).toBeCloseTo(TURN_MAX_PITCH_DEG * DEG);
  });
  it("stays put for a viewer behind her", () => {
    expect(lookAngles({ x: 100, y: 0, z: -500 }, pivot)).toEqual({ yaw: 0, pitch: 0 });
  });
  it("approaches smoothly", () => {
    expect(approach(0, 1, 0.5, 0.5)).toBeCloseTo(1 - Math.exp(-1));
    expect(approach(0.3, 1, 0)).toBeCloseTo(0.3, 12);
  });
});
