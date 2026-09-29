import { describe, expect, it } from "vitest";
import { dimensionsLabel, renderSize } from "./renderSize";

describe("renderSize", () => {
  it("uses the render size the API reports", () => {
    expect(renderSize({ width: 1856, height: 1280, render_width: 1216, render_height: 832 }))
      .toEqual({ width: 1216, height: 832 });
  });

  it("falls back to the job's size when the API sends none", () => {
    // An older API, or create/update, which return the bare row.
    expect(renderSize({ width: 1216, height: 832 })).toEqual({ width: 1216, height: 832 });
    expect(renderSize({ width: 1216, height: 832, render_width: null, render_height: null }))
      .toEqual({ width: 1216, height: 832 });
  });
});

describe("dimensionsLabel", () => {
  it("names both sizes when the render is capped", () => {
    expect(dimensionsLabel({ width: 1856, height: 1280, render_width: 1216, render_height: 832 }))
      .toBe("1856×1280 start frame → renders 1216×832");
  });

  it("is unchanged when the clip renders at the frame's size", () => {
    expect(dimensionsLabel({ width: 1216, height: 832, render_width: 1216, render_height: 832 }))
      .toBe("1216x832");
    expect(dimensionsLabel({ width: 832, height: 1216 })).toBe("832x1216");
  });
});
