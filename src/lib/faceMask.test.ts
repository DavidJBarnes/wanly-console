import { describe, expect, it } from "vitest";
import { buildTriangles, featherAlpha, fitSimilarity, frameAttributes, HOLES, MESH_VERTICES, TOTAL_VERTICES } from "./faceMask";
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
function fakeTesselation() {
  const rim = Array.from({ length: 30 }, (_, i) => 400 + i);
  const edges: { start: number; end: number }[] = [];
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i], b = rim[(i + 1) % rim.length];
    edges.push({ start: a, end: b }, { start: b, end: 0 }, { start: 0, end: a });
  }
  return edges;
}

describe("buildTriangles", () => {
  it("regroups edge triples and adds one fan per hole", () => {
    const tris = buildTriangles(fakeTesselation());
    const holeTris = HOLES.reduce((a, h) => a + h.length, 0);
    expect(tris.length / 3).toBe(30 + holeTris);
    expect(Math.max(...tris)).toBe(TOTAL_VERTICES - 1);
  });
});

describe("featherAlpha", () => {
  it("is 0 on the boundary and rises inward", () => {
    const a = featherAlpha(buildTriangles(fakeTesselation()), 1);
    expect(a[400]).toBe(0); // rim
    expect(a[0]).toBe(1); // one step in
  });
});

describe("frameAttributes", () => {
  it("copies a frame, flips v, and puts hole centres at the loop means", () => {
    const frames = 2;
    const pos = new Float32Array(frames * MESH_VERTICES * 3).map((_, i) => i);
    const uv = new Float32Array(frames * MESH_VERTICES * 2).fill(0.25);
    const outPos = new Float32Array(TOTAL_VERTICES * 3);
    const outUv = new Float32Array(TOTAL_VERTICES * 2);
    frameAttributes(pos, uv, 1, outPos, outUv);
    expect(outPos[0]).toBe(MESH_VERTICES * 3);
    expect(outUv[1]).toBeCloseTo(0.75);
    const loop = HOLES[2];
    const meanX = loop.reduce((a, i) => a + outPos[i * 3], 0) / loop.length;
    expect(outPos[(MESH_VERTICES + 2) * 3]).toBeCloseTo(meanX);
  });
});
