import { describe, it, expect } from "vitest";
import {
  draftAfterStyleChange, draftMatchesSaved, draftTryBody, effectiveText, hasUnsavedChange,
  imagePathProblem, isModified, keepsGrounding, lengthProblem, motionTemplateProblem,
  overrideToSave,
} from "./captionPrompts";

const STANDARD = "In under 40 words, describe the subject.";
const RICH = "In under 80 words, describe in detail.";
const TEMPLATE = "{#scene}Scene: {scene}\n\n{/scene}Write a prompt. {style} One paragraph.";

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

describe("motionTemplateProblem", () => {
  it("accepts the default shape", () => {
    expect(motionTemplateProblem(TEMPLATE)).toBeNull();
  });
  it("accepts a legacy override with no placeholders, and literal braces", () => {
    expect(motionTemplateProblem("my own words")).toBeNull();
    expect(motionTemplateProblem("notes {a b} and a lone { brace")).toBeNull();
  });
  it("names unknown placeholders", () => {
    expect(motionTemplateProblem("{sceen} {Style} {sceen}")).toMatch(/\{Style\}, \{sceen\}/);
  });
  it("refuses unbalanced and nested sections", () => {
    expect(motionTemplateProblem("{#scene}open")).toMatch(/never closed/);
    expect(motionTemplateProblem("x{/scene}")).toMatch(/no matching/);
    expect(motionTemplateProblem("{#scene}{#scene}{/scene}{/scene}")).toMatch(/nested/);
  });
  it("allows two separate sections", () => {
    expect(motionTemplateProblem("{#scene}a{/scene} b {#scene}c{/scene}")).toBeNull();
  });
});

describe("lengthProblem", () => {
  it("is null at the cap and a message past it", () => {
    expect(lengthProblem("x".repeat(10), 10)).toBeNull();
    expect(lengthProblem("x".repeat(11), 10)).toMatch(/11 characters; the limit is 10/);
  });
});

describe("keepsGrounding", () => {
  it("notices the scene section being deleted", () => {
    expect(keepsGrounding(TEMPLATE)).toBe(true);
    expect(keepsGrounding("Write a prompt. {style}")).toBe(false);
  });
});

describe("draftTryBody", () => {
  const d = {
    captionStyle: "standard", captionDraft: STANDARD, captionDefault: STANDARD,
    motionStyle: "handheld", motionDraft: TEMPLATE, motionDefault: TEMPLATE,
  };
  it("sends the defaults as empty strings, never omitted", () => {
    expect(draftTryBody(d)).toEqual({
      caption_style: "standard", caption_instruction: "",
      motion_style: "handheld", motion_template: "",
    });
  });
  it("sends edits as written", () => {
    const body = draftTryBody({ ...d, captionDraft: "mine", motionDraft: "Motion. {style}" });
    expect(body.caption_instruction).toBe("mine");
    expect(body.motion_template).toBe("Motion. {style}");
  });
});

describe("draftMatchesSaved", () => {
  const saved = { captionStyle: "standard", captionOverride: "", motionStyle: "handheld", motionOverride: "" };
  const body = { caption_style: "standard", caption_instruction: "", motion_style: "handheld", motion_template: "" };
  it("is true for an untouched page", () => {
    expect(draftMatchesSaved(body, saved)).toBe(true);
  });
  it("a different style or text is a different prompt", () => {
    expect(draftMatchesSaved({ ...body, caption_style: "rich" }, saved)).toBe(false);
    expect(draftMatchesSaved({ ...body, motion_style: "static" }, saved)).toBe(false);
    expect(draftMatchesSaved({ ...body, caption_instruction: "mine" }, saved)).toBe(false);
    expect(draftMatchesSaved({ ...body, motion_template: "m {style}" }, saved)).toBe(false);
  });
  it("under an override the caption style does not matter", () => {
    expect(draftMatchesSaved(
      { ...body, caption_style: "rich", caption_instruction: "mine" },
      { ...saved, captionOverride: "mine" },
    )).toBe(true);
  });
});

describe("imagePathProblem", () => {
  it("wants an s3 path", () => {
    expect(imagePathProblem("")).toMatch(/Choose an image/);
    expect(imagePathProblem("https://example.com/a.png")).toMatch(/not an s3/);
    expect(imagePathProblem(" s3://wanly-images/2026-09-29/00001.png ")).toBeNull();
  });
});
