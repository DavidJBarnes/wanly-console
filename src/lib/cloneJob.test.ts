import { describe, it, expect } from "vitest";
import { cloneJobValues, cloneSourceSegment, type LoraLookup } from "./cloneJob";
import type { JobDetailResponse, SegmentResponse } from "../api/types";

const FACE = "s3://wanly-jobs/8f3a/faceswap_source.png";
const START = "s3://wanly-images/2026-08-03/00003-710610150-swapped.png";

function seg(overrides: Partial<SegmentResponse> = {}): SegmentResponse {
  return {
    index: 0,
    prompt: "a woman turns toward the camera",
    negative_prompt: "blurry",
    duration_seconds: 5,
    speed: 1.0,
    discarded: false,
    created_at: "2026-08-01T00:00:00Z",
    loras: null,
    faceswap_enabled: false,
    faceswap_method: null,
    faceswap_source_type: null,
    faceswap_image: null,
    faceswap_faces_order: null,
    faceswap_faces_index: null,
    faceswap_model: null,
    faceswap_pixel_boost: null,
    seed_faceswap: false,
    ...overrides,
  } as unknown as SegmentResponse;
}

function job(overrides: Partial<JobDetailResponse> = {}): JobDetailResponse {
  return {
    name: "k3llydw_60fps",
    width: 704,
    height: 480,
    fps: 60,
    // A real seed, above 2**53. Written through Number() rather than as a literal because a
    // literal trips no-loss-of-precision — which is the whole point: this is the same rounding
    // JSON.parse already applied before the value reached the browser.
    seed: Number("3150982733094861699"),
    starting_image: START,
    lightx2v_strength_high: 1,
    lightx2v_strength_low: 0,
    cfg_high: 2.5,
    cfg_low: 2.5,
    steps_total: 12,
    high_noise_steps: 2,
    flow_shift: 5,
    video_preset_id: "preset-1",
    tags: "doggystyle,front",
    segments: [seg()],
    ...overrides,
  } as unknown as JobDetailResponse;
}

describe("cloneSourceSegment", () => {
  it("takes the LIVE take at index 0, not the array's first element", () => {
    const archived = seg({ prompt: "the old prompt", discarded: true });
    const live = seg({ prompt: "the current prompt" });
    // Archived first, exactly as a re-rolled job arrives.
    const source = cloneSourceSegment(job({ segments: [archived, live, seg({ index: 1 })] }));
    expect(source?.prompt).toBe("the current prompt");
  });

  it("is null when the job has no live segment 0", () => {
    expect(cloneSourceSegment(job({ segments: [seg({ discarded: true })] }))).toBeNull();
  });
});

