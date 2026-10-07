import { describe, expect, it } from "vitest";

import { renderPrompt } from "../api/ltx";
import type { Character } from "../api/ltx";
import {
  draftFor, draftMessage, draftRenderProblem, fillPhrase, formError, formFor, formIsDraft,
  hasLora, identityBadges, identityRefToSend, identityStatus, isDraft, referenceMode,
  sheetSizeWarning,
} from "./characterIdentity";
import { buildLtxRecipe, slotFor, slotTriggers } from "./recipeBlob";

/**
 * A character is a LoRA, a character sheet, or both (console#579, epic #581).
 *
 * Phase 0 (wanly-gpu-docker#155) showed a 1536x1024 sheet holding identity better than the
 * LoRA alone. These are the console's rules for the three shapes: what the list says, what
 * fills <TRIGGER>, what the job form says and sends, and what the dialog saves.
 */

const SHEET = "s3://wanly-images/chars/kelly_sheet.png";
const FACE = "s3://wanly-images/chars/kelly_face.png";

function char(over: Partial<Character> = {}): Character {
  return {
    id: "c1", name: "Kelly", char_lora: "k3lly2026_v2", trigger: "k3lly2026",
    gender: "woman", strength_stage_1: 0.8, strength_stage_2: 1.5, ...over,
  };
}
const loraOnly = char();
const sheetOnly = char({ char_lora: null, trigger: null, gender: null, sheet_uri: SHEET,
                         identity_mode: "sheet", description: "a woman with auburn hair" });
const both = char({ sheet_uri: SHEET, identity_mode: "sheet" });

describe("what a character has", () => {
  it("reads null and the legacy 'none' as no LoRA", () => {
    expect(hasLora("k3lly2026_v2")).toBe(true);
    expect(hasLora(null)).toBe(false);
    expect(hasLora("none")).toBe(false);
    expect(hasLora(" None ")).toBe(false);
  });

  it("badges LoRA, Sheet, or both", () => {
    expect(identityBadges(loraOnly)).toEqual(["LoRA"]);
    expect(identityBadges(sheetOnly)).toEqual(["Sheet"]);
    expect(identityBadges(both)).toEqual(["LoRA", "Sheet"]);
    expect(identityBadges(char({ char_lora: null, face_ref_uri: FACE }))).toEqual(["Face"]);
    // Registered for training, nothing yet.
    expect(identityBadges(char({ char_lora: "none" }))).toEqual([]);
  });

  it("picks the reference the way the API does", () => {
    expect(referenceMode(loraOnly)).toBeNull();
    expect(referenceMode(both)).toBe("sheet");
    expect(referenceMode(char({ sheet_uri: SHEET, face_ref_uri: FACE, identity_mode: "face" })))
      .toBe("face");
    // No mode stored: the sheet first.
    expect(referenceMode(char({ sheet_uri: SHEET, face_ref_uri: FACE }))).toBe("sheet");
    // A mode naming a reference that is gone falls back rather than pointing at nothing.
    expect(referenceMode(char({ face_ref_uri: FACE, identity_mode: "sheet" }))).toBe("face");
  });
});

describe("<TRIGGER>", () => {
  it("is the trigger phrase for a LoRA character, as before", () => {
    expect(fillPhrase(loraOnly)).toBe("k3lly2026, woman");
    expect(fillPhrase(both)).toBe("k3lly2026, woman");
  });

  it("is the description for a sheet-only character", () => {
    expect(fillPhrase(sheetOnly)).toBe("a woman with auburn hair");
    expect(renderPrompt("<TRIGGER>, she turns", slotTriggers([slotFor(sheetOnly)])))
      .toBe("a woman with auburn hair, she turns");
  });

  it("is dropped, with its comma, when there is neither", () => {
    const bare = char({ char_lora: null, trigger: null, sheet_uri: SHEET, description: null });
    expect(fillPhrase(bare)).toBe("");
    expect(renderPrompt("<TRIGGER>, she turns", slotTriggers([slotFor(bare)])))
      .toBe("she turns");
  });
});

describe("the recipe blob for a sheet-only character", () => {
  const pose = {
    id: "p", name: "Turn", prompt_template: "<TRIGGER>, she turns", negative_prompt: "",
    frames: 121, img_compression: null, content_loras: [], checkpoint: "10Eros_v1.5_bf16",
  } as never;

  it("starts on no LoRA and does not record that as an edit", () => {
    const slot = slotFor(sheetOnly);
    expect(slot.charLora).toBe("none");
    const blob = buildLtxRecipe({ pose, slots: [slot], prompt: "x", renderedPrompt: "x",
                                  negative: "", frames: 121 });
    expect(blob.char_lora).toBe("none");
    expect(blob.edited).not.toContain("char_lora");
    // Recorded, so the API can fill <TRIGGER> the same way after the row is gone.
    expect(blob.characters?.[0].description).toBe("a woman with auburn hair");
  });
});

describe("the job form", () => {
  it("says what carries the identity", () => {
    expect(identityStatus(loraOnly, true)).toMatch(/LoRA only/);
    expect(identityStatus(both, true)).toBe("Identity: LoRA + character sheet.");
    expect(identityStatus(both, false)).toMatch(/turned off/);
    expect(identityStatus(sheetOnly, true)).toBe("Identity: character sheet only (no LoRA).");
    // The one that will render somebody else must say so.
    expect(identityStatus(sheetOnly, false)).toMatch(/will not be this person/);
  });

  it("sends the toggle only when the character has a reference", () => {
    expect(identityRefToSend(loraOnly, true)).toBeUndefined();
    expect(identityRefToSend(loraOnly, false)).toBeUndefined();
    expect(identityRefToSend(both, true)).toBe(true);
    expect(identityRefToSend(both, false)).toBe(false);
    expect(identityRefToSend(null, true)).toBeUndefined();
  });
});

