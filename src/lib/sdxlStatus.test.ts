import { describe, expect, it } from "vitest";
import { sdxlChipLabel, sdxlTooltip } from "./sdxlStatus";

const base = {
  run_id: "r", run_version: 4, at: "2026-10-08T21:12:00Z", name: "Joana_sdxl_v4_e11",
  label: "e11", uploaded: true, a1111_images: 266, tested: true,
  a1111_last_used_at: "2026-10-10T00:11:00Z", checkpoints: [],
};

describe("SDXL status (wanly-api#458)", () => {
  it("says how many A1111 images used it", () => {
    expect(sdxlChipLabel(base)).toBe("Tested in A1111 · 266 images");
    expect(sdxlChipLabel({ ...base, a1111_images: 1 })).toBe("Tested in A1111 · 1 image");
    expect(sdxlChipLabel({ ...base, tested: false, a1111_images: 0 })).toBe("Untested");
  });
  it("names the source in the tooltip", () => {
    expect(sdxlTooltip(base)).toMatch(/Newest SDXL run: v4/);
    expect(sdxlTooltip(base)).toMatch(/266 A1111 images used its checkpoints; last used/);
    expect(sdxlTooltip(base)).toMatch(/Counted from A1111's saved images on 3090b\./);
    expect(sdxlTooltip({ ...base, tested: false, a1111_images: 0 }))
      .toMatch(/No A1111 image has used any of its checkpoints yet/);
  });
});
