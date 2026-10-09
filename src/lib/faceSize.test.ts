import { describe, it, expect } from "vitest";
import type { DatasetFaceSize, FixSmallFacesStatus } from "../api/types";
import {
  AMBER_FACE_PX, SMALL_FACE_PX, derivedUris, faceSizeLabel, faceSizeLevel, faceSizeSummary, faceSizeTooltip,
  fixProgressLabel, isFixed, isPairSet, smallFacesWarning,
} from "./faceSize";

/**
 * The face-size badge (wanly-console#636). The number is the face's height AT TRAINING SIZE,
 * already converted by the API; these rules are about colouring it honestly and about not
 * confusing "no face" or "not measured" with "small".
 */
const face = (face_px: number | null, extra: Partial<DatasetFaceSize> = {}): DatasetFaceSize =>
  ({ width: 1080, height: 1440, face_px, faces: face_px === null ? 0 : 1, ...extra });

describe("faceSizeLevel", () => {
  it("is red under 250 and amber under 400 — the ticket's two lines", () => {
    expect(SMALL_FACE_PX).toBe(250);
    expect(AMBER_FACE_PX).toBe(400);
    expect(faceSizeLevel(face(249.9))).toBe("small");
    expect(faceSizeLevel(face(250))).toBe("amber");
    expect(faceSizeLevel(face(399))).toBe("amber");
    expect(faceSizeLevel(face(400))).toBe("ok");
  });

  it("keeps no face and not-yet-measured apart from small", () => {
    expect(faceSizeLevel(face(null))).toBe("no-face");
    expect(faceSizeLevel(undefined)).toBe("unmeasured");
  });
});

describe("faceSizeLabel and tooltip", () => {
  it("rounds to whole pixels", () => {
    expect(faceSizeLabel(face(181.6))).toBe("182 px");
    expect(faceSizeLabel(face(null))).toBe("no face");
  });

  it("says what to do about a small face", () => {
    expect(faceSizeTooltip(face(120))).toContain("Fix small faces");
    expect(faceSizeTooltip(face(500))).not.toContain("Fix small faces");
    expect(faceSizeTooltip(face(120), true)).toContain("crop added");
    expect(faceSizeTooltip(face(120), true)).not.toContain("adds an upscaled close-up");
  });

  it("warns that the largest of several faces may be the wrong person", () => {
    expect(faceSizeTooltip(face(300, { faces: 2 }))).toContain("may not be the subject");
  });
});

describe("faceSizeSummary", () => {
  const images = ["s3://b/a.jpg", "s3://b/b.jpg", "s3://b/c.jpg", "s3://b/d.jpg", "s3://b/m.mp4"];

  it("counts stills only, and unmeasured ones separately", () => {
    const s = faceSizeSummary({
      images,
      faces: { "s3://b/a.jpg": face(120), "s3://b/b.jpg": face(300), "s3://b/c.jpg": face(null),
               "s3://b/m.mp4": face(10) },
    });
    expect(s).toEqual({ stills: 4, measured: 3, small: 1, amber: 1, unmeasured: 1, fixed: 0 });
  });

  it("mirrors the preflight warning, and is silent with nothing small", () => {
    expect(smallFacesWarning({ images, faces: { "s3://b/a.jpg": face(120) } }))
      .toBe("1 of 4 images show the face under 250 px at training size — Fix small faces adds upscaled close-ups");
    expect(smallFacesWarning({ images, faces: null })).toBeNull();
  });

  it("counts a small photo whose crop is in the set as fixed, not small", () => {
    // Live on "Me" after a Fix: 12 originals with their crops in the set still read
    // "12 of 45 small" and offered the button again, because the photo itself never changes.
    const crop = "s3://b/portraits-x/000_a.jpg";
    const fixedFace = face(120, { crop_uri: crop });
    const s = faceSizeSummary({ images: [...images, crop], faces: { "s3://b/a.jpg": fixedFace } });
    expect([s.small, s.fixed]).toEqual([0, 1]);
    expect(smallFacesWarning({ images: [...images, crop], faces: { "s3://b/a.jpg": fixedFace } }))
      .toBeNull();
    expect(isFixed(fixedFace, [...images, crop])).toBe(true);
    // The crop removed since: small again, and Fix would offer it again.
    expect(faceSizeSummary({ images, faces: { "s3://b/a.jpg": fixedFace } }).small).toBe(1);
    expect(isFixed(fixedFace, images)).toBe(false);
  });
});

