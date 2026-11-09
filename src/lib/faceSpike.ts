// Maths for the AR face-replacement spike (console#730).
//
// Runs 1-3 tried to GUESS the passthrough camera's model (FOV, orientation, offset) and then to
// infer it from head motion. Both failed: the browser exposes no intrinsics, and the motion fit
// is ill-conditioned (run 3 collapsed onto a tiny, too-close face). The camera's real calibration
// is stored on the headset and readable over adb:
//
//   adb shell dumpsys media.camera   → android.lens.intrinsicCalibration / poseTranslation /
//                                      poseRotation per camera (Camera2 ids 50 = left, 51 = right)
//
// so this file now uses those factory numbers, converted exactly as Meta's own
// PassthroughCameraUtils.cs (oculus-samples/Unity-PassthroughCameraApiSamples, first release)
// does. Nothing is fitted any more. The only estimate left is the face's distance, from its eye
// span — and because the camera sits a few cm from the eyes, a distance error barely moves the
// dots as seen from where you stand.
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

/** A landmark with MediaPipe's relative depth (z: same scale as x, negative = toward camera). */
export interface Pt3 extends Pt2 {
  z: number;
}

/** MediaPipe face-mesh indices used by the spike. */
export const LM = {
  rightEyeOuter: 33,
  leftEyeOuter: 263,
  noseTip: 1,
  forehead: 10,
  chin: 152,
} as const;

/** MediaPipe iris centres (present with the 478-point model) and the nose tip. */
export const MARKERS = { rightIris: 468, leftIris: 473, noseTip: 1 } as const;

/**
 * One passthrough camera's factory calibration, verbatim from Camera2 characteristics.
 * Intrinsics are in pixels of the pre-correction active array (the full sensor). The pose is
 * the lens relative to the head, in the head's right-handed frame (x right, y up, z back — the
 * same convention as a WebXR viewer pose), with the rotation mapping head → camera coordinates.
 */
export interface CameraProfile {
  name: string;
  camera2Id: string;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  sensorW: number;
  sensorH: number;
  translation: Vec3;
  rotation: [number, number, number, number]; // quaternion x, y, z, w
}

/**
 * David's Quest 3S (serial 340YC10GCM01VX), read 2026-11-09 with `adb shell dumpsys
 * media.camera`. Factory calibration is per unit, so another headset needs its own numbers.
 */
export const QUEST_3S_CAMERAS: Record<"left" | "right", CameraProfile> = {
  left: {
    name: "left",
    camera2Id: "50",
    fx: 1161.56445312,
    fy: 1161.56445312,
    cx: 864.95513916,
    cy: 867.21362305,
    sensorW: 1728,
    sensorH: 1728,
    translation: { x: -0.03275418, y: -0.01352536, z: -0.07538728 },
    rotation: [-0.99844104, 0.00215039, -0.00129105, 0.05575979],
  },
  right: {
    name: "right",
    camera2Id: "51",
    fx: 1156.54199219,
    fy: 1156.54199219,
    cx: 862.06488037,
    cy: 861.03601074,
    sensorW: 1728,
    sensorH: 1728,
    translation: { x: 0.03097726, y: -0.01346973, z: -0.07522405 },
    rotation: [-0.99850672, 0.00270247, 0.00196748, 0.05452614],
  },
};

export interface StreamIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/**
 * Intrinsics for a stream of `width`×`height`. Camera2 makes a smaller stream by cropping the
 * sensor, centred, to the stream's aspect ratio and then scaling — so 1280×960 from the
 * 1728×1728 sensor keeps the full width and the middle 1296 rows.
 */
export function streamIntrinsics(p: CameraProfile, width: number, height: number): StreamIntrinsics {
  const aspect = width / height;
  let cropW = p.sensorW;
  let cropH = p.sensorW / aspect;
  if (cropH > p.sensorH) {
    cropH = p.sensorH;
    cropW = p.sensorH * aspect;
  }
  const offX = (p.sensorW - cropW) / 2;
  const offY = (p.sensorH - cropH) / 2;
  const s = width / cropW;
  return { fx: p.fx * s, fy: p.fy * s, cx: (p.cx - offX) * s, cy: (p.cy - offY) * s, width, height };
}

type Mat3 = [number, number, number, number, number, number, number, number, number]; // row-major

