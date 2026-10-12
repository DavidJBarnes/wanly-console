import { describe, expect, it } from "vitest";
import type { FixSmallFacesStatus } from "../api/types";
import { upscaleProgressLabel, upscaleSelectionProblem, upscaleTarget } from "./upscale";

const st = (o: Partial<FixSmallFacesStatus>): FixSmallFacesStatus => ({
  running: false, stage: null, done: 0, total: 0, error: null, summary: null, ...o,
});

describe("upscaleTarget", () => {
  it("multiplies the long edge, capped at 4096", () => {
    expect(upscaleTarget(1024, 768, 2)).toBe(2048);
    expect(upscaleTarget(768, 1024, 4)).toBe(4096);
    expect(upscaleTarget(3000, 2000, 2)).toBe(4096);
  });
  it("is unknown for an unmeasured image", () => {
    expect(upscaleTarget(null, 100, 2)).toBeNull();
  });
});

describe("upscaleSelectionProblem", () => {
  it("needs a pick", () => {
    expect(upscaleSelectionProblem(new Set())).toMatch(/pick/);
    expect(upscaleSelectionProblem(new Set(["a"]))).toBeNull();
  });
});

describe("upscaleProgressLabel", () => {
  it("counts while running, then gives the summary or the error", () => {
    expect(upscaleProgressLabel(null)).toBeNull();
    expect(upscaleProgressLabel(st({ running: true, stage: "upscaling", done: 1, total: 3 })))
      .toBe("Upscaling: upscaling 1/3…");
    expect(upscaleProgressLabel(st({ summary: "Upscaled 3 image(s) 2x" })))
      .toBe("Upscaled 3 image(s) 2x");
    expect(upscaleProgressLabel(st({ error: "boom" }))).toBe("Upscale stopped: boom");
  });
});
