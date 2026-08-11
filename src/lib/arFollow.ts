// Viewer-locked AR: settings shape and the pure transform maths behind the follow modes.
//
// Kept out of HologramPlayer.tsx deliberately. The follow behaviour is the part most likely to be
// wrong and the part being tuned by hand, and none of it can be observed from a dev machine —
// so the arithmetic is isolated here where it can be tested without a headset.
//
// Everything below is framework-free (plain {x,y,z}) so the tests need neither three.js nor WebGL.

/**
 * Which transform the player applies per frame. Changes NO pixels — the same mp4, manifest and
 * matte drive every mode — so this is a playback setting, never a generated artifact flavor.
 *
 * - `placed`     hit-test the floor, tap once, stays put in the room (the original behaviour)
 * - `follow`     holds station ahead of the viewer, pitch included: look down and it comes along
 * - `follow-yaw` forward flattened to horizontal: turning carries it, looking down does not
 *
 * Rigid 1:1 head-lock is deliberately not offered — it reads as a sticker on the visor and is a
 * common nausea trigger. `follow` at high tightness approximates it.
 */
export type LockMode = "placed" | "follow" | "follow-yaw";

export interface ArSettings {
  lockMode: LockMode;
  followDistance: number; // metres in front of the viewer
  followHeight: number; // metres relative to eye level (0 = subject centred on the eyeline)
  followTightness: number; // exponential smoothing rate; higher = snappier
  followDeadzone: number; // metres of slack before it starts easing back
  edgeMin: number; // matte cut / smoothstep low
  edgeMax: number; // smoothstep high
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Tier-0's wide soft ramp vs tier-1's tight inner AA. Tier-1 hard-clips at `edgeMin` before
 * shading, so a wide ramp there would re-introduce the translucent skirt the discard exists to
 * kill — the two tiers genuinely want different defaults.
 */
export const EDGE_DEFAULTS = {
  flat: { edgeMin: 0.05, edgeMax: 0.95 },
  depth: { edgeMin: 0.5, edgeMax: 0.72 },
} as const;

export const DEFAULT_AR_SETTINGS: Omit<ArSettings, "edgeMin" | "edgeMax"> = {
  lockMode: "placed",
  followDistance: 1.6,
  followHeight: 0,
  followTightness: 2.5,
  followDeadzone: 0.12,
};

/** Below this distance from the target the clip counts as arrived and the latch releases. */
export const ARRIVE_EPSILON = 0.01;

/**
 * Frame-rate independent exponential smoothing. A plain `lerp(a, b, k)` with a fixed k moves
 * faster on a 120Hz headset than a 72Hz one; this makes the same `rate` feel identical on both.
 */
export function smoothing(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Signed shortest way round the circle, so a yaw crossing ±π eases across instead of spinning. */
export function shortestAngleDelta(from: number, to: number): number {
  const d = to - from;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/**
 * Deadzone latch (hysteresis). Inside the deadzone the clip holds still, so small head movement
 * doesn't drag it; once the viewer drifts out it eases all the way home rather than only back to
 * the boundary. Without the latch it jitters on the edge; without the deadzone it feels clingy.
 */
export function nextEasing(easing: boolean, err: number, deadzone: number): boolean {
  if (!easing && err > deadzone) return true;
  if (easing && err < ARRIVE_EPSILON) return false;
  return easing;
}

/**
 * Flatten a forward vector to the horizontal plane for `follow-yaw`.
 *
 * Returns null when the viewer is looking near-vertically: the horizontal component degenerates
 * and any direction derived from it would be noise, so the caller keeps the previous heading
 * rather than letting the clip snap to an arbitrary bearing.
 */
export function flattenYaw(f: Vec3): Vec3 | null {
  const len = Math.hypot(f.x, f.z);
  if (len < 1e-4) return null;
  return { x: f.x / len, y: 0, z: f.z / len };
}

/**
 * World Y for the group origin. The origin is the subject's floor plane (the quad sits at
 * +height/2), so centring the subject `offset` metres from the eyeline means dropping the origin
 * by half the subject height.
 */
export function followOriginY(eyeY: number, offset: number, height: number): number {
  return eyeY + offset - height / 2;
}

/** Where the clip wants to be this frame, given the viewer pose and the follow settings. */
export function followTarget(
  eye: Vec3,
  forward: Vec3,
  settings: Pick<ArSettings, "followDistance" | "followHeight">,
  subjectHeight: number,
): Vec3 {
  return {
    x: eye.x + forward.x * settings.followDistance,
    y: followOriginY(eye.y, settings.followHeight, subjectHeight),
    z: eye.z + forward.z * settings.followDistance,
  };
}