describe("the sheet layout check", () => {
  it("is quiet for 1536x1024 and warns otherwise", () => {
    expect(sheetSizeWarning(1536, 1024)).toBeNull();
    expect(sheetSizeWarning(1024, 1536)).toMatch(/1024×1536/);
    expect(sheetSizeWarning(1024, 1024)).toMatch(/1536×1024/);
  });
});

describe("the character dialog", () => {
  it("needs only a name: neither a LoRA nor a sheet saves a draft (console#592)", () => {
    const f = { ...formFor(null), name: "New" };
    expect(formError({ ...f, name: " " })).toMatch(/needs a name/);
    expect(formError(f)).toBeNull();
    expect(formIsDraft(f)).toBe(true);
    expect(formIsDraft({ ...f, sheetUri: SHEET })).toBe(false);
    expect(formIsDraft({ ...f, lora: "x_v1" })).toBe(false);
    expect(formIsDraft({ ...f, faceRefUri: FACE })).toBe(false);
  });

  it("creates a draft with just a name and a gender, no trigger, no LoRA", () => {
    const d = draftFor({ ...formFor(null), name: "Kel", gender: "woman" }, null, false);
    expect(d).toEqual({ name: "Kel", trigger: null, gender: "woman" });
  });

  it("checks strengths only when there is a LoRA", () => {
    const f = { ...formFor(null), name: "New", sheetUri: SHEET, s1: "", s2: "" };
    expect(formError(f)).toBeNull();
    expect(formError({ ...f, lora: "x_v1" })).toMatch(/strengths/);
  });

  it("still lets a registered-for-training character be edited", () => {
    const registered = char({ char_lora: "none", trigger: "new" });
    expect(formError(formFor(registered))).toBeNull();
  });

  it("creates a sheet-only character without LoRA or strengths", () => {
    const d = draftFor({ ...formFor(null), name: "Kel", sheetUri: SHEET,
                         description: "a woman" }, null, false);
    expect(d).toMatchObject({ name: "Kel", sheet_uri: SHEET, description: "a woman" });
    expect(d).not.toHaveProperty("char_lora");
    expect(d).not.toHaveProperty("strength_stage_1");
  });

  it("adds a sheet to a LoRA character and keeps its LoRA", () => {
    const d = draftFor({ ...formFor(loraOnly), sheetUri: SHEET }, loraOnly, true);
    expect(d.char_lora).toBe("k3lly2026_v2");
    expect(d.sheet_uri).toBe(SHEET);
    expect(d.strength_stage_1).toBe(0.8);
    // Locked by training: not sent at all.
    expect(d).not.toHaveProperty("trigger");
    expect(d).not.toHaveProperty("gender");
  });

  it("sends a removed LoRA or sheet as null so the API clears it", () => {
    expect(draftFor({ ...formFor(both), lora: "" }, both, false).char_lora).toBeNull();
    expect(draftFor({ ...formFor(both), sheetUri: "" }, both, false).sheet_uri).toBeNull();
  });

  it("never sends char_lora for a registration that has none", () => {
    const registered = char({ char_lora: "none", trigger: "new" });
    expect(draftFor(formFor(registered), registered, false)).not.toHaveProperty("char_lora");
  });
});

describe("drafts (console#592)", () => {
  const draft = char({ char_lora: null, trigger: null, name: "Nova" });

  it("is a character with neither a LoRA nor a reference", () => {
    expect(isDraft(draft)).toBe(true);
    // The legacy registration ahead of training is one too: nothing in it is the person.
    expect(isDraft(char({ char_lora: "none" }))).toBe(true);
    expect(isDraft(loraOnly)).toBe(false);
    expect(isDraft(sheetOnly)).toBe(false);
    expect(isDraft(char({ char_lora: null, face_ref_uri: FACE }))).toBe(false);
    expect(identityBadges(draft)).toEqual([]);
  });

  it("is a pair exactly when it has no joint LoRA -- it never borrows a member's sheet", () => {
    const pair = char({ name: "AB", char_lora: "none", kind: "pair", members: ["A", "B"] });
    expect(isDraft(pair)).toBe(true);
    expect(isDraft({ ...pair, char_lora: "ab_v1" })).toBe(false);
  });

  it("says the same thing the API refuses with", () => {
    expect(draftMessage("Nova"))
      .toBe("Nova has no LoRA or sheet yet: build a sheet or attach a LoRA.");
  });

  it("blocks the job form unless the slot carries a LoRA", () => {
    expect(draftRenderProblem(draft, "none")).toBe(draftMessage("Nova"));
    expect(draftRenderProblem(draft, "")).toBe(draftMessage("Nova"));
    expect(draftRenderProblem(draft, "x_v1")).toBeNull();
    expect(draftRenderProblem(sheetOnly, "none")).toBeNull();
    expect(draftRenderProblem(null, "none")).toBeNull();
  });

  it("tells the job form it cannot render", () => {
    expect(identityStatus(draft, true)).toMatch(/draft.*cannot render/);
  });
});
