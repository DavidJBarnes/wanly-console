import { describe, it, expect } from "vitest";
import {
  draftAfterStyleChange, draftMatchesSaved, draftTryBody, effectiveText, finderEmptyMessage,
  hasUnsavedChange, imagePathProblem, isModified, lengthProblem, looksLikeS3Path,
  motionHasUnsavedChange, motionToSend, overrideToSave, recentRepoImages,
} from "./captionPrompts";

const STANDARD = "In under 40 words, describe the subject.";
const RICH = "In under 80 words, describe in detail.";
/** Plain motion instructions, as the API returns the default since console#573. */
const MOTION = "Write a prompt for a clip. Single continuous shot, one paragraph.";
const LEGACY = "My whole motion prompt, from before the editors.";

describe("effectiveText", () => {
  it("is the override when there is one", () => {
    expect(effectiveText("mine", STANDARD)).toBe("mine");
  });
  it("is the default when the override is empty or blank", () => {
    expect(effectiveText("", STANDARD)).toBe(STANDARD);
    expect(effectiveText("  \n", STANDARD)).toBe(STANDARD);
  });
});

describe("isModified / overrideToSave", () => {
  it("an untouched pre-filled editor is not an override", () => {
    expect(isModified(STANDARD, STANDARD)).toBe(false);
    expect(overrideToSave(STANDARD, STANDARD)).toBe("");
  });
  it("ignores whitespace at the ends, as the API does", () => {
    expect(isModified(`  ${STANDARD}\n`, STANDARD)).toBe(false);
  });
  it("an empty editor means the default, not an override", () => {
    expect(isModified("", STANDARD)).toBe(false);
    expect(overrideToSave("   ", STANDARD)).toBe("");
  });
  it("an edit is saved as written", () => {
    expect(isModified(`${STANDARD} Mention shoes.`, STANDARD)).toBe(true);
    expect(overrideToSave("mine ", STANDARD)).toBe("mine ");
  });
});

describe("hasUnsavedChange", () => {
  it("is false for the untouched default", () => {
    expect(hasUnsavedChange(STANDARD, STANDARD, "")).toBe(false);
  });
  it("is true for an edit, and false once it is saved", () => {
    expect(hasUnsavedChange("mine", STANDARD, "")).toBe(true);
    expect(hasUnsavedChange("mine", STANDARD, "mine")).toBe(false);
  });
  it("treats a saved copy of the default as the default", () => {
    expect(hasUnsavedChange(STANDARD, STANDARD, STANDARD)).toBe(false);
  });
  it("resetting a saved override is a change", () => {
    expect(hasUnsavedChange(STANDARD, STANDARD, "mine")).toBe(true);
  });
});

describe("draftAfterStyleChange", () => {
  it("an untouched draft follows the style", () => {
    expect(draftAfterStyleChange(STANDARD, STANDARD, RICH)).toBe(RICH);
    expect(draftAfterStyleChange("", STANDARD, RICH)).toBe(RICH);
  });
  it("an edited draft is kept", () => {
    expect(draftAfterStyleChange("mine", STANDARD, RICH)).toBe("mine");
  });
});

describe("lengthProblem", () => {
  it("is null at the cap and a message past it", () => {
    expect(lengthProblem("x".repeat(10), 10)).toBeNull();
    expect(lengthProblem("x".repeat(11), 10)).toMatch(/11 characters; the limit is 10/);
  });
});

describe("motionToSend (a legacy whole prompt in force)", () => {
  it("leaves the legacy prompt alone while the editor still holds it", () => {
    expect(motionToSend(LEGACY, MOTION, LEGACY)).toBeUndefined();
    expect(motionToSend(`  ${LEGACY}\n`, MOTION, LEGACY)).toBeUndefined();
  });
  it("sends an edit, or \"\" for a reset to the default, which replaces it", () => {
    expect(motionToSend(`${LEGACY} More.`, MOTION, LEGACY)).toBe(`${LEGACY} More.`);
    expect(motionToSend(MOTION, MOTION, LEGACY)).toBe("");
  });
  it("is overrideToSave when there is no legacy prompt", () => {
    expect(motionToSend(MOTION, MOTION, "")).toBe("");
    expect(motionToSend("mine", MOTION, "")).toBe("mine");
  });
});

describe("motionHasUnsavedChange", () => {
  it("an untouched legacy prompt is not a change, an edit or reset of it is", () => {
    expect(motionHasUnsavedChange(LEGACY, MOTION, "", LEGACY)).toBe(false);
    expect(motionHasUnsavedChange(MOTION, MOTION, "", LEGACY)).toBe(true);
    expect(motionHasUnsavedChange("new", MOTION, "", LEGACY)).toBe(true);
  });
  it("follows hasUnsavedChange otherwise", () => {
    expect(motionHasUnsavedChange(MOTION, MOTION, "", "")).toBe(false);
    expect(motionHasUnsavedChange("new", MOTION, "", "")).toBe(true);
  });
});

