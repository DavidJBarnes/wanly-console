import { describe, it, expect } from "vitest";
import {
  datasetChoices, datasetSaveProblem, faceChoice, faceHint, initialFace, instructionProblem,
  isEditedImage, MAX_INSTRUCTION, pickerFaces, savedName, scaleBox,
} from "./imageEdit";
import type { Dataset, ImageEditFaces } from "../api/types";

const ds = (over: Partial<Dataset> = {}): Dataset => ({
  id: "d1", name: "Kelly v3", tags: null, notes: null, images: [], prefix: null,
  anchor_uri: null, locked: false, trained_by: [], locked_at: null, ...over,
} as Dataset);

describe("saving to a dataset", () => {
  it("an unlocked set is fine", () => {
    expect(datasetSaveProblem(ds())).toBeNull();
  });

  it("a locked set says why, before the API's 409 does", () => {
    const why = datasetSaveProblem(ds({ locked: true, locked_at: "2026-09-01T00:00:00Z", locked_reason: "final" }));
    expect(why).toMatch(/Locked/);
    expect(why).toMatch(/final/);
  });

  it("no set is a prompt, not a crash", () => {
    expect(datasetSaveProblem(null)).toBe("Pick a dataset");
  });

  it("offers unlocked sets first and keeps locked ones visible", () => {
    const got = datasetChoices([
      ds({ id: "a", name: "Zed" }),
      ds({ id: "b", name: "Alpha", locked: true, trained_by: [] }),
      ds({ id: "c", name: "Beta" }),
    ]);
    expect(got.map((c) => c.ds.id)).toEqual(["c", "a", "b"]);
    expect(got[2].problem).toMatch(/Locked/);
  });
});

describe("chained edits", () => {
  it("recognises this tool's own output", () => {
    expect(isEditedImage("s3://b/2026-09-01/sel_008_edit-smile_1a2b3c.png")).toBe(true);
    expect(isEditedImage("s3://b/datasets/x/edits/a_edit-custom_abcdef.png")).toBe(true);
    // A combined edit's tag (#569): angle and expression together.
    expect(isEditedImage("s3://b/2026-09-30/k_edit-profile_left-smile_0a1b2c.png")).toBe(true);
  });

  it("leaves ordinary images alone", () => {
    expect(isEditedImage("s3://b/2026-09-01/sel_008.jpg")).toBe(false);
    expect(isEditedImage("s3://b/2026-09-01/my_edit-notes.png")).toBe(false);
  });
});

describe("saved files and descriptions", () => {
  it("names a saved file", () => {
    expect(savedName("s3://b/f/a_edit-smile_123abc.png")).toBe("a_edit-smile_123abc.png");
  });

  it("a description is optional, but not a paste", () => {
    expect(instructionProblem("")).toBeNull();
    expect(instructionProblem("a warm smile")).toBeNull();
    expect(instructionProblem("x".repeat(MAX_INSTRUCTION + 1))).toMatch(/under 2000/);
  });
});

