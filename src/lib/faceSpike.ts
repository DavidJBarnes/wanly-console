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
