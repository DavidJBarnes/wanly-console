/**
 * What "clone this job" resolves to, as plain values.
 *
 * WHY THIS EXISTS: the same lesson as `faceswapPayload.ts` — the interesting decisions here are
 * pure state -> state mapping, and buried inside a `useEffect` they are unreachable by any test
 * the repo can run. Two of them are silent when wrong:
 *
 *   - the source segment. After a re-roll there are two segments at index 0 and the archived one
 *     carries a prompt/LoRA set that is no longer the job. Cloning it produces a job that looks
 *     right and reproduces something nobody asked for.
 *   - the faceswap source. An "upload" face is a File this browser no longer has. Drop it and the
 *     clone arrives with the swap ENABLED and no face, which the daemon treats as "skip the swap"
 *     — the exact silent no-op documented in faceswapPayload.ts.
 *
 * Deliberately imports no component and no `../api/client`: that module installs axios
 * interceptors at import time, one of which assigns `window.location.href` on a 401.
 */
import type { JobDetailResponse, SegmentResponse } from "../api/types";
import type { FaceswapConfigState } from "./faceswapPayload";
import { groupTakes } from "./segmentTakes";
import {
  DEFAULT_FACESWAP_SOURCE_TYPE,
  DEFAULT_FACESWAP_METHOD,
  DEFAULT_FACESWAP_MODEL,
  DEFAULT_FACESWAP_PIXEL_BOOST,
  DEFAULT_FACESWAP_FACES_INDEX,
  DEFAULT_FACESWAP_FACES_ORDER,
} from "../constants";

export interface ClonedLora {
  lora_id: string;
  name: string;
  high_weight: number;
  low_weight: number;
  preview_image: string | null;
}

/** Just enough of a LoRA library entry to name and preview a cloned reference. */
export interface LoraLookup {
  id: string;
  name: string;
  preview_image: string | null;
}

export interface ClonedJobValues {
  name: string;
  fps: number;
  width: number;
  height: number;
  /** Always "" — see the note in `cloneJobValues`. */
  seed: string;
  lightx2vHigh: string;
  lightx2vLow: string;
  cfgHigh: string;
  cfgLow: string;
  stepsTotal: string;
  highNoiseSteps: string;
  flowShift: string;
  videoPresetId: string;
  tags: string;
  startingImageUri: string | null;
  prompt: string;
  negativePrompt: string;
  duration: number | null;
  speed: number | null;
  loras: ClonedLora[];
  faceswap: FaceswapConfigState | null;
}

/**
 * The live take at index 0 — the config the job is currently described by.
 *
 * Not `segments[0]`: after a re-roll the array's first element may be the ARCHIVED take.
 */
export function cloneSourceSegment(job: JobDetailResponse): SegmentResponse | null {
  return groupTakes(job.segments).live.find((s) => s.index === 0) ?? null;
}

const str = (v: number | null | undefined): string => (v == null ? "" : String(v));

export function cloneJobValues(
  job: JobDetailResponse,
  loraLibrary: LoraLookup[] = [],
): ClonedJobValues {
  const source = cloneSourceSegment(job);

  return {
    name: `${job.name} (copy)`,
    fps: job.fps,
    width: job.width,
    height: job.height,
    // NEVER cloned. `job.seed` arrives as a JSON *number*, and seeds are 64-bit with 95% of jobs
    // above 2**53 — so by the time it reaches the browser it has already been rounded (the same
    // reason segment seeds are sent as strings; see lib/segmentTakes). Carrying it would put an
    // exact-looking number in the field that never generated anything. Blank = a fresh seed,
    // which is what a clone wants regardless.
    seed: "",
    lightx2vHigh: str(job.lightx2v_strength_high),
    lightx2vLow: str(job.lightx2v_strength_low),
    cfgHigh: str(job.cfg_high),
    cfgLow: str(job.cfg_low),
    stepsTotal: str(job.steps_total),
    highNoiseSteps: str(job.high_noise_steps),
    flowShift: str(job.flow_shift),
    videoPresetId: job.video_preset_id ?? "",
    tags: job.tags ?? "",
    startingImageUri: job.starting_image ?? null,
    prompt: source?.prompt ?? "",
    negativePrompt: source?.negative_prompt ?? "",
    duration: source?.duration_seconds ?? null,
    speed: source?.speed ?? null,
    loras: cloneLoras(source, loraLibrary),
    faceswap: source ? cloneFaceswap(source) : null,
  };
}

function cloneLoras(source: SegmentResponse | null, library: LoraLookup[]): ClonedLora[] {
  return (source?.loras ?? []).flatMap((l) => {
    // A LoRA reference with no id cannot be re-selected in the picker; carrying a nameless row
    // would only look like a LoRA is loaded when none is.
    if (!l.lora_id) return [];
    const lib = library.find((item) => item.id === l.lora_id);
    return [{
      lora_id: l.lora_id,
      name: lib?.name ?? l.lora_id.slice(0, 8),
      high_weight: l.high_weight,
      low_weight: l.low_weight,
      preview_image: lib?.preview_image ?? null,
    }];
  });
}

function cloneFaceswap(source: SegmentResponse): FaceswapConfigState {
  // An "upload" face was a File, and this browser does not have it. The API stored those bytes in
  // S3 and put the URI on the segment, so the honest reconstruction is a PRESET pointing at that
  // same URI — identical face, no re-upload. Keeping sourceType="upload" would leave the picker
  // with no file and send no face at all.
  const wasUpload = source.faceswap_source_type === "upload" && !!source.faceswap_image;
  const sourceType = wasUpload
    ? "preset"
    : ((source.faceswap_source_type as FaceswapConfigState["sourceType"] | null)
        ?? DEFAULT_FACESWAP_SOURCE_TYPE);

  return {
    enabled: source.faceswap_enabled,
    method: source.faceswap_method ?? DEFAULT_FACESWAP_METHOD,
    sourceType,
    // The File cannot survive a clone; the URI above replaces it.
    file: null,
    // "start_frame" resolves its face from the start image at submit time. Parking a URI here
    // would be dead state that the mode never reads.
    presetUri: sourceType === "start_frame" ? null : (source.faceswap_image ?? null),
    facesIndex: source.faceswap_faces_index ?? DEFAULT_FACESWAP_FACES_INDEX,
    facesOrder: source.faceswap_faces_order ?? DEFAULT_FACESWAP_FACES_ORDER,
    model: source.faceswap_model ?? DEFAULT_FACESWAP_MODEL,
    pixelBoost: source.faceswap_pixel_boost ?? DEFAULT_FACESWAP_PIXEL_BOOST,
    seedFaceswap: source.seed_faceswap,
  };
}
