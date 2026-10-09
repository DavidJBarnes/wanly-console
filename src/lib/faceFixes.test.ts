import { describe, it, expect } from "vitest";
import type { DatasetFaceSize } from "../api/types";
import { faceFixes, fixKindLabel, fixSizeLabel, fixesByResult } from "./faceFixes";

/**
 * The "Fixes" view (wanly-console#642): original -> result pairs read back from the `faces`
 * links "Fix small faces" leaves (crop_uri on a photo, upscaled_from on an in-place copy).
 */
const face = (face_px: number | null, extra: Partial<DatasetFaceSize> = {}): DatasetFaceSize =>
  ({ width: 1080, height: 1440, face_px, faces: face_px === null ? 0 : 1, ...extra });

describe("faceFixes", () => {
  const a = "s3://b/a.jpg";
  const b = "s3://b/b.jpg";
  const tiny = "s3://b/tiny.jpg";
  const up = "s3://b/fixed/tiny_up.jpg";
  const crop = "s3://b/fixed/000_a.jpg";

  it("pairs a crop with its photo and an upscale with its original, in the set's order", () => {
    const ds = {
      images: [up, a, b, crop],
      faces: {
        [a]: face(145, { crop_uri: crop }), [b]: face(500), [crop]: face(610),
        [up]: face(320, { upscaled_from: tiny }),
      },
    };
    const fixes = faceFixes(ds);
    expect(fixes.map((f) => [f.kind, f.original, f.result])).toEqual([
      ["upscale", tiny, up], ["crop", a, crop],
    ]);
    expect(fixes[1]).toMatchObject({ originalInSet: true, beforePx: 145, afterPx: 610 });
    expect(fixSizeLabel(fixes[1])).toBe("145 px → 610 px");
    // The API drops the original's measurement when it swaps the copy in: say "?", not 0.
    expect(fixes[0]).toMatchObject({ originalInSet: false, beforeUnknown: true });
    expect(fixSizeLabel(fixes[0])).toBe("? → 320 px");
    expect(Object.keys(fixesByResult(fixes))).toEqual([up, crop]);
  });

  it("drops a crop that has been removed from the set", () => {
    const ds = { images: [a], faces: { [a]: face(145, { crop_uri: crop }), [crop]: face(610) } };
    expect(faceFixes(ds)).toEqual([]);
    expect(faceFixes({ images: [a], faces: null })).toEqual([]);
  });

  it("keeps a crop whose photo was removed, and shows that photo from S3", () => {
    const ds = { images: [crop], faces: { [a]: face(145, { crop_uri: crop }) } };
    expect(faceFixes(ds)[0]).toMatchObject({ original: a, originalInSet: false, afterPx: null });
    expect(fixSizeLabel(faceFixes(ds)[0])).toBe("145 px → no face");
  });

  it("reads pair_px on a composition set", () => {
    const ds = {
      kind: "composition" as const, images: [a, crop],
      faces: { [a]: face(400, { pair_px: 150, crop_uri: crop }),
               [crop]: face(700, { pair_px: null }) },
    };
    const [fix] = faceFixes(ds);
    expect(fixSizeLabel(fix, true)).toBe("150 px → fewer than 2 faces");
    expect(fixKindLabel(fix, true)).toBe("two-person crop");
    expect(fixKindLabel(fix)).toBe("head-and-shoulders crop");
  });
});