describe("which face (#553)", () => {
  // What the API says about a 1248x1824 two-person frame.
  const TWO: ImageEditFaces = {
    width: 1248, height: 1824, default_index: 1, faces: [
      { index: 0, box: [101.5, 400, 351.5, 700], width: 250 },
      { index: 1, box: [700, 380, 940, 670], width: 240 },
    ],
  };
  const ONE: ImageEditFaces = { ...TWO, default_index: 0, faces: [TWO.faces[0]] };

  it("draws a picker only for two or more faces", () => {
    expect(pickerFaces(TWO)).toHaveLength(2);
    expect(pickerFaces(ONE)).toEqual([]);
    expect(pickerFaces(null)).toEqual([]);
    expect(pickerFaces({ ...TWO, faces: [] })).toEqual([]);
    expect(pickerFaces({ ...TWO, width: 0 })).toEqual([]);
  });

  it("starts on the face the service would edit anyway", () => {
    expect(initialFace(TWO)).toBe(1);
    expect(initialFace({ ...TWO, default_index: null })).toBe(0);
    expect(initialFace({ ...TWO, default_index: 7 })).toBe(0);
    expect(initialFace(ONE)).toBeNull();
    expect(initialFace(null)).toBeNull();
  });

  it("names the face by its box, and sends nothing without a picker", () => {
    expect(faceChoice(TWO, 0)).toEqual({ face_box: [101.5, 400, 351.5, 700] });
    expect(faceChoice(TWO, 5)).toEqual({});
    expect(faceChoice(TWO, null)).toEqual({});
    expect(faceChoice(ONE, 0)).toEqual({}); // one face: the request is exactly today's
    expect(faceChoice(null, 0)).toEqual({});
  });

  it("scales a box from source pixels to the drawn image, plus its offset in the pane", () => {
    // 1248x1824 drawn at 301x440 (height-bound), centred in a 600-wide pane.
    const drawn = { width: 1248 * (440 / 1824), height: 440 };
    const left = (600 - drawn.width) / 2;
    const b = scaleBox([700, 380, 940, 670], TWO, drawn, { left, top: 0 });
    const s = 440 / 1824;
    expect(b.left).toBeCloseTo(left + 700 * s);
    expect(b.top).toBeCloseTo(380 * s);
    expect(b.width).toBeCloseTo(240 * s);
    expect(b.height).toBeCloseTo(290 * s);
  });

  it("the whole frame maps to the whole drawn image", () => {
    const b = scaleBox([0, 0, 1248, 1824], TWO, { width: 312, height: 456 });
    expect(b).toEqual({ left: 0, top: 0, width: 312, height: 456 });
  });

  it("scales x and y independently", () => {
    const b = scaleBox([10, 10, 20, 20], { width: 100, height: 100 }, { width: 200, height: 50 });
    expect(b).toEqual({ left: 20, top: 5, width: 20, height: 5 });
  });

  it("the hint says how to reach the next face", () => {
    expect(faceHint(3)).toMatch(/^3 faces/);
    expect(faceHint(2)).toMatch(/save, then edit the saved image/);
    expect(faceHint(2)).toMatch(/Only that face is regenerated/);
  });
});

// ------------------------------------------------------------ the edit (#548, #569)

import {
  angleSet, describeAngle, describeEdit, editBody, headPresetFor, identityVerdict, jobActive,
  jobStatusLine, NO_EDIT, QWEN_NOTE,
} from "./imageEdit";
import type { ExpressionPreset, HeadAnglePreset } from "../api/types";

const ANGLES: HeadAnglePreset[] = [
  { name: "look_left", label: "Look left", yaw: -20, pitch: 0, route: "full" },
  { name: "profile_left", label: "Profile left", yaw: -90, pitch: 0, route: "full" },
  { name: "look_up", label: "Look up", yaw: 0, pitch: 30, route: "full" },
];
const EXPRS: ExpressionPreset[] = [
  { name: "smile", label: "Smile" }, { name: "big_laugh", label: "Big laugh" },
];
const SRC = "s3://b/x.png";

