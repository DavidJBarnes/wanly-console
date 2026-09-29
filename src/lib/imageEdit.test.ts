import { describe, it, expect } from "vitest";
import {
  applyPreset, changedParams, clampToAxis, datasetChoices, datasetSaveProblem, describeRun,
  groupAxes, hasEdit, isEditedImage, matchesPreset, MAX_PROMPT, neutralValues, previewBody,
  promptProblem, savedName, unknownTermsMessage, valuesFromExpression,
} from "./imageEdit";
import type { Dataset } from "../api/types";

const AXES = [
  { key: "rotate_yaw", label: "Turn", min: -20, max: 20, step: 0.5, group: "main" },
  { key: "smile", label: "Smile", min: -0.3, max: 1.3, step: 0.01, group: "main" },
  { key: "pupil_x", label: "Gaze", min: -15, max: 15, step: 0.5, group: "gaze" },
  { key: "woo", label: "Woo", min: -20, max: 15, step: 0.2, group: "more" },
  { key: "odd", label: "Odd", min: 0, max: 1, step: 0.1, group: "future" },
];

const ds = (over: Partial<Dataset> = {}): Dataset => ({
  id: "d1", name: "Kelly v3", tags: null, notes: null, images: [], prefix: null,
  anchor_uri: null, locked: false, trained_by: [], locked_at: null, ...over,
} as Dataset);

describe("presets and values", () => {
  it("starts every axis at zero", () => {
    expect(neutralValues(AXES)).toEqual({ rotate_yaw: 0, smile: 0, pupil_x: 0, woo: 0, odd: 0 });
  });

  it("a preset replaces the face, it does not stack on the last one", () => {
    const glance = applyPreset(AXES, { expression: { pupil_x: -8 } });
    const smile = applyPreset(AXES, { expression: { smile: 0.5 } });
    expect(glance.pupil_x).toBe(-8);
    expect(smile).toEqual({ ...neutralValues(AXES), smile: 0.5 });
  });

  it("sends only the axes that move", () => {
    expect(changedParams({ smile: 0.5, rotate_yaw: 0, pupil_x: -8 })).toEqual({ smile: 0.5, pupil_x: -8 });
    expect(hasEdit(neutralValues(AXES))).toBe(false);
    expect(hasEdit({ smile: 0.01 })).toBe(true);
  });

  it("knows when a drag has taken the edit away from its preset", () => {
    const preset = { expression: { smile: 1.3, aaa: 52.5 } };
    expect(matchesPreset({ smile: 1.3, aaa: 52.5, blink: 0 }, preset)).toBe(true);
    expect(matchesPreset({ smile: 1.3, aaa: 40 }, preset)).toBe(false);
    expect(matchesPreset({ smile: 1.3, aaa: 52.5, blink: -2 }, preset)).toBe(false);
    expect(matchesPreset({ smile: 1 }, null)).toBe(false);
  });

  it("groups axes, and an unknown group is shown under more rather than lost", () => {
    const g = groupAxes(AXES);
    expect(g.main.map((a) => a.key)).toEqual(["rotate_yaw", "smile"]);
    expect(g.gaze.map((a) => a.key)).toEqual(["pupil_x"]);
    expect(g.more.map((a) => a.key)).toEqual(["woo", "odd"]);
  });

  it("clamps to the axis, because the API refuses rather than clamps", () => {
    expect(clampToAxis(AXES[1], 2)).toBe(1.3);
    expect(clampToAxis(AXES[1], -1)).toBe(-0.3);
    expect(clampToAxis(AXES[1], 0.4)).toBe(0.4);
  });
});

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
  });

  it("leaves ordinary images alone", () => {
    expect(isEditedImage("s3://b/2026-09-01/sel_008.jpg")).toBe(false);
    expect(isEditedImage("s3://b/2026-09-01/my_edit-notes.png")).toBe(false);
  });
});

describe("describing a run", () => {
  it("names the device and the time", () => {
    expect(describeRun({ device: "cuda", elapsed_ms: 1234 })).toBe("GPU · 1.2 s");
    expect(describeRun({ device: "cpu", device_reason: "Automatic1111 on this card is generating", elapsed_ms: 9400 }))
      .toBe("CPU (Automatic1111 on this card is generating) · 9.4 s");
    expect(describeRun({ device: null, elapsed_ms: 500 })).toBe("0.5 s");
  });

  it("names a saved file", () => {
    expect(savedName("s3://b/f/a_edit-smile_123abc.png")).toBe("a_edit-smile_123abc.png");
  });
});

describe("describe the change (#550)", () => {
  it("refuses a blank or oversized description before sending it", () => {
    expect(promptProblem("  ")).toMatch(/Describe the change/);
    expect(promptProblem("x".repeat(MAX_PROMPT + 1))).toMatch(/500/);
    expect(promptProblem("big smile, eyes closed, look left")).toBeNull();
  });

  it("moves the sliders to what the service resolved, over a neutral face", () => {
    const v = valuesFromExpression(AXES, { smile: 1.3, pupil_x: -12, rotate_yaw: 0, blink: -20 });
    expect(v).toEqual({ ...neutralValues(AXES), smile: 1.3, pupil_x: -12 });
  });

  it("keeps resolved values on their axis and ignores junk", () => {
    const v = valuesFromExpression(AXES, { smile: 2, pupil_x: Number.NaN });
    expect(v.smile).toBe(1.3);
    expect(v.pupil_x).toBe(0);
    expect(valuesFromExpression(AXES, undefined)).toEqual(neutralValues(AXES));
  });

  it("sends only the latest input: the text, or the moved axes", () => {
    expect(previewBody("s3://b/a.png", { kind: "prompt", text: " wink " }))
      .toEqual({ source_uri: "s3://b/a.png", mode: "face", prompt: "wink" });
    expect(previewBody("s3://b/a.png", { kind: "values", values: { smile: 0.5, pupil_x: 0 } }))
      .toEqual({ source_uri: "s3://b/a.png", mode: "face", expression: { smile: 0.5 } });
  });

  it("sends nothing when there is nothing to preview", () => {
    expect(previewBody("s3://b/a.png", { kind: "prompt", text: "  " })).toBeNull();
    expect(previewBody("s3://b/a.png", { kind: "values", values: neutralValues(AXES) })).toBeNull();
  });

  it("rewords the API's no-known-terms 422 and lists what it knows", () => {
    const msg = unknownTermsMessage(
      "nothing to apply: no known terms in 'dance a jig'. Recognised terms: smile, grin, look left/right.");
    expect(msg).toBe("None of those words are ones the editor understands. It knows: smile, grin, look left/right.");
    expect(unknownTermsMessage("nothing to apply: no known terms in 'x'."))
      .toMatch(/understands\. Try words like/);
  });

  it("leaves every other error alone", () => {
    expect(unknownTermsMessage("face-edit refused this image: no face detected in the image")).toBeNull();
    expect(unknownTermsMessage("face-edit is busy or not ready: busy")).toBeNull();
  });
});
