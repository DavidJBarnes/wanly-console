import { describe, it, expect } from "vitest";
import {
  buildFaceswapFields,
  resolveFaceswapImage,
  shouldAttachStartImageAsFace,
  type FaceswapConfigState,
} from "./faceswapPayload";

/** A state with the swap on and Start Frame selected -- the validated recipe. */
function state(overrides: Partial<FaceswapConfigState> = {}): FaceswapConfigState {
  return {
    enabled: true,
    method: "facefusion",
    sourceType: "start_frame",
    file: null,
    presetUri: null,
    facesIndex: "0",
    facesOrder: "left-right",
    model: "inswapper_128",
    pixelBoost: "512x512",
    seedFaceswap: false,
    ...overrides,
  };
}

/** Stand-in for an uploaded start image. Only its presence matters here. */
const FILE = { name: "start.png" } as unknown as File;

const JOB_IMAGE = "s3://wanly-images/2026-08-03/00003-710610150-swapped.png";
const REPO_IMAGE = "s3://wanly-images/2026-08-03/00010-398706875-swapped.png";
const LAST_FRAME = "s3://wanly-jobs/abc/1_last_frame.png";

describe("regressions — each of these shipped to production", () => {
  it("#276: a repo-picked start image travels as a URI in the body", () => {
    // The attach branch was guarded on the uploaded File, so a repo pick sent no face at all.
    // The daemon gates on `faceswap_enabled AND faceswap_image`, so the swap silently did not
    // run while the UI still showed it on. Nine queued jobs were affected.
    const f = buildFaceswapFields(state(), {
      startingImageFile: null,
      startingImageUri: REPO_IMAGE,
    });
    expect(f.faceswap_image).toBe(REPO_IMAGE);
  });

  it("#274: a continuation swaps toward the JOB's image, never the previous last frame", () => {
    // The last frame has already drifted; swapping toward it locks the drift in.
    // Measured 0.906 (job image) vs 0.644 (other face).
    const img = resolveFaceswapImage(state(), {
      jobStartingImage: JOB_IMAGE,
      startingImageUri: LAST_FRAME,
    });
    expect(img).toBe(JOB_IMAGE);
    expect(img).not.toBe(LAST_FRAME);
  });

  it("the job image wins even when a repo URI is also present", () => {
    expect(
      resolveFaceswapImage(state(), {
        jobStartingImage: JOB_IMAGE,
        startingImageUri: REPO_IMAGE,
      }),
    ).toBe(JOB_IMAGE);
  });
});

describe("upload vs URI — exactly one path may produce the face", () => {
  it("an uploaded File is attached as multipart, so the body field stays null", () => {
    const ctx = { startingImageFile: FILE, startingImageUri: null };
    expect(resolveFaceswapImage(state(), ctx)).toBeNull();
    expect(shouldAttachStartImageAsFace(state(), ctx)).toBe(true);
  });

  it("a repo URI goes in the body and nothing is attached", () => {
    const ctx = { startingImageFile: null, startingImageUri: REPO_IMAGE };
    expect(resolveFaceswapImage(state(), ctx)).toBe(REPO_IMAGE);
    expect(shouldAttachStartImageAsFace(state(), ctx)).toBe(false);
  });

  it("never both — that would send two different faces", () => {
    for (const ctx of [
      { startingImageFile: FILE, startingImageUri: null },
      { startingImageFile: null, startingImageUri: REPO_IMAGE },
      { jobStartingImage: JOB_IMAGE },
      {},
    ]) {
      const inBody = resolveFaceswapImage(state(), ctx) !== null;
      const attached = shouldAttachStartImageAsFace(state(), ctx);
      expect(inBody && attached).toBe(false);
    }
  });
});

describe("gating", () => {
  it("seed-only re-anchor still carries the face and settings", () => {
    // seedFaceswap is independent of enabled: the seed is re-anchored without swapping the
    // video, so every field except faceswap_enabled must still be populated.
    const f = buildFaceswapFields(state({ enabled: false, seedFaceswap: true }), {
      jobStartingImage: JOB_IMAGE,
    });
    expect(f.faceswap_enabled).toBe(false);
    expect(f.seed_faceswap).toBe(true);
    expect(f.faceswap_image).toBe(JOB_IMAGE);
    expect(f.faceswap_method).toBe("facefusion");
    expect(f.faceswap_model).toBe("inswapper_128");
  });

  it("both off nulls every field", () => {
    const f = buildFaceswapFields(state({ enabled: false, seedFaceswap: false }), {
      jobStartingImage: JOB_IMAGE,
    });
    expect(f).toEqual({
      faceswap_enabled: false,
      faceswap_method: null,
      faceswap_source_type: null,
      faceswap_image: null,
      faceswap_faces_index: null,
      faceswap_faces_order: null,
      faceswap_model: null,
      faceswap_pixel_boost: null,
      seed_faceswap: false,
    });
  });

  it("preset source uses the preset URI, ignoring start images", () => {
    const f = buildFaceswapFields(
      state({ sourceType: "preset", presetUri: "s3://wanly-faces/kelly.jpg" }),
      { jobStartingImage: JOB_IMAGE, startingImageUri: REPO_IMAGE },
    );
    expect(f.faceswap_image).toBe("s3://wanly-faces/kelly.jpg");
  });

  it("start_frame with nothing configured yields null rather than throwing", () => {
    // Null is a silent no-op downstream, so this asserts the shape, not that it is desirable.
    expect(resolveFaceswapImage(state(), {})).toBeNull();
  });
});

describe("passthrough fields", () => {
  it("carries method, selector and swapper settings verbatim", () => {
    const f = buildFaceswapFields(
      state({
        method: "reactor",
        facesIndex: "1",
        facesOrder: "large-small",
        model: "hyperswap_1c_256",
        pixelBoost: "256x256",
      }),
      { jobStartingImage: JOB_IMAGE },
    );
    expect(f.faceswap_method).toBe("reactor");
    expect(f.faceswap_source_type).toBe("start_frame");
    expect(f.faceswap_faces_index).toBe("1");
    expect(f.faceswap_faces_order).toBe("large-small");
    expect(f.faceswap_model).toBe("hyperswap_1c_256");
    expect(f.faceswap_pixel_boost).toBe("256x256");
  });
});