describe("one Qwen job for everything (#569)", () => {
  it("a small head turn is a Qwen job too: there is no LivePortrait route", () => {
    expect(editBody(SRC, { ...NO_EDIT, yaw: -20 }, ANGLES))
      .toEqual({ source_uri: SRC, mode: "full", head_preset: "look_left" });
    expect(editBody(SRC, { ...NO_EDIT, yaw: 10 }, ANGLES))
      .toEqual({ source_uri: SRC, mode: "full", angle: { yaw: 10, pitch: 0 } });
  });

  it("an expression preset is sent by name", () => {
    expect(editBody(SRC, { ...NO_EDIT, expression: "big_laugh" }))
      .toEqual({ source_uri: SRC, mode: "full", preset: "big_laugh" });
  });

  it("the description goes straight through as the instruction", () => {
    expect(editBody(SRC, { ...NO_EDIT, text: "  make her smile, eyes to camera  " }))
      .toEqual({ source_uri: SRC, mode: "full", instruction: "make her smile, eyes to camera" });
  });

  it("all three compose into one request, on the chosen face", () => {
    expect(editBody(SRC, { yaw: -90, pitch: 0, expression: "smile", text: "red sweater" }, ANGLES,
      { face_box: [1, 2, 3, 4] })).toEqual({
      source_uri: SRC, mode: "full", head_preset: "profile_left", preset: "smile",
      instruction: "red sweater", face_box: [1, 2, 3, 4],
    });
  });

  it("nothing chosen, or an angle under 5°, is nothing to run", () => {
    expect(editBody(SRC, NO_EDIT)).toBeNull();
    expect(editBody(SRC, { ...NO_EDIT, yaw: 3, pitch: -4, text: "   " })).toBeNull();
    expect(angleSet(0, 5)).toBe(true);
    expect(angleSet(-4, 4)).toBe(false);
  });

  it("names the preset when the angles are exactly one", () => {
    expect(headPresetFor(ANGLES, -90, 0)?.name).toBe("profile_left");
    expect(headPresetFor(ANGLES, -85, 0)).toBeNull();
  });

  it("says what Run will do", () => {
    expect(describeEdit({ yaw: -90, pitch: 0, expression: "smile", text: "red sweater" }, ANGLES, EXPRS))
      .toBe("Profile left · Smile · “red sweater”");
    expect(describeEdit({ ...NO_EDIT, yaw: 60, pitch: -10 }, ANGLES, EXPRS)).toBe("Turn 60° right, tilt 10° down");
    expect(describeEdit({ ...NO_EDIT, text: "x".repeat(80) })).toMatch(/…”$/);
    expect(describeEdit(NO_EDIT)).toBe("");
  });

  it("says the angle in words, left/right as the picture is seen", () => {
    expect(describeAngle(-45, 20)).toBe("Turn 45° left, tilt 20° up");
    expect(describeAngle(0, -30)).toBe("Tilt 30° down");
    expect(describeAngle(0, 0)).toBe("Straight ahead");
  });

  it("states the Qwen premise once, not as an exception", () => {
    expect(QWEN_NOTE).toMatch(/regenerates/);
    expect(QWEN_NOTE).not.toMatch(/Face mode/);
  });
});

describe("full-mode jobs", () => {
  it("is active until done or failed", () => {
    expect(jobActive({ state: "queued" })).toBe(true);
    expect(jobActive({ state: "waiting" })).toBe(true);
    expect(jobActive({ state: "running" })).toBe(true);
    expect(jobActive({ state: "done" })).toBe(false);
    expect(jobActive({ state: "failed" })).toBe(false);
    expect(jobActive(null)).toBe(false);
  });

  it("shows the API's reason while it waits, with the queue", () => {
    expect(jobStatusLine({
      state: "waiting", message: "3090.zero is rendering; edit queued", position: 2, elapsed_s: 61.4,
    })).toBe("3090.zero is rendering; edit queued — 2 edits ahead (61 s)");
    expect(jobStatusLine({ state: "running", message: "", position: null, elapsed_s: 5, worker: "second 3090" }))
      .toBe("Editing on second 3090… (5 s)");
    expect(jobStatusLine({ state: "running", message: "", position: null, elapsed_s: 5 }))
      .toBe("Editing on the GPU… (5 s)");
    expect(jobStatusLine({
      state: "waiting", message: "second 3090 busy (A1111 generating); edit queued", position: 0, elapsed_s: 4,
    })).toBe("second 3090 busy (A1111 generating); edit queued (4 s)");
    expect(jobStatusLine({ state: "failed", message: "boom", position: null, elapsed_s: null }))
      .toBe("Failed: boom");
  });

  it("grades the identity score, and says why there is none", () => {
    expect(identityVerdict({ aura: 0.72 }).severity).toBe("success");
    expect(identityVerdict({ aura: 0.5 }).severity).toBe("warning");
    const far = identityVerdict({ aura: 0.21 });
    expect(far.severity).toBe("error");
    expect(far.text).toContain("Profiles score low");
    expect(identityVerdict({ aura: null, reason: "no face detected in the result" }).text)
      .toBe("Identity not scored: no face detected in the result");
  });
});
