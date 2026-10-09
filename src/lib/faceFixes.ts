/**
 * What "Fix small faces" did to a set, as ORIGINAL -> RESULT pairs (wanly-console#642).
 *
 * WHY A VIEW AND NOT A COLLAGE FILE. The point is to check the crops at a glance -- the right
 * person, both people in a pair, nobody cut off -- and to delete a bad one in one click. A
 * side-by-side image written into the set would be trained on, so this is display only: it is
 * worked out from the `faces` map the API already keeps (wanly-api#433/#440), and nothing is
 * added to the dataset.
 *
 * The two kinds of fix leave different links behind:
 *  - CROP: a big photo with a small face keeps its place, and `faces[photo].crop_uri` names
 *    the head-and-shoulders (or, on a composition set, two-person) crop added beside it.
 *  - UPSCALE: a tiny image is REPLACED in place; `faces[copy].upscaled_from` names the
 *    original, which is no longer in the set but is still in S3 (getFileUrl shows it).
 */
import type { Dataset, DatasetFaceSize } from "../api/types";
import { isFixed, isPairSet } from "./faceSize";

export interface FaceFix {
  kind: "crop" | "upscale";
  /** The photo the fix was made from. For an upscale, no longer in the set. */
  original: string;
  /** What the fix put in the set: the crop, or the upscaled copy. */
  result: string;
  /** Whether the original is still one of the set's images (a crop's usually is). */
  originalInSet: boolean;
  /** Face size at training size before and after -- `pair_px` on a composition set, the
   *  number the set is judged by there. Null when not measured (or no face / no pair). */
  beforePx: number | null;
  afterPx: number | null;
  /** True when there is no measurement to read `beforePx` from at all -- as opposed to a
   *  measurement that found no face. The API drops an in-place upscale's original entry
   *  when it swaps the copy in (apply_fix), so an upscale's "before" is usually unknown. */
  beforeUnknown: boolean;
}

type FixSet = Pick<Dataset, "images" | "faces" | "kind">;

function px(entry: DatasetFaceSize | undefined, pair: boolean): number | null {
  if (!entry) return null;
  const v = pair ? entry.pair_px : entry.face_px;
  return v === null || v === undefined ? null : v;
}

/** Every fix whose RESULT is still in the set, in the set's order (so the view reads in the
 *  same order as the grid). A crop removed since is not a fix any more -- the same rule as
 *  isFixed, which is what makes the photo count as small again. */
export function faceFixes(ds: FixSet): FaceFix[] {
  const faces = ds.faces ?? {};
  const pair = isPairSet(ds);
  const inSet = new Set(ds.images);
  const byResult = new Map<string, FaceFix>();
  for (const [orig, entry] of Object.entries(faces)) {
    if (!isFixed(entry, ds.images)) continue;
    const crop = entry.crop_uri!;
    byResult.set(crop, {
      kind: "crop", original: orig, result: crop, originalInSet: inSet.has(orig),
      beforePx: px(entry, pair), afterPx: px(faces[crop], pair), beforeUnknown: false,
    });
  }
  for (const uri of ds.images) {
    const orig = faces[uri]?.upscaled_from;
    if (!orig || byResult.has(uri)) continue;
    byResult.set(uri, {
      kind: "upscale", original: orig, result: uri, originalInSet: inSet.has(orig),
      beforePx: px(faces[orig], pair), afterPx: px(faces[uri], pair),
      beforeUnknown: !faces[orig],
    });
  }
  return ds.images.filter((u) => byResult.has(u)).map((u) => byResult.get(u)!);
}

/** Result URI -> its fix: for the "from original" link on a tile in the normal grid. */
export function fixesByResult(fixes: FaceFix[]): Record<string, FaceFix> {
  return Object.fromEntries(fixes.map((f) => [f.result, f]));
}

function pxText(v: number | null, pair: boolean): string {
  if (v !== null) return `${Math.round(v)} px`;
  return pair ? "fewer than 2 faces" : "no face";
}

/** "145 px → 610 px". An upscale whose original was never kept says so rather than invent a
 *  number: "? → 610 px". */
export function fixSizeLabel(fix: FaceFix, pair = false): string {
  const before = fix.beforeUnknown ? "?" : pxText(fix.beforePx, pair);
  return `${before} → ${pxText(fix.afterPx, pair)}`;
}

/** What the result is, for the pair's caption. */
export function fixKindLabel(fix: FaceFix, pair = false): string {
  if (fix.kind === "upscale") return "upscaled in place";
  return pair ? "two-person crop" : "head-and-shoulders crop";
}
