import { describe, it, expect } from "vitest";
import type { DatasetFaceSize, FixSmallFacesStatus } from "../api/types";
import {
  AMBER_FACE_PX, SMALL_FACE_PX, faceSizeLabel, faceSizeLevel, faceSizeSummary, faceSizeTooltip,
  fixProgressLabel, smallFacesWarning,
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
    expect(s).toEqual({ stills: 4, measured: 3, small: 1, amber: 1, unmeasured: 1 });
  });

  it("mirrors the preflight warning, and is silent with nothing small", () => {
    expect(smallFacesWarning({ images, faces: { "s3://b/a.jpg": face(120) } }))
      .toBe("1 of 4 images show the face under 250 px at training size — Fix small faces adds upscaled close-ups");
    expect(smallFacesWarning({ images, faces: null })).toBeNull();
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
