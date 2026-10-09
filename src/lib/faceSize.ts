/**
 * Face size at training size, and "Fix small faces" (wanly-console#636, wanly-api#432).
 *
 * WHY THE TRAINING SIZE AND NOT THE PHOTO. Both still recipes train with bucket_no_upscale: a
 * photo is scaled DOWN to the trainer's 1024^2 area and a small image is never enlarged. So a
 * 400 px face in a 4000 px photo trains at about 100 px. On Joana v3, 29 of 48 faces were under
 * 250 px by that measure; v4, with upscaled head-and-shoulders crops added, learned her face in
 * about half the steps (wanly-api#431). The API stores the number already converted (face_px).
 */
import type { Dataset, DatasetFaceSize, FixSmallFacesStatus } from "../api/types";
import { splitClips } from "./datasets";

/** Under this at training size the face is red, and "Fix small faces" takes it. The API's
 *  `small_face_px`; kept in step so the badge and the preflight warning agree. */
export const SMALL_FACE_PX = 250;
/** Under this it is amber: learnable, but not where the face is learned best. */
export const AMBER_FACE_PX = 400;

export type FaceSizeLevel = "small" | "amber" | "ok" | "no-face" | "unmeasured";

export function faceSizeLevel(entry: DatasetFaceSize | null | undefined): FaceSizeLevel {
  if (!entry) return "unmeasured";
  if (entry.face_px === null || entry.face_px === undefined) return "no-face";
  if (entry.face_px < SMALL_FACE_PX) return "small";
  if (entry.face_px < AMBER_FACE_PX) return "amber";
  return "ok";
}

/** "182 px" for the badge. Rounded: a tenth of a pixel is noise, not information. */
export function faceSizeLabel(entry: DatasetFaceSize): string {
  return entry.face_px === null || entry.face_px === undefined
    ? "no face" : `${Math.round(entry.face_px)} px`;
}

/** FIXED = the crop "Fix small faces" made of this photo is still in the set (wanly-api#437
 *  follow-up). The photo itself never changes -- its face stays small forever -- so without
 *  this, a set that had just been fixed still said "12 of 45 small" and offered the button
 *  again. Its crop removed, it counts as small again, the same rule plan_fix uses to offer it. */
export function isFixed(entry: DatasetFaceSize | null | undefined, images: string[]): boolean {
  return Boolean(entry?.crop_uri && images.includes(entry.crop_uri));
}

/** The badge's tooltip: what the number is, and what to do about a small one. `fixed`: its
 *  crop is in the set, so the red badge stays (the photo IS small) but says it is dealt with. */
export function faceSizeTooltip(entry: DatasetFaceSize, fixed = false): string {
  const parts: string[] = [];
  if (entry.face_px !== null && entry.face_px !== undefined) {
    parts.push(`Face ${Math.round(entry.face_px)} px tall at training size`);
  } else {
    parts.push("No face detected");
  }
  if (entry.width && entry.height) parts.push(`image ${entry.width}×${entry.height}`);
  if (entry.yaw !== null && entry.yaw !== undefined) parts.push(`yaw ${Math.round(entry.yaw)}°`);
  let text = parts.join(", ") + ".";
  if ((entry.faces ?? 0) > 1) {
    text += ` ${entry.faces} faces found; this is the largest, which may not be the subject.`;
  }
  if (entry.upscaled_from) text += " Upscaled by Fix small faces; the original is still in S3.";
  const level = faceSizeLevel(entry);
  if (level === "small" && fixed) {
    text += " Fixed: Fix small faces added an upscaled crop of it to the set (crop added).";
  } else if (level === "small") {
    text += ` Under ${SMALL_FACE_PX} px the trainer learns the face small — Fix small faces `
      + "adds an upscaled close-up.";
  } else if (level === "amber") {
    text += ` Under ${AMBER_FACE_PX} px: usable, not ideal.`;
  }
  return text;
}

/** The set's tally over its stills: how many are small, and how many are still unmeasured.
 *  `small` leaves out the FIXED ones (their crop is in the set) -- it is what the button would
 *  still do something about, and what the preflight warning counts; `fixed` counts those. */
export function faceSizeSummary(ds: Pick<Dataset, "images" | "faces">): {
  stills: number; measured: number; small: number; amber: number; unmeasured: number;
  fixed: number;
} {
  const { stills } = splitClips(ds.images);
  const faces = ds.faces ?? {};
  let small = 0;
  let amber = 0;
  let measured = 0;
  let fixed = 0;
  for (const u of stills) {
    const level = faceSizeLevel(faces[u]);
    if (level === "unmeasured") continue;
    measured += 1;
    if (level === "small" && isFixed(faces[u], ds.images)) fixed += 1;
    else if (level === "small") small += 1;
    if (level === "amber") amber += 1;
  }
  return { stills: stills.length, measured, small, amber, unmeasured: stills.length - measured,
    fixed };
}

/** The line under the toolbar, or null when there is nothing to say. Mirrors the training
 *  preflight's small_faces warning, so the two read the same. */
export function smallFacesWarning(ds: Pick<Dataset, "images" | "faces">): string | null {
  const s = faceSizeSummary(ds);
  if (!s.small) return null;
  return `${s.small} of ${s.stills} images show the face under ${SMALL_FACE_PX} px at training `
    + "size — Fix small faces adds upscaled close-ups";
}

/** The fix's progress line, or null when there is nothing to show. A finished run's summary
 *  is shown too: the set changed under the person, and they should see how. */
export function fixProgressLabel(s: FixSmallFacesStatus | null): string | null {
  if (!s) return null;
  if (s.error) return `Fix small faces stopped: ${s.error}`;
  if (s.running) {
    const counted = s.total > 0 ? ` ${s.done}/${s.total}` : "";
    return `Fixing small faces: ${s.stage ?? "starting"}${counted}…`;
  }
  return s.summary ?? null;
}
