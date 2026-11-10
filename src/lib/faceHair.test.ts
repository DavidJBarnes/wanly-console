import { describe, expect, it } from "vitest";
import { hairUv, headShell, isHairMode, nextHairMode } from "./faceHair";

describe("hair modes", () => {
  it("cycles face → face + hair → hair → face", () => {
    expect(nextHairMode("face")).toBe("facehair");
    expect(nextHairMode("facehair")).toBe("hair");
    expect(nextHairMode("hair")).toBe("face");
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
