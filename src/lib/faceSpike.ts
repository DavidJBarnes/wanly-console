// Pure maths for the AR face-replacement spike (console#730).
//
// The question the spike answers is whether a mannequin's face, found by MediaPipe in a
// passthrough-camera frame, can be put back into world space accurately enough to pin
// something on it. Quest Browser exposes no camera intrinsics or extrinsics to the web, so
// everything here is an *approximation with knobs*: a pinhole camera of assumed horizontal FOV,
// sitting at an assumed offset from the XR viewer pose, with depth inferred from the apparent
// size of a known facial span. The knobs exist so the error can be measured, not hidden.
//
// Framework-free (plain {x,y,z}) so it tests without three.js or a headset.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Normalised image point, MediaPipe convention: (0,0) top-left, (1,1) bottom-right. */
export interface Pt2 {
  x: number;
  y: number;
}

/** MediaPipe face-mesh indices used by the spike. */
export const LM = {
  rightEyeOuter: 33,
  leftEyeOuter: 263,
  noseTip: 1,
  forehead: 10,
  chin: 152,
} as const;

export interface CameraModel {
  hfovDeg: number; // horizontal field of view of the frames MediaPipe sees
  width: number; // frame size in pixels (only the aspect ratio matters for the ray)
  height: number;
}

/**
 * Ray direction in *camera* space (WebXR/three convention: +x right, +y up, looking down -z)
 * through a normalised image point. Not normalised: z is always -1, so `dir * depth` lands at
 * that depth along the optical axis.
 */
export function pixelRay(p: Pt2, cam: CameraModel): Vec3 {
  const tanH = Math.tan((cam.hfovDeg * Math.PI) / 360);
  const tanV = tanH * (cam.height / cam.width);
  return {
    x: (p.x * 2 - 1) * tanH,
    y: (1 - p.y * 2) * tanV,
    z: -1,
  };
}

/**
 * Depth (metres along the optical axis) of a span of known real width that appears `spanNorm`
 * wide in normalised image x. Assumes the span is roughly fronto-parallel, which holds for a
 * mannequin you are facing; a turned head under-reads its width and over-reads the depth.
 */
export function depthFromSpan(spanNorm: number, realWidthM: number, cam: CameraModel): number {
  if (spanNorm <= 0) return NaN;
  const tanH = Math.tan((cam.hfovDeg * Math.PI) / 360);
  // span in normalised x maps to (spanNorm * 2 * tanH) units at depth 1
  return realWidthM / (spanNorm * 2 * tanH);
}

export interface FaceSample {
  center: Pt2; // midpoint between the outer eye corners, nudged toward the nose
  eyeSpan: number; // normalised image distance between outer eye corners
  faceHeight: number; // normalised forehead→chin distance (for sizing the oval)
}

/** Reduce a 478-point MediaPipe landmark set to what the spike needs. */
export function sampleFromLandmarks(lm: readonly Pt2[], aspect: number): FaceSample | null {
  const r = lm[LM.rightEyeOuter];
  const l = lm[LM.leftEyeOuter];
  const nose = lm[LM.noseTip];
  const top = lm[LM.forehead];
  const chin = lm[LM.chin];
  if (!r || !l || !nose || !top || !chin) return null;
  // Distances in x-normalised units: y is scaled by height/width so both axes share a unit.
  const inv = 1 / aspect; // aspect = width / height
  const eyeSpan = Math.hypot(l.x - r.x, (l.y - r.y) * inv);
  const faceHeight = Math.hypot(chin.x - top.x, (chin.y - top.y) * inv);
  // Face centre: halfway from the eye line to the nose tip — roughly the middle of the oval.
  const eyeMid = { x: (r.x + l.x) / 2, y: (r.y + l.y) / 2 };
  const center = { x: (eyeMid.x + nose.x) / 2, y: (eyeMid.y + nose.y) / 2 };
  return { center, eyeSpan, faceHeight };
}

