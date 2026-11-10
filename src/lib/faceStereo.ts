// Stereo placement shared by the AR face POC (pages/FaceSpike) and the Face Loops player
// (lib/faceAr). Measured on the POC (console#730, #739) — see the notes on each constant.
import { QUEST_3S_CAMERAS, LM, MARKERS, streamIntrinsics, triangulate } from "./faceSpike";
import type { Pt3, Vec3 } from "./faceSpike";

export const RIGHT = QUEST_3S_CAMERAS.right;
export const LEFT = QUEST_3S_CAMERAS.left;

export const LOCK_SECONDS = 1.0;
export const LOCK_MIN_SAMPLES = 8;
export const POSE_HISTORY_MS = 500;
// Left/right detections are paired only if they ran this close together (ms). The two cameras
// are not frame-synchronised; with the head still, a few tens of ms is harmless.
export const STEREO_PAIR_MS = 80;
// Run 6 trace (mannequin, 79 stereo samples): placement error was 1.4 cm median with the head
// still and up to ~8 cm (p90) when turning faster than 40°/s; a few pairs had 2-3 cm ray gaps
// (mismatched frames). The fitted head↔camera correction was noise, so the model stays as is and
// the lock just refuses bad evidence: only steady-head samples, only well-matched pairs, median.
export const LOCK_MAX_TURN_DEG_PER_S = 15;
export const LOCK_MAX_RAY_GAP_M = 0.005;
// Close range (David: "it drops when you get too close"): no lock ever succeeded nearer than
// ~0.5 m — the reports show "bad camera match". With a 6.4 cm baseline the two cameras see the
// face from visibly different angles up close, and SILHOUETTE landmarks (cheek edges, temples)
// land on different skin in each view. So: placement uses only landmarks both cameras see
// face-on, a sample is judged by its MEDIAN point gap (one bad point no longer rejects it), and
// individual bad anchors are dropped instead of the whole sample.
export const PLACE_ANCHORS = [33, 133, 362, 263, 168, 6, 197, 195, 5, 4, 1, 10, 151, 9, 8];
export const ANCHOR_MAX_GAP_M = 0.01;
export const ANCHOR_MIN_SAMPLES = 3;
export const ANCHOR_MIN_COUNT = 8;
// Used only when the browser gives no frame capture time. Runs 2 and 3 independently measured
// ~100 ms between capture and display on this headset.
export const FALLBACK_LATENCY_MS = 100;

/** Landmarks used in stereo: the three dots plus the outer eye corners (for the span check). */
const STEREO_IDS = [MARKERS.rightIris, MARKERS.leftIris, MARKERS.noseTip, LM.rightEyeOuter, LM.leftEyeOuter];

/**
 * Head-frame positions of the iris/iris/nose markers by triangulating the right and left
 * detections. Null if any landmark fails (a mismatched pair). Also reports match quality
 * (median ray gap) and the measured eye span.
 */
export function stereoPoints(
  right: Pt3[],
  left: Pt3[],
  w: number,
  h: number,
): { pts: Vec3[]; gapM: number; eyeSpanM: number } | null {
  const kR = streamIntrinsics(RIGHT, w, h);
  const kL = streamIntrinsics(LEFT, w, h);
  const pts: Vec3[] = [];
  const gaps: number[] = [];
  for (const id of STEREO_IDS) {
    const r = right[id];
    const l = left[id];
    if (!r || !l) return null;
    const t = triangulate(l, LEFT, kL, r, RIGHT, kR);
    if (!t) return null;
    pts.push(t.point);
    gaps.push(t.gapM);
  }
  const [, , , a, b] = pts;
  // Median, not max: one point seen at a different angle by each camera (close range) should not
  // condemn the whole sample.
  const sorted = [...gaps].sort((x, y) => x - y);
  const gap = sorted[sorted.length >> 1];
  return { pts: pts.slice(0, 3), gapM: gap, eyeSpanM: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) };
}

/** Placement anchors (PLACE_ANCHORS) triangulated from a right/left pair, head frame; null where a point fails. */
export function stereoAnchors(right: Pt3[], left: Pt3[], w: number, h: number): (Vec3 | null)[] {
  const kR = streamIntrinsics(RIGHT, w, h);
  const kL = streamIntrinsics(LEFT, w, h);
  return PLACE_ANCHORS.map((id) => {
    const r = right[id];
    const l = left[id];
    if (!r || !l) return null;
    const t = triangulate(l, LEFT, kL, r, RIGHT, kR);
    return t && t.gapM <= ANCHOR_MAX_GAP_M ? t.point : null;
  });
}

export function median(xs: number[]): number {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Per anchor: the median over the samples where it triangulated well, for anchors seen in at
 * least ANCHOR_MIN_SAMPLES samples. Returns the surviving (anchor index, point) pairs.
 */
export function medianAnchors(samples: readonly ((Vec3 | null)[] | null)[]): { index: number; point: Vec3 }[] {
  const out: { index: number; point: Vec3 }[] = [];
  PLACE_ANCHORS.forEach((_, i) => {
    const seen = samples.map((s) => s?.[i]).filter((a): a is Vec3 => !!a);
    if (seen.length < ANCHOR_MIN_SAMPLES) return;
    out.push({ index: i, point: { x: median(seen.map((a) => a.x)), y: median(seen.map((a) => a.y)), z: median(seen.map((a) => a.z)) } });
  });
  return out;
}

/** Head-pose history: the pose at a frame's capture time, and how fast the head is turning. */
export class PoseHistory {
  private h: { t: number; m: number[] }[] = [];

  push(t: number, m: number[]) {
    this.h.push({ t, m });
    while (this.h.length && t - this.h[0].t > POSE_HISTORY_MS) this.h.shift();
  }

  at(t: number): number[] | null {
    let best: { t: number; m: number[] } | null = null;
    for (const x of this.h) if (!best || Math.abs(x.t - t) < Math.abs(best.t - t)) best = x;
    return best?.m ?? null;
  }

  /** Head turn rate (°/s) at time t, from the rotation between t-33 ms and t. */
  turnRate(t: number): number {
    const a = this.at(t);
    const b = this.at(t - 33);
    if (!a || !b) return 0;
    // Angle between the two rotations: trace(Aᵀ·B) of the 3×3 parts (column-major).
    let tr = 0;
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) tr += a[c * 4 + r] * b[c * 4 + r];
    const ang = Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2)));
    return (ang * 180) / Math.PI / 0.033;
  }
}
