/**
 * 480p / 720p resolution buckets for Wan 2.2.
 *
 * The old shortcut scaled the start image's SHORT side to 480 or 720 and derived the other
 * dimension from the aspect ratio. That holds one dimension fixed and lets total pixel area float
 * with the ratio — and Wan 2.2 is sensitive to total area, not to which side happens to be 480. A
 * 832x1216 portrait came out 480x704 = 337,920 px, 15% under bucket; a square source came out
 * 480x480 = 230,400 px, 42% under. Both generate without error and both produce soft texture,
 * degraded faces and weak motion coherence, so the failure is invisible until you look at the clip.
 *
 * Area matching instead: keep the aspect ratio, scale to hit the bucket's pixel count.
 */

/** Area of Wan's native 832x480 / 480x832 buckets. */
export const BUCKET_AREA_480P = 399360;
/** Area of Wan's native 1280x720 / 720x1280 buckets. */
export const BUCKET_AREA_720P = 921600;

/**
 * Trained resolutions. Landing on one of these beats a merely area-matched size, so a near miss
 * snaps rather than sitting a few pixels off a resolution the model actually saw.
 */
const NATIVE_BUCKETS: ReadonlyArray<readonly [number, number]> = [
  [832, 480],
  [480, 832],
  [1280, 720],
  [720, 1280],
];

/** How close to a native bucket counts as "just use the native bucket". */
const SNAP_TOLERANCE = 0.05;

/**
 * Dimensions must be multiples of 16: the VAE downsamples 8x spatially and the DiT patch size is
 * 2 on top of that.
 */
const GRAIN = 16;

export interface BucketResolution {
  width: number;
  height: number;
  /** Final area as a fraction of the target — 1 is exactly on bucket, 0.85 is 15% under. */
  areaRatio: number;
  /** True when the result was snapped to an exact Wan native bucket. */
  snapped: boolean;
}

const roundToGrain = (n: number) => Math.max(GRAIN, Math.round(n / GRAIN) * GRAIN);

/**
 * Resolution for `targetArea` that preserves the source aspect ratio.
 *
 * Scales UP as readily as down: a source smaller than the bucket is upscaled into it, because
 * generating below bucket area is worse than feeding the model an upscaled image.
 */
export function bucketResolution(
  srcW: number,
  srcH: number,
  targetArea: number,
): BucketResolution {
  // A missing or zero-sized source would divide by zero; fall back to the landscape bucket ratio,
  // which snaps to a native bucket at both target areas.
  const w0 = srcW > 0 ? srcW : 832;
  const h0 = srcH > 0 ? srcH : 480;

  const scale = Math.sqrt(targetArea / (w0 * h0));
  let width = roundToGrain(w0 * scale);
  let height = roundToGrain(h0 * scale);
  let snapped = false;

  for (const [bw, bh] of NATIVE_BUCKETS) {
    if (
      Math.abs(width - bw) / bw <= SNAP_TOLERANCE &&
      Math.abs(height - bh) / bh <= SNAP_TOLERANCE
    ) {
      width = bw;
      height = bh;
      snapped = true;
      break;
    }
  }

  return { width, height, areaRatio: (width * height) / targetArea, snapped };
}

/**
 * One-line summary of a bucket decision, for the dialog caption and the browser console.
 *
 * The area percentage is the point: an under-bucket result is the exact failure this replaced, and
 * it is silent everywhere else.
 */
export function describeBucket(
  srcW: number,
  srcH: number,
  result: BucketResolution,
): string {
  const pct = Math.round(result.areaRatio * 100);
  const source = srcW > 0 && srcH > 0 ? `${srcW}x${srcH}` : "unknown source";
  return `${source} -> ${result.width}x${result.height} (${pct}% of bucket area${
    result.snapped ? ", native bucket" : ""
  })`;
}
