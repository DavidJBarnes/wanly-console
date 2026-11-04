import { describe, expect, it } from "vitest";
import { jobStage2Sigmas, segmentStage2Sigmas, stage2SigmasProblem, STAGE2_SIGMAS_PRESETS } from "./stage2Sigmas";
import type { LtxRecipeRef } from "../api/types";

const DEFAULT = "0.85, 0.7250, 0.4219, 0.0";
const seg = (recipe: Partial<LtxRecipeRef> | null, claimed = true, reprocess: string | null = null) => ({
  ltx_recipe: recipe as LtxRecipeRef | null,
  claimed_at: claimed ? "2026-11-04T00:00:00Z" : null,
  reprocess_type: reprocess,
});

describe("segmentStage2Sigmas", () => {
  it("shows the stamped value", () => {
    expect(segmentStage2Sigmas(seg({ stage2_sigmas: "0.725, 0.4219, 0.0" }), DEFAULT)).toBe("0.725, 0.4219, 0.0");
  });
  it("names the default when a claimed render has no stamp", () => {
    expect(segmentStage2Sigmas(seg({}), DEFAULT)).toBe(`default (${DEFAULT})`);
    expect(segmentStage2Sigmas(seg({}), "")).toBe("default");
  });
  it("says nothing before claim, for reprocesses, or without a recipe", () => {
    expect(segmentStage2Sigmas(seg({}, false), DEFAULT)).toBeNull();
    expect(segmentStage2Sigmas(seg({}, true, "faceswap"), DEFAULT)).toBeNull();
    expect(segmentStage2Sigmas(seg(null), DEFAULT)).toBeNull();
  });
});

describe("jobStage2Sigmas", () => {
  it("collapses agreeing segments to one value", () => {
    expect(jobStage2Sigmas([seg({ stage2_sigmas: "0.4219, 0.0" }), seg({ stage2_sigmas: "0.4219, 0.0" }), seg({}, false)], DEFAULT))
      .toBe("0.4219, 0.0");
  });
  it("says when the setting changed between segments", () => {
    expect(jobStage2Sigmas([seg({ stage2_sigmas: "0.4219, 0.0" }), seg({})], DEFAULT)).toBe("varies by segment");
  });
  it("is null when nothing has run", () => {
    expect(jobStage2Sigmas([seg({}, false)], DEFAULT)).toBeNull();
  });
});

describe("STAGE2_SIGMAS_PRESETS", () => {
  it("are all valid schedules", () => {
    for (const p of STAGE2_SIGMAS_PRESETS) expect(stage2SigmasProblem(p.value)).toBeNull();
  });
});