/** Mean of samples (the lock averages ~1 s of detections to kill jitter). */
export function averageSamples(s: readonly FaceSample[]): FaceSample | null {
  if (!s.length) return null;
  const n = s.length;
  let cx = 0;
  let cy = 0;
  let es = 0;
  let fh = 0;
  for (const v of s) {
    cx += v.center.x;
    cy += v.center.y;
    es += v.eyeSpan;
    fh += v.faceHeight;
  }
  return { center: { x: cx / n, y: cy / n }, eyeSpan: es / n, faceHeight: fh / n };
}

/** Spread of the samples' centres in normalised x — reported so jitter is visible on the HUD. */
export function centerJitter(s: readonly FaceSample[]): number {
  const m = averageSamples(s);
  if (!m || s.length < 2) return 0;
  let acc = 0;
  for (const v of s) acc += (v.center.x - m.center.x) ** 2 + (v.center.y - m.center.y) ** 2;
  return Math.sqrt(acc / s.length);
}

export interface FaceInCamera {
  position: Vec3; // camera space, metres
  heightM: number; // forehead→chin, metres (sizes the placeholder)
}

/** Back-project an averaged sample into camera space. */
export function faceInCamera(
  s: FaceSample,
  cam: CameraModel,
  eyeSpanM: number,
): FaceInCamera | null {
  const depth = depthFromSpan(s.eyeSpan, eyeSpanM, cam);
  if (!Number.isFinite(depth)) return null;
  const ray = pixelRay(s.center, cam);
  return {
    position: { x: ray.x * depth, y: ray.y * depth, z: ray.z * depth },
    heightM: s.faceHeight * (eyeSpanM / s.eyeSpan),
  };
}

// ---------------------------------------------------------------------------------------------
// Self-calibration.
//
// The face is static in the room. With the RIGHT camera model, every detection back-projects to
// the same world point however the head moves; with a wrong one, the point swims as the head
// moves (the "dot drifts when I look down" symptom). So calibration = find the camera model that
// minimises the spread of the back-projected points over a few seconds of head motion. No user
// precision needed, only motion: side to side (translation) and up/down (pitch) make every
// parameter observable. A pure yaw-only head turn cannot reveal a yaw offset, hence the prompt.

export interface CamParams {
  hfovDeg: number;
  yawDeg: number; // camera orientation relative to the viewer pose (+yaw = turned left)
  pitchDeg: number; // +pitch = tilted up
  rollDeg: number;
  offX: number; // camera position relative to the viewer, metres, viewer space
  offY: number;
  offZ: number;
  flipX: boolean; // image is mirrored left↔right
}

/** Column-major 4x4 rigid transform (XRRigidTransform.matrix layout). */
export type Mat4 = ArrayLike<number>;

export function applyMat4(m: Mat4, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12],
    y: m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13],
    z: m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14],
  };
}

/** Inverse of a rigid column-major transform applied to a point. */
export function applyInvRigid(m: Mat4, v: Vec3): Vec3 {
  const d = { x: v.x - m[12], y: v.y - m[13], z: v.z - m[14] };
  return {
    x: m[0] * d.x + m[1] * d.y + m[2] * d.z,
    y: m[4] * d.x + m[5] * d.y + m[6] * d.z,
    z: m[8] * d.x + m[9] * d.y + m[10] * d.z,
  };
}

type Mat3 = [number, number, number, number, number, number, number, number, number]; // row-major

/** R = Ry(yaw) · Rx(pitch) · Rz(roll). */
export function rotation(yawDeg: number, pitchDeg: number, rollDeg: number): Mat3 {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const r = (rollDeg * Math.PI) / 180;
  const cy = Math.cos(y), sy = Math.sin(y);
  const cp = Math.cos(p), sp = Math.sin(p);
  const cr = Math.cos(r), sr = Math.sin(r);
  // Ry·Rx
  const a: Mat3 = [cy, sy * sp, sy * cp, 0, cp, -sp, -sy, cy * sp, cy * cp];
  // (Ry·Rx)·Rz
  return [
    a[0] * cr + a[1] * sr, -a[0] * sr + a[1] * cr, a[2],
    a[3] * cr + a[4] * sr, -a[3] * sr + a[4] * cr, a[5],
    a[6] * cr + a[7] * sr, -a[6] * sr + a[7] * cr, a[8],
  ];
}

