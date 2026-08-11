import { describe, expect, it } from "vitest";
import {
  ARRIVE_EPSILON,
  EDGE_DEFAULTS,
  flattenYaw,
  followOriginY,
  followTarget,
  nextEasing,
  smoothing,
} from "./arFollow";

describe("smoothing", () => {
  it("is frame-rate independent: same rate, same elapsed time, same result", () => {
    // One 1/36s step vs two 1/72s steps must land in the same place, or the follow feels
    // different on a 72Hz headset than a 120Hz one.
    const rate = 2.5;
    const oneBig = smoothing(rate, 1 / 36);
    let remaining = 1;
    for (let i = 0; i < 2; i++) remaining *= 1 - smoothing(rate, 1 / 72);
    expect(1 - remaining).toBeCloseTo(oneBig, 12);
  });

  it("never overshoots, even on an absurd dt", () => {
    expect(smoothing(12, 100)).toBeLessThanOrEqual(1);
    expect(smoothing(12, 100)).toBeGreaterThan(0.99);
  });

  it("is zero at zero elapsed time", () => {
    expect(smoothing(5, 0)).toBe(0);
  });
});

describe("nextEasing", () => {
  it("stays latched off inside the deadzone", () => {
    expect(nextEasing(false, 0.05, 0.12)).toBe(false);
  });

  it("latches on once the viewer drifts out", () => {
    expect(nextEasing(false, 0.13, 0.12)).toBe(true);
  });

  it("keeps easing back inside the deadzone — the whole point of the hysteresis", () => {
    // Without this the clip would stop dead at the deadzone boundary and jitter there.
    expect(nextEasing(true, 0.05, 0.12)).toBe(true);
  });

  it("releases only on arrival", () => {
    expect(nextEasing(true, ARRIVE_EPSILON / 2, 0.12)).toBe(false);
  });

  it("a zero deadzone still latches (follows continuously)", () => {
    expect(nextEasing(false, 0.001, 0)).toBe(true);
  });
});

describe("flattenYaw", () => {
  it("drops pitch and renormalises", () => {
    const f = flattenYaw({ x: 0, y: -0.9, z: -0.436 });
    expect(f).not.toBeNull();
    expect(f!.y).toBe(0);
    expect(Math.hypot(f!.x, f!.z)).toBeCloseTo(1, 12);
    expect(f!.z).toBeCloseTo(-1, 6);
  });

  it("returns null looking straight down so the caller holds the last heading", () => {
    expect(flattenYaw({ x: 0, y: -1, z: 0 })).toBeNull();
  });

  it("returns null looking straight up", () => {
    expect(flattenYaw({ x: 0, y: 1, z: 0 })).toBeNull();
  });

  it("preserves bearing for an already-horizontal vector", () => {
    const f = flattenYaw({ x: 1, y: 0, z: 0 })!;
    expect(f.x).toBeCloseTo(1, 12);
    expect(f.z).toBeCloseTo(0, 12);
  });
});

describe("followOriginY", () => {
  it("centres the subject on the eyeline at zero offset", () => {
    // Origin is the subject's feet, so a 1.7m subject centred at eye height 1.6 sits at 0.75.
    expect(followOriginY(1.6, 0, 1.7)).toBeCloseTo(0.75, 12);
  });

  it("shifts one-for-one with the offset", () => {
    expect(followOriginY(1.6, 0.5, 1.7) - followOriginY(1.6, 0, 1.7)).toBeCloseTo(0.5, 12);
  });
});

describe("followTarget", () => {
  const settings = { followDistance: 1.6, followHeight: 0 };

  it("places the clip followDistance ahead along the forward vector", () => {
    const t = followTarget({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, settings, 1.7);
    expect(t.x).toBeCloseTo(0, 12);
    expect(t.z).toBeCloseTo(-1.6, 12);
  });

  it("follows the viewer's translation", () => {
    const t = followTarget({ x: 3, y: 1.6, z: 2 }, { x: 0, y: 0, z: -1 }, settings, 1.7);
    expect(t.x).toBeCloseTo(3, 12);
    expect(t.z).toBeCloseTo(0.4, 12);
  });

  it("follows the gaze DOWN when the forward vector pitches down", () => {
    // The whole point of `follow`: look down and the clip comes with you. A previous version
    // dropped forward.y here, which silently collapsed `follow` into `follow-yaw` vertically and
    // made the clip creep closer at a fixed height instead — "sliding down a wall".
    const level = followTarget({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, settings, 1.7);
    const down = followTarget({ x: 0, y: 1.6, z: 0 }, { x: 0, y: -1, z: 0 }, settings, 1.7);
    expect(down.y).toBeLessThan(level.y);
    expect(down.y).toBeCloseTo(level.y - settings.followDistance, 12);
  });

  it("follows the gaze UP symmetrically", () => {
    const level = followTarget({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, settings, 1.7);
    const up = followTarget({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 1, z: 0 }, settings, 1.7);
    expect(up.y).toBeCloseTo(level.y + settings.followDistance, 12);
  });

  it("holds eye level for an already-flattened vector — the follow-yaw path", () => {
    // follow-yaw hands in a vector whose y is 0 (via flattenYaw), so the same arithmetic pins the
    // height without followTarget needing to know which mode is active.
    const flat = flattenYaw({ x: 0, y: -0.9, z: -0.436 })!;
    const level = followTarget({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, settings, 1.7);
    const pitched = followTarget({ x: 0, y: 1.6, z: 0 }, flat, settings, 1.7);
    expect(pitched.y).toBeCloseTo(level.y, 12);
  });
});

describe("EDGE_DEFAULTS", () => {
  it("gives tier-1 a tighter ramp than tier-0", () => {
    const flat = EDGE_DEFAULTS.flat.edgeMax - EDGE_DEFAULTS.flat.edgeMin;
    const depth = EDGE_DEFAULTS.depth.edgeMax - EDGE_DEFAULTS.depth.edgeMin;
    expect(depth).toBeLessThan(flat);
  });

  it("keeps min below max on both tiers, or the smoothstep inverts", () => {
    expect(EDGE_DEFAULTS.flat.edgeMin).toBeLessThan(EDGE_DEFAULTS.flat.edgeMax);
    expect(EDGE_DEFAULTS.depth.edgeMin).toBeLessThan(EDGE_DEFAULTS.depth.edgeMax);
  });
});