describe("draftTryBody", () => {
  const d = {
    captionStyle: "standard", captionDraft: STANDARD, captionDefault: STANDARD,
    motionStyle: "handheld", motionDraft: MOTION, motionDefault: MOTION, motionLegacy: "",
  };
  it("sends the defaults as empty strings, never omitted", () => {
    expect(draftTryBody(d)).toEqual({
      caption_style: "standard", caption_instruction: "",
      motion_style: "handheld", motion_instruction: "",
    });
  });
  it("sends edits as written", () => {
    const body = draftTryBody({ ...d, captionDraft: "mine", motionDraft: "She leans back." });
    expect(body.caption_instruction).toBe("mine");
    expect(body.motion_instruction).toBe("She leans back.");
  });
  it("omits the motion text while it is an untouched legacy prompt, so the saved one runs", () => {
    const body = draftTryBody({ ...d, motionDraft: LEGACY, motionLegacy: LEGACY });
    expect(body).not.toHaveProperty("motion_instruction");
  });
});

describe("draftMatchesSaved", () => {
  const saved = {
    captionStyle: "standard", captionOverride: "", motionStyle: "handheld", motionOverride: "",
    motionLegacy: "",
  };
  const body = { caption_style: "standard", caption_instruction: "", motion_style: "handheld", motion_instruction: "" };
  it("is true for an untouched page", () => {
    expect(draftMatchesSaved(body, saved)).toBe(true);
  });
  it("a different style or text is a different prompt", () => {
    expect(draftMatchesSaved({ ...body, caption_style: "rich" }, saved)).toBe(false);
    expect(draftMatchesSaved({ ...body, motion_style: "static" }, saved)).toBe(false);
    expect(draftMatchesSaved({ ...body, caption_instruction: "mine" }, saved)).toBe(false);
    expect(draftMatchesSaved({ ...body, motion_instruction: "She leans back." }, saved)).toBe(false);
  });
  it("under an override the caption style does not matter", () => {
    expect(draftMatchesSaved(
      { ...body, caption_style: "rich", caption_instruction: "mine" },
      { ...saved, captionOverride: "mine" },
    )).toBe(true);
  });
  it("with a legacy prompt saved, omitted motion matches and any motion text does not", () => {
    const legacySaved = { ...saved, motionLegacy: LEGACY };
    const { motion_instruction: _omitted, ...untouched } = body;
    void _omitted;
    expect(draftMatchesSaved(untouched, legacySaved)).toBe(true);
    expect(draftMatchesSaved(body, legacySaved)).toBe(false);
  });
});

describe("imagePathProblem", () => {
  it("wants an s3 path", () => {
    expect(imagePathProblem("")).toMatch(/Choose an image/);
    expect(imagePathProblem("https://example.com/a.png")).toMatch(/not an s3/);
    expect(imagePathProblem(" s3://wanly-images/2026-09-29/00001.png ")).toBeNull();
  });
});

describe("looksLikeS3Path", () => {
  it("is true only for a usable s3:// path", () => {
    expect(looksLikeS3Path(" s3://wanly-images/2026-09-29/00001.png")).toBe(true);
    expect(looksLikeS3Path("00001")).toBe(false);
    expect(looksLikeS3Path("s3://")).toBe(false);
  });
});

describe("recentRepoImages", () => {
  const img = (path: string, last_modified: string) => ({ path, filename: path, last_modified });
  const folders: Record<string, ReturnType<typeof img>[]> = {
    "2026-09-30": [img("a", "2026-09-30T08:00:00Z"), img("b", "2026-09-30T09:00:00Z")],
    "2026-09-29": [img("c", "2026-09-29T10:00:00Z"), img("d", "2026-09-29T11:00:00Z")],
    "2026-09-28": [img("e", "2026-09-28T10:00:00Z")],
  };
  const names = Object.keys(folders);

  it("takes the newest folders until it has enough, newest image first", async () => {
    const opened: string[] = [];
    const list = async (n: string) => { opened.push(n); return folders[n]; };
    const out = await recentRepoImages(names, list, 3);
    expect(out.map((i) => i.path)).toEqual(["b", "a", "d"]);
    expect(opened).toEqual(["2026-09-30", "2026-09-29"]);
  });
  it("stops after maxFolders even when short", async () => {
    const out = await recentRepoImages(names, async (n) => folders[n], 10, 2);
    expect(out.map((i) => i.path)).toEqual(["b", "a", "d", "c"]);
  });
  it("is empty for an empty repo", async () => {
    expect(await recentRepoImages([], async () => [], 12)).toEqual([]);
  });
});

describe("finderEmptyMessage", () => {
  it("says no match for a query with no hits", () => {
    expect(finderEmptyMessage(" kelly ", [])).toBe("No images match “kelly”.");
  });
  it("says the repo is empty when there is no query", () => {
    expect(finderEmptyMessage("", [])).toMatch(/no images yet/);
  });
  it("is null while loading or when there are hits", () => {
    expect(finderEmptyMessage("x", null)).toBeNull();
    expect(finderEmptyMessage("x", [{ path: "p", filename: "f", last_modified: "" }])).toBeNull();
  });
});