const mul3 = (m: Mat3, v: Vec3): Vec3 => ({
  x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
  y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
  z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
});
const mul3T = (m: Mat3, v: Vec3): Vec3 => ({
  x: m[0] * v.x + m[3] * v.y + m[6] * v.z,
  y: m[1] * v.x + m[4] * v.y + m[7] * v.z,
  z: m[2] * v.x + m[5] * v.y + m[8] * v.z,
});

/** Face position in VIEWER space under a camera model. */
export function faceInViewer(
  s: FaceSample,
  p: CamParams,
  eyeSpanM: number,
  aspect: number,
  rot: Mat3 = rotation(p.yawDeg, p.pitchDeg, p.rollDeg),
): Vec3 | null {
  const cam: CameraModel = { hfovDeg: p.hfovDeg, width: aspect, height: 1 };
  const sample = p.flipX ? { ...s, center: { x: 1 - s.center.x, y: s.center.y } } : s;
  const f = faceInCamera(sample, cam, eyeSpanM);
  if (!f) return null;
  const v = mul3(rot, f.position);
  return { x: v.x + p.offX, y: v.y + p.offY, z: v.z + p.offZ };
}

/** Inverse of faceInViewer: what the camera would report for a face at world point P. */
export function projectFace(
  P: Vec3,
  viewer: Mat4,
  p: CamParams,
  eyeSpanM: number,
  aspect: number,
): FaceSample {
  const q = applyInvRigid(viewer, P);
  const c = mul3T(rotation(p.yawDeg, p.pitchDeg, p.rollDeg), {
    x: q.x - p.offX,
    y: q.y - p.offY,
    z: q.z - p.offZ,
  });
  const depth = -c.z;
  const tanH = Math.tan((p.hfovDeg * Math.PI) / 360);
  const tanV = tanH / aspect;
  let x = (c.x / depth / tanH + 1) / 2;
  const y = (1 - c.y / depth / tanV) / 2;
  if (p.flipX) x = 1 - x;
  return { center: { x, y }, eyeSpan: eyeSpanM / (depth * 2 * tanH), faceHeight: 0 };
}

export interface CalSample {
  sample: FaceSample;
  /** Viewer pose at each candidate camera latency (index = LATENCIES_MS index). */
  viewers: Mat4[];
}

/** Camera-to-display latencies tried by the calibration (the frame is older than the pose). */
export const LATENCIES_MS = [0, 33, 66, 100, 133, 166];

/** RMS distance (m) of the samples' world points from their mean. */
export function spreadM(
  samples: readonly CalSample[],
  p: CamParams,
  eyeSpanM: number,
  aspect: number,
  latencyIdx = 0,
): number {
  const rot = rotation(p.yawDeg, p.pitchDeg, p.rollDeg);
  const pts: Vec3[] = [];
  for (const s of samples) {
    const v = faceInViewer(s.sample, p, eyeSpanM, aspect, rot);
    const m = s.viewers[latencyIdx] ?? s.viewers[0];
    if (v && m) pts.push(applyMat4(m, v));
  }
  if (pts.length < 2) return Infinity;
  const c = pts.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }), { x: 0, y: 0, z: 0 });
  c.x /= pts.length;
  c.y /= pts.length;
  c.z /= pts.length;
  let acc = 0;
  for (const q of pts) acc += (q.x - c.x) ** 2 + (q.y - c.y) ** 2 + (q.z - c.z) ** 2;
  return Math.sqrt(acc / pts.length);
}

