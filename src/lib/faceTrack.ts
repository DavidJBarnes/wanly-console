// Full head mode (console#753): after the first lock the mannequin head is only a TRACKING
// TARGET. Pure parts here, testable without a browser; lib/faceAr wires them in.
//
// Dead reckoning: once placed, the head is held fixed in the room by the headset's own tracking.
// A low-rate background check keeps measuring the mannequin's face (one stereo pair every
// TRACK_INTERVAL_MS) and pools TRACK_WINDOW pairs into a fresh placement. The DriftJudge moves
// the head only when that placement differs by more than the measurement noise AND the next
// independent estimate agrees — so a bump corrects itself in a few seconds and jitter never
// moves her.
import type { Similarity } from "./faceMask";
import type { Vec3 } from "./faceSpike";

export const TRACK_INTERVAL_MS = 300;
export const TRACK_WINDOW = 5;
// The lock's per-pair error was ~1.4 cm median with the head still (POC run 6); a 5-pair median
// is well under 1 cm. A bump of an inch or two is far above these.
export const DRIFT_MOVE_M = 0.012;
export const DRIFT_TURN_DEG = 4;
export const DRIFT_AGREE_M = 0.008;
export const DRIFT_AGREE_DEG = 3;
export const DRIFT_MAX_SCALE = 0.1; // an estimate whose scale is off by more is a bad fit
export const GLIDE_MS = 600;

// Turning toward the viewer. Limited by the real head underneath: past ~20° its face would show
// past her cheek.
export const TURN_MAX_YAW_DEG = 18;
export const TURN_MAX_PITCH_DEG = 8;
export const TURN_TAU_S = 0.5;

const DEG = Math.PI / 180;

/** Apply a placement to a head-space point. */
export function place(p: Similarity, v: Vec3): Vec3 {
  const r = p.rotation;
  const s = p.scale;
  return {
    x: s * (r[0] * v.x + r[1] * v.y + r[2] * v.z) + p.translation.x,
    y: s * (r[3] * v.x + r[4] * v.y + r[5] * v.z) + p.translation.y,
    z: s * (r[6] * v.x + r[7] * v.y + r[8] * v.z) + p.translation.z,
  };
}

/** World point -> head space (inverse of place). */
export function unplace(p: Similarity, w: Vec3): Vec3 {
  const r = p.rotation;
  const d = { x: w.x - p.translation.x, y: w.y - p.translation.y, z: w.z - p.translation.z };
  const k = 1 / p.scale;
  return {
    x: k * (r[0] * d.x + r[3] * d.y + r[6] * d.z),
    y: k * (r[1] * d.x + r[4] * d.y + r[7] * d.z),
    z: k * (r[2] * d.x + r[5] * d.y + r[8] * d.z),
  };
}

/** How far apart two placements are, measured at a head-space probe point (the face centre). */
export function placementDiff(a: Similarity, b: Similarity, probe: Vec3): { moveM: number; turnDeg: number; scaleRatio: number } {
  const pa = place(a, probe);
  const pb = place(b, probe);
  const ra = a.rotation;
  const rb = b.rotation;
  // trace(Raᵀ Rb) = 1 + 2 cos θ
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += ra[j * 3 + i] * rb[j * 3 + i];
  const cos = Math.min(1, Math.max(-1, (tr - 1) / 2));
  return {
    moveM: Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z),
    turnDeg: Math.acos(cos) / DEG,
    scaleRatio: b.scale / a.scale,
  };
}

export type DriftVerdict = { kind: "hold" } | { kind: "wait" } | { kind: "move"; to: Similarity };

/** Decides whether fresh placement estimates mean the mannequin really moved. */
export class DriftJudge {
  private pending: Similarity | null = null;
  private probe: Vec3;

  constructor(probe: Vec3) {
    this.probe = probe;
  }

  reset() {
    this.pending = null;
  }

  judge(current: Similarity, estimate: Similarity): DriftVerdict {
    const d = placementDiff(current, estimate, this.probe);
    if (Math.abs(d.scaleRatio - 1) > DRIFT_MAX_SCALE) {
      return { kind: "hold" }; // a bad fit, not a move; keep any pending evidence
    }
    if (d.moveM < DRIFT_MOVE_M && d.turnDeg < DRIFT_TURN_DEG) {
      this.pending = null;
      return { kind: "hold" };
    }
    const prev = this.pending;
    if (prev) {
      const agree = placementDiff(prev, estimate, this.probe);
      if (agree.moveM <= DRIFT_AGREE_M && agree.turnDeg <= DRIFT_AGREE_DEG) {
        this.pending = null;
        return { kind: "move", to: estimate };
      }
    }
    this.pending = estimate;
    return { kind: "wait" };
  }
}

/** Yaw/pitch (radians, clamped) that turn the head's +z (her facing) toward a head-space point. */
export function lookAngles(target: Vec3, pivot: Vec3): { yaw: number; pitch: number } {
  const dx = target.x - pivot.x;
  const dy = target.y - pivot.y;
  const dz = target.z - pivot.z;
  if (dz <= 0) return { yaw: 0, pitch: 0 }; // behind her: stay put
  const clamp = (v: number, m: number) => Math.max(-m * DEG, Math.min(m * DEG, v));
  return {
    yaw: clamp(Math.atan2(dx, dz), TURN_MAX_YAW_DEG),
    pitch: clamp(Math.atan2(dy, Math.hypot(dx, dz)), TURN_MAX_PITCH_DEG),
  };
}

/** Exponential approach of `cur` to `target` over dtS seconds with time constant tauS. */
export function approach(cur: number, target: number, dtS: number, tauS = TURN_TAU_S): number {
  return target + (cur - target) * Math.exp(-Math.max(0, dtS) / tauS);
}
