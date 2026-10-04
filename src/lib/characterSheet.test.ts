import { describe, expect, it } from "vitest";

import type { CharacterSheetRecord, SheetJob } from "../api/ltx";
import {
  candidateScore, FACE_PANEL_W, FALLBACK_PRESETS, facePanelNote, facePanelPreview,
  initialSheetForm, MAX_COUNT, PHOTO_HINT, savedSeeds, SHEET_H, SHEET_W, sheetFormProblem, sheetGenderFor, sheetJobActive,
  sheetGallery, sheetGalleryLine, sheetJobLine, sheetPanels, sheetRequest, switchGender, TURNAROUND_W,
} from "./characterSheet";

/**
 * The sheet builder (console#580, #585, epic #582): ONE photo of her (face + body) + outfit and
 * hair words describing it -> N turnaround candidates on the image-edit queue, the face panel
 * auto-cropped from the same photo -> one approved and saved as the character's 1536x1024 sheet.
 */

const PHOTO = "s3://wanly-images/2026-10-01/kelly_full_body.png";

function job(over: Partial<SheetJob> = {}): SheetJob {
  return { id: "j1", state: "queued", message: "queued", request: {}, seeds: [11, 22, 33],
           candidates: [], saved: [], ...over };
}

describe("the layout", () => {
  it("is the 1536x1024 phase-0 sheet: a 448 px real face panel and a 1088 px turnaround", () => {
    expect([FACE_PANEL_W, TURNAROUND_W, SHEET_W, SHEET_H]).toEqual([448, 1088, 1536, 1024]);
  });

  it("labels the real panel and the three generated views, covering the sheet exactly", () => {
    const p = sheetPanels();
    expect(p.map((x) => x.kind)).toEqual(["real", "generated", "generated", "generated"]);
    expect(p[0].label).toBe("REAL");
    expect(p[0].caption).toBe("face cropped from the photo");
    expect(p.slice(1).map((x) => x.caption.split(" ")[0])).toEqual(["front", "side", "back"]);
    expect(p[0].widthPct).toBeCloseTo((448 / 1536) * 100);
    const end = p[3].leftPct + p[3].widthPct;
    expect(end).toBeCloseTo(100);
    for (let i = 1; i < p.length; i++) {
      expect(p[i].leftPct).toBeCloseTo(p[i - 1].leftPct + p[i - 1].widthPct);
    }
  });
});

describe("the form", () => {
  it("pre-fills outfit and hair from the recipe, by pronoun", () => {
    const f = initialSheetForm("woman");
    expect(f.gender).toBe("female");
    expect(f.outfit).toContain("she wears in image 1");
    expect(f.hair).toBe("her hair exactly as in image 1");
    expect(f.count).toBe(3);
    expect(initialSheetForm("man").gender).toBe("male");
    expect(initialSheetForm(null).gender).toBe("female");
    expect(sheetGenderFor("person")).toBe("female");
  });

  it("switching the pronoun re-fills defaults but never typed words", () => {
    const f = initialSheetForm("woman");
    const m = switchGender(f, "male");
    expect(m.outfit).toContain("he wears");
    expect(m.hair).toBe("his hair exactly as in image 1");
    const typed = switchGender({ ...f, outfit: "a red dress" }, "male");
    expect(typed.outfit).toBe("a red dress");
    expect(typed.hair).toBe("his hair exactly as in image 1");
  });

  it("has no body field: the build comes from the photo (#585)", () => {
    const f = initialSheetForm("woman");
    expect(Object.keys(f).sort()).toEqual(["count", "gender", "hair", "outfit", "photoUri"]);
    const body = sheetRequest({ ...f, photoUri: PHOTO });
    expect("body" in body).toBe(false);
    expect("face_uri" in body).toBe(false);
    expect("body" in FALLBACK_PRESETS).toBe(false);
  });

  it("says what is missing before anything is sent", () => {
    const f = initialSheetForm("woman");
    expect(sheetFormProblem(f)).toMatch(/photo of her \(face \+ body\)/);
    expect(sheetFormProblem({ ...f, photoUri: PHOTO, outfit: "  " })).toMatch(/outfit/);
    expect(sheetFormProblem({ ...f, photoUri: PHOTO, count: MAX_COUNT + 1 })).toMatch(/Between/);
    expect(sheetFormProblem({ ...f, photoUri: PHOTO, count: 0 })).toMatch(/Between/);
    expect(sheetFormProblem({ ...f, photoUri: PHOTO })).toBeNull();
  });

  it("sends trimmed words and leaves blanks out", () => {
    const body = sheetRequest({ photoUri: PHOTO, outfit: " jeans ", hair: " ",
                                gender: "female", count: 2 });
    expect(body).toEqual({ photo_uri: PHOTO, outfit: "jeans", gender: "female", count: 2 });
  });

  it("the defaults describe the photo, and the hint asks for a large face", () => {
    expect(FALLBACK_PRESETS.defaults.female.outfit).toContain("she wears in image 1");
    expect(FALLBACK_PRESETS.crop_padding).toBe(140);
    expect(PHOTO_HINT).toBe(
      "Use a photo where her face is reasonably large; a tiny face gives a soft face panel.");
  });
});

