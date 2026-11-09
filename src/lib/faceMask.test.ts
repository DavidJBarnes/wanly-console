import { describe, expect, it } from "vitest";
import { buildTriangles, featherAlpha, fitSimilarity, frameAttributes, HOLES, MESH_VERTICES, OVAL_SIZE, ovalLoop, TOTAL_VERTICES } from "./faceMask";
import { quatToMat3 } from "./faceSpike";

describe("fitSimilarity", () => {
  it("recovers scale, rotation and translation exactly", () => {
    const src = Array.from({ length: 21 }, (_, i) => ({ x: Math.sin(i) * 80, y: Math.cos(i * 1.3) * 90, z: (i % 5) * 7 }));
    const R = quatToMat3([0.2, -0.35, 0.1, 0.9]);
    const s = 0.0011; // px -> metres
    const t = { x: 0.1, y: 1.5, z: -0.8 };
    const dst = src.map((p) => ({
      x: s * (R[0] * p.x + R[1] * p.y + R[2] * p.z) + t.x,
      y: s * (R[3] * p.x + R[4] * p.y + R[5] * p.z) + t.y,
      z: s * (R[6] * p.x + R[7] * p.y + R[8] * p.z) + t.z,
    }));
    const f = fitSimilarity(src, dst);
    expect(f.scale).toBeCloseTo(s, 9);
    f.rotation.forEach((v, i) => expect(v).toBeCloseTo(R[i], 6));
    expect(f.translation.x).toBeCloseTo(t.x, 6);
    expect(f.translation.z).toBeCloseTo(t.z, 6);
    expect(f.rmsM).toBeLessThan(1e-9);
  });
});

// A tiny stand-in tesselation: a fan around vertex 0 covering every hole vertex, so the hole
// loops' vertices are interior and only the fan's rim is boundary.
const RIM = Array.from({ length: OVAL_SIZE }, (_, i) => 400 + i);
function fakeTesselation() {
  const rim = RIM;
  const edges: { start: number; end: number }[] = [];
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i], b = rim[(i + 1) % rim.length];
    edges.push({ start: a, end: b }, { start: b, end: 0 }, { start: 0, end: a });
  }
  return edges;
}

describe("buildTriangles", () => {
  it("regroups edge triples and adds one fan per hole", () => {
    const tris = buildTriangles(fakeTesselation(), RIM);
    const holeTris = HOLES.reduce((a, h) => a + h.length, 0);
    expect(tris.length / 3).toBe(OVAL_SIZE + holeTris + 2 * OVAL_SIZE);
    expect(Math.max(...tris)).toBe(TOTAL_VERTICES - 1);
  });
});

describe("featherAlpha", () => {
  it("is 0 on the extension ring and rises inward", () => {
    const a = featherAlpha(buildTriangles(fakeTesselation(), RIM), 1);
    expect(a[TOTAL_VERTICES - 1]).toBe(0); // ring
    expect(a[400]).toBe(1); // the old oval is one step in now
  });
});

describe("frameAttributes", () => {
  it("copies a frame, flips v, and puts hole centres at the loop means", () => {
    const frames = 2;
    const pos = new Float32Array(frames * MESH_VERTICES * 3).map((_, i) => i);
    const uv = new Float32Array(frames * MESH_VERTICES * 2).fill(0.25);
    const outPos = new Float32Array(TOTAL_VERTICES * 3);
    const outUv = new Float32Array(TOTAL_VERTICES * 2);
    frameAttributes(pos, uv, 1, outPos, outUv, RIM);
    expect(outPos[0]).toBe(MESH_VERTICES * 3);
    expect(outUv[1]).toBeCloseTo(0.75);
    const loop = HOLES[2];
    const meanX = loop.reduce((a, i) => a + outPos[i * 3], 0) / loop.length;
    expect(outPos[(MESH_VERTICES + 2) * 3]).toBeCloseTo(meanX);
  });
});

describe("extension ring", () => {
  it("orders the real oval loop and pushes the ring outward, more at the top", () => {
    const conns = Array.from({ length: OVAL_SIZE }, (_, i) => ({ start: 400 + i, end: 400 + ((i + 1) % OVAL_SIZE) }));
    expect(ovalLoop(conns)).toEqual(RIM);
    const pos = new Float32Array(MESH_VERTICES * 3);
    const uv = new Float32Array(MESH_VERTICES * 2);
    RIM.forEach((v, k) => {
      const a = (2 * Math.PI * k) / OVAL_SIZE;
      pos[v * 3] = 100 * Math.sin(a);
      pos[v * 3 + 1] = 100 * Math.cos(a); // k = 0 at the top
      uv[v * 2] = 0.5 + 0.3 * Math.sin(a);
      uv[v * 2 + 1] = 0.5 - 0.3 * Math.cos(a);
    });
    const outPos = new Float32Array(TOTAL_VERTICES * 3);
    const outUv = new Float32Array(TOTAL_VERTICES * 2);
    frameAttributes(pos, uv, 0, outPos, outUv, RIM);
    const ring = TOTAL_VERTICES - OVAL_SIZE;
    const top = Math.hypot(outPos[ring * 3], outPos[ring * 3 + 1]);
    const side = Math.hypot(outPos[(ring + OVAL_SIZE / 4) * 3], outPos[(ring + OVAL_SIZE / 4) * 3 + 1]);
    expect(top).toBeGreaterThan(115); // 8% + 10% at the forehead
    expect(side).toBeGreaterThan(105); // 8% at the sides
    expect(side).toBeLessThan(top);
    // texture moved by the same fraction: 0.3 -> ~0.354 at the top (v flipped)
    expect(Math.abs(outUv[ring * 2 + 1] - 0.5)).toBeGreaterThan(0.35);
  });
});
