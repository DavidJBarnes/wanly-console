// Hair for Face Loops (console#751): pure parts, testable without a browser.
//
// The prep (wanly-api face_loop_prep) writes hair.mp4 — a wider square of the render, colour on
// top and the hair mask below — and hair.bin: per loop frame, a 2×4 affine taking a point of the
// STABILISED head (face.bin's space: px, y up, z toward the clip camera) to that frame's hair
// image (u right, v down, 0..1). A head shell built in that same space therefore picks up the
// hair exactly where the clip shows it, following the clip's own small head motion.

export type HairMode = "face" | "facehair" | "hair";

export const HAIR_MODES: readonly HairMode[] = ["face", "facehair", "hair"];

export const HAIR_MODE_LABEL: Record<HairMode, string> = {
  face: "Face",
  facehair: "Face + hair",
  hair: "Hair",
};

export function nextHairMode(m: HairMode): HairMode {
  return HAIR_MODES[(HAIR_MODES.indexOf(m) + 1) % HAIR_MODES.length];
}

export function isHairMode(x: unknown): x is HairMode {
  return typeof x === "string" && (HAIR_MODES as readonly string[]).includes(x);
}

export interface HeadShell {
  center: [number, number, number];
  radii: [number, number, number];
}

// Shape of a head around a MediaPipe face (proportions of an adult head; the mannequin's real
// head is under it, so it only has to be close). Landmarks: 10 = upper forehead, 152 = chin,
// 234/454 = the face's outer edges by the ears, 33/263 = outer eye corners.
const CROWN_ABOVE_FOREHEAD = 0.45; // × face height (10→152)
const HALF_WIDTH = 0.56; // × face width (234→454), hair volume over the temples
const DEPTH_RATIO = 1.2; // front-to-back radius / side radius
const FRONT_GAP = 0.04; // × depth radius: the shell's front sits just behind the forehead

/** An ellipsoid head shell fitted to one frame of the clip's face mesh (468×3, px). */
export function headShell(pos: ArrayLike<number>): HeadShell {
  const p = (i: number) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]] as const;
  const [, fy, fz] = p(10);
  const [, cy152] = p(152);
  const [rx0] = p(234);
  const [lx0] = p(454);
  const [, ey1] = p(33);
  const [, ey2] = p(263);
  const fh = Math.abs(fy - cy152);
  const width = Math.abs(lx0 - rx0);
  const cy = (ey1 + ey2) / 2;
  const top = fy + CROWN_ABOVE_FOREHEAD * fh;
  const rx = HALF_WIDTH * width;
  const ry = top - cy;
  const rz = DEPTH_RATIO * rx;
  return { center: [(rx0 + lx0) / 2, cy, fz - (1 + FRONT_GAP) * rz], radii: [rx, ry, rz] };
}

/** Frame `i`'s two affine rows from hair.bin (frames × 2 × 4). */
export function hairRows(rows: Float32Array, i: number): [Float32Array, Float32Array] {
  return [rows.subarray(i * 8, i * 8 + 4), rows.subarray(i * 8 + 4, i * 8 + 8)];
}

/** Apply one frame's rows to a point: hair-image (u, v down). */
export function hairUv(rows: Float32Array, i: number, x: number, y: number, z: number): [number, number] {
  const [u, v] = hairRows(rows, i);
  return [u[0] * x + u[1] * y + u[2] * z + u[3], v[0] * x + v[1] * y + v[2] * z + v[3]];
}