/** Minimal Nelder–Mead. Small, dependency-free, plenty for 6 parameters. */
export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  steps: number[],
  iters = 600,
): { x: number[]; fx: number } {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + steps[i] : v)))].map(
    (x) => ({ x, fx: f(x) }),
  );
  for (let it = 0; it < iters; it++) {
    simplex.sort((a, b) => a.fx - b.fx);
    const best = simplex[0], worst = simplex[n], second = simplex[n - 1];
    const centroid = Array.from({ length: n }, (_, j) =>
      simplex.slice(0, n).reduce((acc, s) => acc + s.x[j], 0) / n,
    );
    const along = (t: number) => centroid.map((c, j) => c + t * (worst.x[j] - c));
    const r = along(-1);
    const fr = f(r);
    if (fr < best.fx) {
      const e = along(-2);
      const fe = f(e);
      simplex[n] = fe < fr ? { x: e, fx: fe } : { x: r, fx: fr };
    } else if (fr < second.fx) {
      simplex[n] = { x: r, fx: fr };
    } else {
      const c = fr < worst.fx ? along(-0.5) : along(0.5);
      const fc = f(c);
      if (fc < Math.min(fr, worst.fx)) simplex[n] = { x: c, fx: fc };
      else
        simplex = simplex.map((s, i) =>
          i === 0 ? s : { x: s.x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j])), fx: NaN },
        ).map((s) => (Number.isNaN(s.fx) ? { x: s.x, fx: f(s.x) } : s));
    }
  }
  simplex.sort((a, b) => a.fx - b.fx);
  return { x: simplex[0].x, fx: simplex[0].fx };
}

export interface CalResult {
  params: CamParams;
  latencyMs: number;
  spreadBeforeCm: number;
  spreadAfterCm: number;
  /** How far the head travelled (RMS, cm). Small travel = weak calibration; say so. */
  headTravelCm: number;
  samples: number;
}

const BOUNDS = {
  hfovDeg: [40, 120],
  yawDeg: [-30, 30],
  pitchDeg: [-30, 30],
  rollDeg: [-30, 30],
  offX: [-0.1, 0.1],
  offY: [-0.1, 0.1],
} as const;

/**
 * Fit hfov, yaw, pitch, roll and the x/y camera offset (offZ is left alone: it trades almost
 * exactly against depth) for each mirror setting and candidate latency; keep the best.
 */
export function calibrate(
  samples: readonly CalSample[],
  start: CamParams,
  eyeSpanM: number,
  aspect: number,
): CalResult | null {
  if (samples.length < 10) return null;
  const keys = ["hfovDeg", "yawDeg", "pitchDeg", "rollDeg", "offX", "offY"] as const;
  const steps = [10, 5, 5, 5, 0.02, 0.02];
  let best: { params: CamParams; latencyIdx: number; fx: number } | null = null;

  for (const flipX of [false, true]) {
    for (let li = 0; li < LATENCIES_MS.length; li++) {
      const toParams = (x: number[]): CamParams => {
        const p = { ...start, flipX };
        keys.forEach((k, i) => (p[k] = x[i]));
        return p;
      };
      const objective = (x: number[]) => {
        let penalty = 0;
        keys.forEach((k, i) => {
          const [lo, hi] = BOUNDS[k];
          if (x[i] < lo) penalty += (lo - x[i]) * 10;
          if (x[i] > hi) penalty += (x[i] - hi) * 10;
        });
        return spreadM(samples, toParams(x), eyeSpanM, aspect, li) + penalty;
      };
      // Restart once from the first result: Nelder–Mead stalls on long valleys.
      let r = nelderMead(objective, keys.map((k) => start[k] as number), steps);
      r = nelderMead(objective, r.x, steps.map((s) => s / 2));
      if (!best || r.fx < best.fx) best = { params: toParams(r.x), latencyIdx: li, fx: r.fx };
    }
  }
  if (!best) return null;

  const heads = samples.map((s) => ({ x: s.viewers[0][12], y: s.viewers[0][13], z: s.viewers[0][14] }));
  const hc = heads.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }), { x: 0, y: 0, z: 0 });
  const n = heads.length;
  const travel = Math.sqrt(
    heads.reduce((acc, h) => acc + (h.x - hc.x / n) ** 2 + (h.y - hc.y / n) ** 2 + (h.z - hc.z / n) ** 2, 0) / n,
  );

  return {
    params: best.params,
    latencyMs: LATENCIES_MS[best.latencyIdx],
    spreadBeforeCm: spreadM(samples, start, eyeSpanM, aspect, 0) * 100,
    spreadAfterCm: spreadM(samples, best.params, eyeSpanM, aspect, best.latencyIdx) * 100,
    headTravelCm: travel * 100,
    samples: samples.length,
  };
}