describe("the job", () => {
  it("shows the API's reason while it waits, with its place in the queue", () => {
    const line = sheetJobLine(job({
      state: "waiting", position: 1, elapsed_s: 75,
      message: "3090.zero is rendering; edit queued (the segment in flight finishes first)" }));
    expect(line).toContain("3090.zero is rendering");
    expect(line).toContain("1 job ahead");
    expect(line).toContain("1 min 15 s");
    expect(sheetJobLine(job({ state: "waiting",
      message: "3090.zero is training a LoRA; edit queued until it ends" })))
      .toContain("training a LoRA");
  });

  it("shows progress once running, and what a failure kept", () => {
    expect(sheetJobLine(job({ state: "running", message: "candidate 2 of 3 on 3090.zero" })))
      .toBe("candidate 2 of 3 on 3090.zero");
    const c = { seed: 11, candidate_uri: "a", sheet_uri: "b" };
    expect(sheetJobLine(job({ state: "failed", message: "timed out", candidates: [c] })))
      .toBe("Failed: timed out — 1 of 3 candidates were made and are kept");
    expect(sheetJobLine(job({ state: "done", candidates: [c, c, c], elapsed_s: 9 })))
      .toBe("3 candidates ready (9 s)");
  });

  it("is active until done or failed", () => {
    expect(sheetJobActive(job({ state: "waiting" }))).toBe(true);
    expect(sheetJobActive(job({ state: "done" }))).toBe(false);
    expect(sheetJobActive(null)).toBe(false);
  });

  it("scores and notes", () => {
    expect(candidateScore({ identity: { aura: 0.612, reason: null } }))
      .toBe("AuraFace 0.61 vs the face panel");
    expect(candidateScore({ identity: { aura: null, reason: "no face" } })).toBe("not scored: no face");
    expect(facePanelNote({ face_panel: "auto_crop", face_panel_crop: { scale: 0.9 } })).toBeNull();
    expect(facePanelNote({ face_panel: "auto_crop", face_panel_crop: { scale: 1.5 } })).toBeNull();
    expect(facePanelNote({ face_panel: "auto_crop", face_panel_crop: { scale: 2.6 } }))
      .toMatch(/enlarged 2\.6× and will be soft/);
    expect(facePanelNote({ face_panel: "auto_crop" })).toBeNull();
    expect(facePanelNote({ face_panel: "centre", face_panel_note: null })).toMatch(/No face/);
    expect([...savedSeeds(job({ saved: [{ seed: 22, sheet_uri: "x" }] }))]).toEqual([22]);
  });

  it("previews the auto-cropped face panel once a candidate has one", () => {
    expect(facePanelPreview(null)).toBeNull();
    expect(facePanelPreview(job())).toBeNull();
    const c = { seed: 11, candidate_uri: "a", sheet_uri: "b" };
    expect(facePanelPreview(job({ candidates: [c, { ...c, seed: 22,
      face_panel_preview_uri: "s3://wanly-jobs/sheet-jobs/j1/s22_face_panel.jpg" }] })))
      .toBe("s3://wanly-jobs/sheet-jobs/j1/s22_face_panel.jpg");
  });
});

describe("sheetGallery (console#598)", () => {
  const rec = (id: string, uri: string, at: string): CharacterSheetRecord => ({
    id, character_name: "Kelly", sheet_uri: uri, face_uri: "s3://b/photo.png", outfit: "o",
    prompt: "p", seed: Number(id), created_at: at, photo_mode: "one_photo",
  });

  it("puts the current sheet first, then the rest newest first", () => {
    const h = [rec("1", "s3://b/a.png", "2026-10-01T10:00:00Z"),
               rec("2", "s3://b/b.png", "2026-10-03T10:00:00Z"),
               rec("3", "s3://b/c.png", "2026-10-02T10:00:00Z")];
    const g = sheetGallery(h, "s3://b/a.png");
    expect(g.map((i) => i.uri)).toEqual(["s3://b/a.png", "s3://b/b.png", "s3://b/c.png"]);
    expect(g.map((i) => i.current)).toEqual([true, false, false]);
    expect(g[0].record?.id).toBe("1");
  });

  it("keeps a current sheet picked from the Image Repo, with no record", () => {
    const g = sheetGallery([rec("1", "s3://b/a.png", "2026-10-01T10:00:00Z")], "s3://repo/x.png");
    expect(g[0]).toEqual({ uri: "s3://repo/x.png", current: true, record: null });
    expect(sheetGalleryLine(g[0])).toBe("From the Image Repo · x.png");
    expect(g).toHaveLength(2);
  });

  it("lists a sheet saved twice once", () => {
    const h = [rec("1", "s3://b/a.png", "2026-10-01T10:00:00Z"),
               rec("2", "s3://b/a.png", "2026-10-02T10:00:00Z")];
    expect(sheetGallery(h, null).map((i) => i.record?.id)).toEqual(["2"]);
  });

  it("is empty with no sheets", () => {
    expect(sheetGallery([], null)).toEqual([]);
  });

  it("describes a built sheet by seed and photo", () => {
    const line = sheetGalleryLine({ uri: "s3://b/a.png", current: false,
                                    record: rec("7", "s3://b/a.png", "") });
    expect(line).toBe("seed 7 · photo photo.png");
  });
});