/** Rotation matrix of a unit quaternion (x, y, z, w). */
export function quatToMat3([x, y, z, w]: readonly [number, number, number, number]): Mat3 {
  const n = Math.hypot(x, y, z, w) || 1;
  x /= n;
  y /= n;
  z /= n;
  w /= n;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
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

/**
 * A point in camera coordinates (Camera2 convention: x right, y DOWN, z forward along the optical
 * axis) to head coordinates. The stored rotation maps head → camera, so this applies its inverse
 * and then the lens position — Meta's q_headFromCamera / p_headFromCamera, minus Unity's z flip.
 */
export function cameraToHead(pc: Vec3, p: CameraProfile): Vec3 {
  const v = mul3T(quatToMat3(p.rotation), pc);
  return { x: v.x + p.translation.x, y: v.y + p.translation.y, z: v.z + p.translation.z };
}

/** Inverse of cameraToHead (used by tests to synthesise detections). */
export function headToCamera(ph: Vec3, p: CameraProfile): Vec3 {
  return mul3(quatToMat3(p.rotation), {
    x: ph.x - p.translation.x,
    y: ph.y - p.translation.y,
    z: ph.z - p.translation.z,
  });
}

export interface FaceSample {
  center: Pt2; // midpoint between the outer eye corners, nudged toward the nose
  eyeSpan: number; // normalised image distance between outer eye corners (x-normalised units)
  faceHeight: number; // normalised forehead→chin distance
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
  const eyeMid = { x: (r.x + l.x) / 2, y: (r.y + l.y) / 2 };
  const center = { x: (eyeMid.x + nose.x) / 2, y: (eyeMid.y + nose.y) / 2 };
  return { center, eyeSpan, faceHeight };
}

/** Spread of the samples' centres in normalised x — reported so jitter is visible. */
export function centerJitter(s: readonly FaceSample[]): number {
  if (s.length < 2) return 0;
  const mx = s.reduce((a, v) => a + v.center.x, 0) / s.length;
  const my = s.reduce((a, v) => a + v.center.y, 0) / s.length;
  let acc = 0;
  for (const v of s) acc += (v.center.x - mx) ** 2 + (v.center.y - my) ** 2;
  return Math.sqrt(acc / s.length);
}

/**
 * Distance of the eye line along the optical axis, from the apparent eye span. Assumes the face
 * is roughly square-on to the camera, which holds when you are looking at it.
 */
export function eyeLineDepth(s: FaceSample, k: StreamIntrinsics, eyeSpanM: number): number {
  const spanPx = s.eyeSpan * k.width;
  return spanPx > 0 ? (k.fx * eyeSpanM) / spanPx : NaN;
}

/**
 * Head-frame position of one landmark (an iris, the nose tip). Its pixel gives the exact ray;
 * the eye-span distance plus MediaPipe's relative z gives how far along it.
 */
export function landmarkInHead(
  pt: Pt3,
  eyeLineZ: number,
  s: FaceSample,
  p: CameraProfile,
  k: StreamIntrinsics,
  eyeSpanM: number,
): Vec3 | null {
  const depth = eyeLineDepth(s, k, eyeSpanM);
  if (!Number.isFinite(depth)) return null;
  const metresPerUnit = eyeSpanM / s.eyeSpan; // normalised-x units → metres at the face
  const d = depth + (pt.z - eyeLineZ) * metresPerUnit;
  const u = pt.x * k.width;
  const v = pt.y * k.height;
  return cameraToHead({ x: ((u - k.cx) / k.fx) * d, y: ((v - k.cy) / k.fy) * d, z: d }, p);
}

/** Normalised image point at which a head-frame point appears (tests; inverse of the above). */
export function projectToImage(ph: Vec3, p: CameraProfile, k: StreamIntrinsics): Pt2 & { depth: number } {
  const c = headToCamera(ph, p);
  return { x: (k.fx * (c.x / c.z) + k.cx) / k.width, y: (k.fy * (c.y / c.z) + k.cy) / k.height, depth: c.z };
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

/**
 * Which factory profile a browser camera is. Quest Browser labels the room-facing cameras
 * "camera 1, facing back" and "camera 2, facing back"; they are assumed to be Camera2 ids 50
 * (left) and 51 (right) in that order. `override` exists because that order is an inference.
 */
export function profileForLabel(label: string, override?: "left" | "right" | null): CameraProfile {
  if (override) return QUEST_3S_CAMERAS[override];
  return /camera 1\b/i.test(label) ? QUEST_3S_CAMERAS.left : QUEST_3S_CAMERAS.right;
}
