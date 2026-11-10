import { describe, expect, it } from "vitest";
import { cardDepth, hairUv, HEAD_INFLATE, headEyes, headPivot, headShell, isHairMode, nextHairMode } from "./faceHair";

describe("hair modes", () => {
  it("cycles face → face + hair → hair → face", () => {
    expect(nextHairMode("face")).toBe("facehair");
    expect(nextHairMode("facehair")).toBe("hair");
    expect(nextHairMode("hair")).toBe("head");
    expect(nextHairMode("head")).toBe("face");
  });
  it("recognises only real modes (saved settings)", () => {
    expect(isHairMode("hair")).toBe(true);
    expect(isHairMode("wig")).toBe(false);
    expect(isHairMode(null)).toBe(false);
  });
});

describe("headShell", () => {
  // A face 200 px tall (forehead y=100 to chin y=-100), 160 px wide, eyes at y=20, forehead z=50.
  const pos = new Float32Array(468 * 3);
  const set = (i: number, x: number, y: number, z: number) => pos.set([x, y, z], i * 3);
  set(10, 0, 100, 50);
  set(152, 0, -100, 40);
  set(234, -80, 0, -20);
  set(454, 80, 0, -20);
  set(33, -45, 20, 20);
  set(263, 45, 20, 20);
  const s = headShell(pos);
  it("puts the crown above the forehead and the shell behind the face", () => {
    const [cx, cy, cz] = s.center;
    const [rx, ry, rz] = s.radii;
    expect(cx).toBe(0);
    expect(cy + ry).toBeCloseTo(100 + 0.45 * 200); // crown
    expect(rx).toBeGreaterThan(80); // wider than the face
    expect(cz + rz).toBeLessThan(50); // front just behind the forehead
    expect(cz + rz).toBeGreaterThan(40);
  });
});

describe("hairUv", () => {
  it("applies frame i's affine rows", () => {
    const rows = new Float32Array(16);
    rows.set([0.001, 0, 0, 0.5, 0, -0.001, 0, 0.5], 8); // frame 1
    expect(hairUv(rows, 1, 100, 200, 7)).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.3, 6)]);
  });
});

describe("full head geometry", () => {
  const pos = new Float32Array(468 * 3);
  const set = (i: number, x: number, y: number, z: number) => pos.set([x, y, z], i * 3);
  set(10, 0, 100, 50);
  set(152, 0, -100, 40);
  set(234, -80, 0, -20);
  set(454, 80, 0, -20);
  set(33, -45, 20, 20);
  set(263, 45, 20, 20);
  set(13, 0, -55, 45);
  set(14, 0, -65, 45);
  const s = headShell(pos, HEAD_INFLATE);
  it("inflates the shell about the same centre", () => {
    const base = headShell(pos);
    expect(s.center).toEqual(base.center);
    s.radii.forEach((r, i) => expect(r).toBeCloseTo(base.radii[i] * HEAD_INFLATE));
  });
  it("bends the card forward to the neck in the middle, flat at the sides", () => {
    const cz = s.center[2];
    const mid = cardDepth(s.center[0], s, pos);
    expect(mid).toBeCloseTo(40 - 0.25 * 200); // chin z − a quarter face height
    expect(mid).toBeGreaterThan(cz);
    expect(cardDepth(s.center[0] + 2 * s.radii[0], s, pos)).toBe(cz);
  });
  it("looks from between the eyes", () => {
    expect(headEyes(pos)).toEqual([0, 20, 20]);
  });
  it("pivots in the neck just under the chin", () => {
    expect(headPivot(pos, s)).toEqual([s.center[0], -100 - 0.2 * 200, s.center[2]]);
  });
});