describe("cloneJobValues", () => {
  it("carries the job's settings and start image", () => {
    const v = cloneJobValues(job());
    expect(v.name).toBe("k3llydw_60fps (copy)");
    expect(v.fps).toBe(60);
    expect(v.width).toBe(704);
    expect(v.height).toBe(480);
    expect(v.cfgHigh).toBe("2.5");
    expect(v.stepsTotal).toBe("12");
    expect(v.flowShift).toBe("5");
    expect(v.videoPresetId).toBe("preset-1");
    expect(v.tags).toBe("doggystyle,front");
    expect(v.startingImageUri).toBe(START);
  });

  it("carries the live segment's prompt, duration and speed", () => {
    const v = cloneJobValues(job({ segments: [seg({ duration_seconds: 3, speed: 1.25 })] }));
    expect(v.prompt).toBe("a woman turns toward the camera");
    expect(v.negativePrompt).toBe("blurry");
    expect(v.duration).toBe(3);
    expect(v.speed).toBe(1.25);
  });

  it("NEVER carries the seed — it arrives rounded and would reproduce nothing", () => {
    expect(cloneJobValues(job()).seed).toBe("");
  });

  it("renders an unset sampler field as empty, not '0' or 'null'", () => {
    const v = cloneJobValues(job({ cfg_high: null, steps_total: null }));
    expect(v.cfgHigh).toBe("");
    expect(v.stepsTotal).toBe("");
  });

  it("survives a job whose live segment 0 is gone", () => {
    const v = cloneJobValues(job({ segments: [seg({ discarded: true })] }));
    expect(v.prompt).toBe("");
    expect(v.loras).toEqual([]);
    expect(v.faceswap).toBeNull();
    // Job-level settings still clone.
    expect(v.fps).toBe(60);
  });

  describe("LoRAs", () => {
    const LIB: LoraLookup[] = [{ id: "lora-a", name: "k3llydw", preview_image: "p.png" }];

    it("names and previews from the library", () => {
      const v = cloneJobValues(
        job({ segments: [seg({ loras: [{ lora_id: "lora-a", high_weight: 0, low_weight: 1 }] })] }),
        LIB,
      );
      expect(v.loras).toEqual([
        { lora_id: "lora-a", name: "k3llydw", high_weight: 0, low_weight: 1, preview_image: "p.png" },
      ]);
    });

    it("falls back to a truncated id when the library has no entry", () => {
      const v = cloneJobValues(
        job({ segments: [seg({ loras: [{ lora_id: "abcdefgh-1234", high_weight: 1, low_weight: 0 }] })] }),
        LIB,
      );
      expect(v.loras[0].name).toBe("abcdefgh");
      expect(v.loras[0].preview_image).toBeNull();
    });

    it("drops a reference with no id rather than showing a phantom LoRA", () => {
      const v = cloneJobValues(
        job({ segments: [seg({ loras: [{ high_weight: 1, low_weight: 1 }] })] }),
        LIB,
      );
      expect(v.loras).toEqual([]);
    });
  });

  describe("faceswap", () => {
    it("clones an UPLOAD face as a preset pointing at the stored URI", () => {
      // The File is gone; the bytes are in S3. Keeping sourceType="upload" would send no face
      // while the swap stayed enabled — a silent no-op in the daemon.
      const v = cloneJobValues(job({
        segments: [seg({
          faceswap_enabled: true,
          faceswap_source_type: "upload",
          faceswap_image: FACE,
        })],
      }));
      expect(v.faceswap?.sourceType).toBe("preset");
      expect(v.faceswap?.presetUri).toBe(FACE);
      expect(v.faceswap?.file).toBeNull();
      expect(v.faceswap?.enabled).toBe(true);
    });

    it("leaves start_frame alone and parks no dead URI on it", () => {
      const v = cloneJobValues(job({
        segments: [seg({
          faceswap_enabled: true,
          faceswap_source_type: "start_frame",
          faceswap_image: START,
        })],
      }));
      expect(v.faceswap?.sourceType).toBe("start_frame");
      expect(v.faceswap?.presetUri).toBeNull();
    });

    it("keeps a preset face as a preset", () => {
      const v = cloneJobValues(job({
        segments: [seg({
          faceswap_enabled: true,
          faceswap_source_type: "preset",
          faceswap_image: FACE,
          faceswap_model: "inswapper_128",
          faceswap_pixel_boost: "512x512",
          faceswap_faces_index: "1",
          faceswap_faces_order: "large-small",
        })],
      }));
      expect(v.faceswap?.sourceType).toBe("preset");
      expect(v.faceswap?.presetUri).toBe(FACE);
      expect(v.faceswap?.model).toBe("inswapper_128");
      expect(v.faceswap?.pixelBoost).toBe("512x512");
      expect(v.faceswap?.facesIndex).toBe("1");
      expect(v.faceswap?.facesOrder).toBe("large-small");
    });

    it("carries a seed-only re-anchor, which is independent of enabled", () => {
      const v = cloneJobValues(job({
        segments: [seg({
          faceswap_enabled: false,
          seed_faceswap: true,
          faceswap_source_type: "preset",
          faceswap_image: FACE,
        })],
      }));
      expect(v.faceswap?.enabled).toBe(false);
      expect(v.faceswap?.seedFaceswap).toBe(true);
      expect(v.faceswap?.presetUri).toBe(FACE);
    });

    it("falls back to defaults when the segment stored no swap config", () => {
      const v = cloneJobValues(job());
      expect(v.faceswap?.enabled).toBe(false);
      expect(v.faceswap?.sourceType).toBe("start_frame");
      expect(v.faceswap?.method).toBe("facefusion");
    });
  });
});