describe("fixProgressLabel", () => {
  const st = (o: Partial<FixSmallFacesStatus>): FixSmallFacesStatus =>
    ({ running: false, stage: null, done: 0, total: 0, error: null, summary: null, ...o });

  it("shows the stage and count while running", () => {
    expect(fixProgressLabel(st({ running: true, stage: "cropping", done: 4, total: 26 })))
      .toBe("Fixing small faces: cropping 4/26…");
    expect(fixProgressLabel(st({ running: true, stage: "measuring" })))
      .toBe("Fixing small faces: measuring…");
  });

  it("says why it stopped, and what a finished run did", () => {
    expect(fixProgressLabel(st({ error: "needs the worker image" })))
      .toBe("Fix small faces stopped: needs the worker image");
    expect(fixProgressLabel(st({ summary: "Fixed small faces: 1 upscaled" })))
      .toBe("Fixed small faces: 1 upscaled");
    expect(fixProgressLabel(st({}))).toBeNull();
    expect(fixProgressLabel(null)).toBeNull();
  });
});

describe("composition sets (wanly-api#436)", () => {
  const images = ["s3://b/a.jpg", "s3://b/b.jpg", "s3://b/c.jpg", "s3://b/d.jpg"];
  const pairFace = (face_px: number, pair_px: number | null) =>
    face(face_px, { pair_px, faces: pair_px === null ? 1 : 2, boxes: [[0, 0, 1, 1]] });

  it("judges a pair photo by the smaller of the two faces", () => {
    const e = pairFace(400, 180);
    expect(faceSizeLevel(e, true)).toBe("small");
    expect(faceSizeLevel(e)).toBe("ok");
    expect(faceSizeLabel(e, true)).toBe("180 px");
    expect(faceSizeTooltip(e, false, true)).toContain("two-person crop");
  });

  it("reads an entry from before #436 as unmeasured, so the open card re-measures it", () => {
    expect(faceSizeLevel(face(120), true)).toBe("unmeasured");
    expect(faceSizeLevel(face(120))).toBe("small");
  });

  it("does not count a one-face photo as small on a pair set", () => {
    const s = faceSizeSummary({
      kind: "composition", images,
      faces: { "s3://b/a.jpg": pairFace(400, 150), "s3://b/b.jpg": pairFace(120, null),
               "s3://b/c.jpg": face(120) },
    });
    expect(s).toEqual({ stills: 4, measured: 2, small: 1, amber: 0, unmeasured: 2, fixed: 0 });
    expect(isPairSet({ kind: "composition" })).toBe(true);
    expect(isPairSet({ kind: "character" })).toBe(false);
  });

  it("says two-person crops in the warning", () => {
    expect(smallFacesWarning({ kind: "composition", images,
                               faces: { "s3://b/a.jpg": pairFace(400, 150) } }))
      .toContain("adds upscaled two-person crops");
  });
});


describe("Fix's own results are never open small faces (2026-10-09, DavidJoana crop loop)", () => {
  it("does not count a still-small crop, so the button is not re-offered", () => {
    const orig = "s3://b/p.jpg";
    const crop = "s3://b/pairs-x/p_crop.jpg";
    const ds = {
      kind: "composition",
      images: [orig, crop],
      faces: {
        [orig]: { width: 3000, height: 4000, face_px: 90, pair_px: 90, boxes: [], crop_uri: crop },
        [crop]: { width: 1024, height: 683, face_px: 180, pair_px: 180, boxes: [] },
      },
    } as unknown as Parameters<typeof faceSizeSummary>[0];
    const s = faceSizeSummary(ds);
    expect(s.small).toBe(0);
    expect(s.fixed).toBe(1);
  });

  it("derivedUris lists crops and in-place upscales", () => {
    const d = derivedUris({ a: { crop_uri: "c" }, u: { upscaled_from: "o" }, c: {} } as never);
    expect([...d].sort()).toEqual(["c", "u"]);
  });
});
