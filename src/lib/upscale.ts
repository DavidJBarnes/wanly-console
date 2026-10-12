import type { FixSmallFacesStatus } from "../api/types";

/**
 * A dataset's "Upscale" (wanly-console#668, wanly-api#460): a high-res COPY of each chosen
 * still, added beside it -- the source stays. Not "Fix small faces", which upscales tiny
 * images in place, only to the trainer's 1024 ceiling.
 */

/** The API's cap on a copy's long edge (wanly-api#460, wanly-gpu-docker#214). */
export const UPSCALE_MAX_EDGE = 4096;
export const UPSCALE_FACTORS = [2, 4] as const;
export type UpscaleFactor = (typeof UPSCALE_FACTORS)[number];

/** The long edge a copy comes out at, as the API computes it; null when it is unknown. */
export function upscaleTarget(
  width: number | null | undefined, height: number | null | undefined, factor: UpscaleFactor,
): number | null {
  if (!width || !height) return null;
  return Math.min(UPSCALE_MAX_EDGE, factor * Math.max(width, height));
}

/** A selection is required: no "every image" default, since each copy is seconds to minutes
 *  of CPU and a full set of 4x copies is rarely what anyone wants. */
export function upscaleSelectionProblem(selected: Set<string>): string | null {
  return selected.size === 0 ? "pick at least one image" : null;
}

/** The toolbar line, as fixProgressLabel: progress while running, the summary when done. */
export function upscaleProgressLabel(s: FixSmallFacesStatus | null): string | null {
  if (!s) return null;
  if (s.error) return `Upscale stopped: ${s.error}`;
  if (s.running) {
    const counted = s.total > 0 ? ` ${s.done}/${s.total}` : "";
    return `Upscaling: ${s.stage ?? "starting"}${counted}…`;
  }
  return s.summary ?? null;
}
