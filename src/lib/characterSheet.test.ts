import { describe, expect, it } from "vitest";

import type { SheetJob } from "../api/ltx";
import {
  bodySentence, candidateScore, FACE_PANEL_W, FALLBACK_PRESETS, facePanelNote, initialSheetForm,
  MAX_COUNT, savedSeeds, SHEET_H, SHEET_W, sheetFormProblem, sheetGenderFor, sheetJobActive,
  sheetJobLine, sheetPanels, sheetRequest, switchGender, TURNAROUND_W,
} from "./characterSheet";

/**
 * The sheet builder (console#580, epic #582): a real face photo + outfit, hair and BODY words
 * -> N turnaround candidates on the image-edit queue -> one approved and saved as the
 * character's 1536x1024 sheet.
 */

const FACE = "s3://wanly-images/2026-09-30/kelly.png";

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

  it("body is its own sentence, never part of the outfit", () => {
    expect(bodySentence("an athletic build.", "female")).toBe("She has an athletic build.");
    expect(bodySentence("a broad build", "male")).toBe("He has a broad build.");
    expect(bodySentence("  ", "female")).toBe("");
    const body = sheetRequest({ ...initialSheetForm("woman"), faceUri: FACE,
                                body: " a petite frame " });
    expect(body.body).toBe("a petite frame");
    expect(body.outfit).not.toContain("petite");
  });

  it("says what is missing before anything is sent", () => {
    const f = initialSheetForm("woman");
    expect(sheetFormProblem(f)).toMatch(/face photo/);
    expect(sheetFormProblem({ ...f, faceUri: FACE, outfit: "  " })).toMatch(/outfit/);
    expect(sheetFormProblem({ ...f, faceUri: FACE, count: MAX_COUNT + 1 })).toMatch(/Between/);
    expect(sheetFormProblem({ ...f, faceUri: FACE, count: 0 })).toMatch(/Between/);
    expect(sheetFormProblem({ ...f, faceUri: FACE })).toBeNull();
  });

  it("sends trimmed words and leaves blanks out", () => {
    const body = sheetRequest({ faceUri: FACE, outfit: " jeans ", hair: " ", body: "",
                                gender: "female", count: 2 });
    expect(body).toEqual({ face_uri: FACE, outfit: "jeans", gender: "female", count: 2 });
  });

  it("the fallback presets complete 'She has ...'", () => {
    for (const p of FALLBACK_PRESETS.body) {
      expect(p.text).toMatch(/^[a-z]/);
      expect(p.text.endsWith(".")).toBe(false);
    }
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
      .toBe("AuraFace 0.61 vs the photo");
    expect(candidateScore({ identity: { aura: null, reason: "no face" } })).toBe("not scored: no face");
    expect(facePanelNote({ face_panel: "crop" })).toBeNull();
    expect(facePanelNote({ face_panel: "letterbox" })).toMatch(/letterboxed on white/);
    expect(facePanelNote({ face_panel: "centre", face_panel_note: null })).toMatch(/No face/);
    expect([...savedSeeds(job({ saved: [{ seed: 22, sheet_uri: "x" }] }))]).toEqual([22]);
  });
});
