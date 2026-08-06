/**
 * Faceswap fields for a job/segment request body.
 *
 * WHY THIS EXISTS: CreateJobDialog and JobDetail each built this block independently and
 * repeated seven identical lines verbatim. They diverged in exactly one field -- faceswap_image
 * -- and that is precisely where two production bugs lived:
 *
 *   - a continuation resolved "Start Frame" to the PREVIOUS segment's last frame, which has
 *     already drifted. Swapping toward it locks the drift in. Measured 0.906 -> 0.644 identity.
 *   - a starting image picked from the repo (a URI, not a File) sent NO face at all, because
 *     the attach branch was guarded on the uploaded File. The daemon gates on
 *     `faceswap_enabled AND faceswap_image`, so the swap silently did not run while the UI
 *     still showed it enabled. Nine queued jobs were affected before anyone noticed.
 *
 * Both are pure state -> payload logic, which is why they survived tsc, eslint and a build.
 * One implementation, one set of tests.
 *
 * Deliberately imports nothing from `../api/client`: that module installs axios interceptors at
 * import time, one of which assigns `window.location.href` on a 401.
 */

/** Mirrors the faceswap UI state. Lives here rather than in FaceswapConfig.tsx so tests can
 *  import it without dragging MUI in; the component imports it back. */
export interface FaceswapConfigState {
  enabled: boolean;
  method: string;
  sourceType: "upload" | "preset" | "start_frame";
  file: File | null;
  presetUri: string | null;
  facesIndex: string;
  facesOrder: string;
  /** FaceFusion only: swapper network and the resolution the target crop is sampled at. */
  model: string;
  pixelBoost: string;
  /** Re-anchor the continuation seed by swapping this segment's last frame before it seeds the
   *  next one. INDEPENDENT of `enabled` -- the seed can be re-anchored without swapping the
   *  video, and both share the same face source. */
  seedFaceswap: boolean;
}

export interface FaceswapFields {
  faceswap_enabled: boolean;
  faceswap_method: string | null;
  faceswap_source_type: string | null;
  faceswap_image: string | null;
  faceswap_faces_index: string | null;
  faceswap_faces_order: string | null;
  faceswap_model: string | null;
  faceswap_pixel_boost: string | null;
  seed_faceswap: boolean;
}

export interface FaceswapContext {
  /** A freshly uploaded start image. Travels as multipart, so it is NOT a URI and must not be
   *  placed in the JSON body -- the caller attaches the File separately. */
  startingImageFile?: File | null;
  /** A start image picked from the repo. URI only, so it MUST travel in the JSON body. */
  startingImageUri?: string | null;
  /** The JOB's starting image. On a continuation this is the correct "start frame": segment 0's
   *  image, which is also what identity is scored against (identity_ground_truth). Never the
   *  previous segment's last frame -- that one has already drifted. */
  jobStartingImage?: string | null;
}

/**
 * Resolve the face the swap should target.
 *
 * Returns null when the swap is off, when the source is an upload (the File goes multipart), or
 * when nothing usable is configured -- and null means the daemon skips the swap entirely, so a
 * null here is a silent no-op rather than an error. That is exactly how the repo-image bug hid.
 */
export function resolveFaceswapImage(
  faceswap: FaceswapConfigState,
  ctx: FaceswapContext = {},
): string | null {
  if (!faceswap.enabled && !faceswap.seedFaceswap) return null;

  if (faceswap.sourceType === "preset") return faceswap.presetUri ?? null;

  if (faceswap.sourceType === "start_frame") {
    // Job image first. On a continuation the alternative -- the previous segment's last frame --
    // is the drifted one, and swapping toward it locks the drift in permanently.
    if (ctx.jobStartingImage) return ctx.jobStartingImage;
    // A repo pick is URI-only and has to travel in the body. An upload does not: the File is
    // attached as multipart by the caller, so the body field stays null.
    if (!ctx.startingImageFile && ctx.startingImageUri) return ctx.startingImageUri;
    return null;
  }

  return null; // "upload" -- the File is attached separately
}

/**
 * Build every faceswap_* field for a request body.
 *
 * The gate is `enabled || seedFaceswap`, not `enabled`: a seed-only re-anchor still needs the
 * face, the method and the selector settings, and only differs in that the video itself is not
 * swapped.
 */
export function buildFaceswapFields(
  faceswap: FaceswapConfigState,
  ctx: FaceswapContext = {},
): FaceswapFields {
  const active = faceswap.enabled || faceswap.seedFaceswap;
  return {
    faceswap_enabled: faceswap.enabled,
    faceswap_method: active ? faceswap.method : null,
    faceswap_source_type: active ? faceswap.sourceType : null,
    faceswap_image: resolveFaceswapImage(faceswap, ctx),
    faceswap_faces_index: active ? faceswap.facesIndex : null,
    faceswap_faces_order: active ? faceswap.facesOrder : null,
    faceswap_model: active ? faceswap.model : null,
    faceswap_pixel_boost: active ? faceswap.pixelBoost : null,
    seed_faceswap: faceswap.seedFaceswap,
  };
}

/**
 * Should the caller attach the start image File as the faceswap source (multipart)?
 *
 * The other half of the same decision as resolveFaceswapImage: exactly one of the two should
 * produce a face for any given state. Splitting them across 30 lines of a submit handler is how
 * they drifted apart in the first place.
 */
export function shouldAttachStartImageAsFace(
  faceswap: FaceswapConfigState,
  ctx: FaceswapContext = {},
): boolean {
  return (
    (faceswap.enabled || faceswap.seedFaceswap) &&
    faceswap.sourceType === "start_frame" &&
    !!ctx.startingImageFile
  );
}
