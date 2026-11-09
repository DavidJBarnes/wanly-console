// Face-mask geometry for AR face replacement (console#739).
//
// The mesh SHAPE comes from the generated clip, frame by frame (so an open-mouthed laugh really
// opens), and is placed on the mannequin by ONE similarity transform fitted at lock time from
// expression-free anchor points (eye corners, nose bridge, forehead, cheekbones). The clip's
// per-frame shapes are pre-stabilised offline (make_face_loop.py), so only the placement happens
// here. The texture is the clip itself, mapped by its own per-frame landmarks.
//
// Framework-free so it tests without three.js or a headset.

import type { Vec3 } from "./faceSpike";

/** Expression-free landmarks used to align the clip face to the mannequin (matches make_face_loop.py). */
export const ANCHORS = [33, 133, 362, 263, 168, 6, 197, 195, 5, 4, 1, 10, 151, 9, 8, 116, 345, 123, 352, 234, 454];

/**
 * MediaPipe's tesselation leaves holes at both eyes and the mouth. Unfilled, the clip's eyes and
 * teeth would be missing and the mannequin's own eyes would show through. Each hole is closed
 * with a fan around an extra centre vertex (index 468 + hole index).
 */
export const HOLES: number[][] = [
  [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], // right eye
  [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466], // left eye
  [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191], // inner lips
];

export const MESH_VERTICES = 468;
export const TOTAL_VERTICES = MESH_VERTICES + HOLES.length;

/** Triangle indices: the tesselation's triangles (edges come in consecutive triples) + hole fans. */
export function buildTriangles(tesselation: readonly { start: number; end: number }[]): number[] {
  const idx: number[] = [];
  for (let i = 0; i + 2 < tesselation.length; i += 3) {
    idx.push(tesselation[i].start, tesselation[i + 1].start, tesselation[i + 2].start);
  }
  HOLES.forEach((loop, k) => {
    const c = MESH_VERTICES + k;
    for (let i = 0; i < loop.length; i++) idx.push(loop[i], loop[(i + 1) % loop.length], c);
  });
  return idx;
}

/**
 * Per-vertex opacity: 0 on the outer face oval, rising over `rings` edge-steps inward. Softens
 * the mask's edge into the mannequin instead of a hard cut-out.
 */
export function featherAlpha(triangles: readonly number[], rings = 3): Float32Array {
  const n = TOTAL_VERTICES;
  const edgeCount = new Map<string, number>();
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let i = 0; i < triangles.length; i += 3) {
    const t = [triangles[i], triangles[i + 1], triangles[i + 2]];
    for (let j = 0; j < 3; j++) {
      const a = t[j], b = t[(j + 1) % 3];
      edgeCount.set(key(a, b), (edgeCount.get(key(a, b)) ?? 0) + 1);
      adj[a].add(b);
      adj[b].add(a);
    }
  }
  // Boundary vertices: on an edge used by one triangle. With the holes filled, that is only the
  // outer oval.
  const dist = new Array<number>(n).fill(Infinity);
  const queue: number[] = [];
  for (const [k, c] of edgeCount) {
    if (c !== 1) continue;
    for (const v of k.split(",").map(Number)) {
      if (dist[v] !== 0) {
        dist[v] = 0;
        queue.push(v);
      }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q];
    for (const w of adj[v]) {
      if (dist[w] === Infinity) {
        dist[w] = dist[v] + 1;
        queue.push(w);
      }
    }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, dist[i] / rings);
  return out;
}

/**
 * Fill `outPos` (TOTAL_VERTICES×3) and `outUv` (TOTAL_VERTICES×2) for one clip frame, appending
 * the hole centres. UVs flip v for a three.js VideoTexture (flipY = true).
 */
export function frameAttributes(
  positions: Float32Array, // frames × 468 × 3
  uvs: Float32Array, // frames × 468 × 2
  frame: number,
  outPos: Float32Array,
  outUv: Float32Array,
): void {
  const p0 = frame * MESH_VERTICES * 3;
  const u0 = frame * MESH_VERTICES * 2;
  outPos.set(positions.subarray(p0, p0 + MESH_VERTICES * 3));
  for (let i = 0; i < MESH_VERTICES; i++) {
    outUv[i * 2] = uvs[u0 + i * 2];
    outUv[i * 2 + 1] = 1 - uvs[u0 + i * 2 + 1];
  }
  HOLES.forEach((loop, k) => {
    const c = MESH_VERTICES + k;
    let x = 0, y = 0, z = 0, u = 0, v = 0;
    for (const i of loop) {
      x += outPos[i * 3];
      y += outPos[i * 3 + 1];
      z += outPos[i * 3 + 2];
      u += outUv[i * 2];
      v += outUv[i * 2 + 1];
    }
    const n = loop.length;
    outPos[c * 3] = x / n;
    outPos[c * 3 + 1] = y / n;
    outPos[c * 3 + 2] = z / n;
    outUv[c * 2] = u / n;
    outUv[c * 2 + 1] = v / n;
  });
}

export interface Similarity {
  scale: number;
  rotation: number[]; // row-major 3×3
  translation: Vec3;
  rmsM: number; // residual of the fit, in destination units
}

/** Eigenvector of the largest eigenvalue of a symmetric 4×4 (cyclic Jacobi). */
function topEigenvector4(a: number[][]): number[] {
  const A = a.map((r) => [...r]);
  const V = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += A[p][q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (A[i][i] > A[best][best]) best = i;
  return [V[0][best], V[1][best], V[2][best], V[3][best]];
}

/**
 * Least-squares similarity (scale, rotation, translation) taking `src` onto `dst` — Horn's
 * closed-form quaternion method. Point pairs correspond by index.
 */
export function fitSimilarity(src: readonly Vec3[], dst: readonly Vec3[]): Similarity {
  const n = src.length;
  const mean = (ps: readonly Vec3[]) =>
    ps.reduce((a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n, z: a.z + p.z / n }), { x: 0, y: 0, z: 0 });
  const ms = mean(src);
  const md = mean(dst);
  const A = src.map((p) => [p.x - ms.x, p.y - ms.y, p.z - ms.z]);
  const B = dst.map((p) => [p.x - md.x, p.y - md.y, p.z - md.z]);
  const S = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += A[i][r] * B[i][c];
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const [w, x, y, z] = topEigenvector4(N);
  const R = [
    w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z,
  ];
  const rot = (v: number[]) => [
    R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
    R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
    R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
  ];
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const ra = rot(A[i]);
    num += ra[0] * B[i][0] + ra[1] * B[i][1] + ra[2] * B[i][2];
    den += A[i][0] ** 2 + A[i][1] ** 2 + A[i][2] ** 2;
  }
  const scale = num / den;
  const rm = rot([ms.x, ms.y, ms.z]);
  const translation = { x: md.x - scale * rm[0], y: md.y - scale * rm[1], z: md.z - scale * rm[2] };
  let err = 0;
  for (let i = 0; i < n; i++) {
    const ra = rot([src[i].x, src[i].y, src[i].z]);
    err +=
      (scale * ra[0] + translation.x - dst[i].x) ** 2 +
      (scale * ra[1] + translation.y - dst[i].y) ** 2 +
      (scale * ra[2] + translation.z - dst[i].z) ** 2;
  }
  return { scale, rotation: R, translation, rmsM: Math.sqrt(err / n) };
}
