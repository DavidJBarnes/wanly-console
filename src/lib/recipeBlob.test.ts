import { describe, expect, it } from "vitest";

import { NO_CHARACTER, renderPrompt, triggerPhrase } from "../api/ltx";
import type { Character, Pose } from "../api/ltx";
import {
  buildLtxRecipe, jobName, recipeCharacters, slotCount, slotFor, slotTriggers,
} from "./recipeBlob";

const pay: Character = {
  id: "1", name: "p@y", char_lora: "pay_v2_e05", trigger: "p@y",
  strength_stage_1: 0.8, strength_stage_2: 1.5,
};
const pose = (template: string): Pose => ({
  id: "p", name: "Bedroom", prompt_template: template, negative_prompt: "bad",
  negative_prompt_override: null, frames: 241, img_compression: 18,
  content_loras: [{ name: "motion", s1: 0.6, s2: 0.6 }], checkpoint: "10Eros",
} as unknown as Pose);
const one = pose("<TRIGGER>, a woman");

describe("triggerPhrase (console#487)", () => {
  const payton: Character = { ...pay, name: "Payton", trigger: "p@yton", gender: "woman" };

  it("is the caption the LoRA trained on: trigger, gender", () => {
    expect(triggerPhrase(payton)).toBe("p@yton, woman");
  });

  it("is the bare trigger for a character with no gender, as before", () => {
    expect(triggerPhrase(pay)).toBe("p@y");
    expect(triggerPhrase({ ...pay, gender: null })).toBe("p@y");
  });

  it("never grows a gender on the no-character slot", () => {
    expect(triggerPhrase({ ...NO_CHARACTER, gender: "woman" })).toBe("");
  });

  it("a joint phrase is the trigger itself, whole", () => {
    const joint: Character = {
      ...pay, name: "DavidPayton", trigger: "p@yton, woman and d@vid, man", gender: null,
    };
    expect(triggerPhrase(joint)).toBe("p@yton, woman and d@vid, man");
  });

  it("fills the one slot and records it in the blob", () => {
    const slots = [slotFor(payton)];
    const rendered = renderPrompt(one.prompt_template, slotTriggers(slots));
    expect(rendered).toBe("p@yton, woman, a woman");
    const blob = buildLtxRecipe({ pose: one, slots, prompt: rendered, renderedPrompt: rendered,
                                  negative: "bad", frames: 241 });
    expect(blob.characters?.map((c) => c.gender)).toEqual(["woman"]);
    expect(blob.trigger).toBe("p@yton");
  });
});

describe("slotCount", () => {
  it("is always one — the two-person slot died with <TRIGGER2>", () => {
    expect(slotCount()).toBe(1);
  });
});

describe("buildLtxRecipe", () => {
  const slots = [slotFor(pay)];
  const rendered = renderPrompt(one.prompt_template, slotTriggers(slots));

  it("records the one person and mirrors it into the scalars", () => {
    const blob = buildLtxRecipe({ pose: one, slots, prompt: rendered, renderedPrompt: rendered,
                                  negative: "bad", frames: 241 });
    expect(blob.characters).toEqual([
      { name: "p@y", trigger: "p@y", gender: null, char_lora: "pay_v2_e05", s1: 0.8, s2: 1.5 },
    ]);
    expect(blob.character).toBe("p@y");
    expect(blob.trigger).toBe("p@y");
    expect(blob.char_lora).toBe("pay_v2_e05");
    expect(blob.char_s1).toBe(0.8);
    expect(blob.edited).toEqual([]);
    expect(blob.content_loras).toEqual(one.content_loras);
    expect(blob.checkpoint).toBe("10Eros");
  });

  it("names the character's fields in the edited codes", () => {
    const edited = [{ ...slotFor(pay), charLora: "pay_v2_e03", s2: "1.2" }];
    const blob = buildLtxRecipe({ pose: one, slots: edited, prompt: rendered,
                                  renderedPrompt: rendered, negative: "bad", frames: 241 });
    expect(blob.edited).toEqual(["char_lora", "char_s2"]);
  });

  it("still notices a prompt edit and a negative edit", () => {
    const blob = buildLtxRecipe({ pose: one, slots, prompt: rendered + " at night",
                                  renderedPrompt: rendered, negative: "worse", frames: 241 });
    expect(blob.edited).toEqual(["prompt", "negative"]);
  });
});

describe("jobName", () => {
  it("names one, says so for none", () => {
    expect(jobName(one, [slotFor(pay)])).toBe("p@y — Bedroom");
    expect(jobName(one, [slotFor(NO_CHARACTER)])).toBe("Bedroom (no character)");
  });
});

describe("recipeCharacters", () => {
  it("prefers the list and falls back to the scalars", () => {
    const scalar = { recipe: "x", character: "p@y", trigger: "p@y", char_lora: "pay_v2_e05",
                     char_s1: 0.8, char_s2: 1.5, frames: 241 };
    expect(recipeCharacters(scalar)).toEqual([
      { name: "p@y", trigger: "p@y", char_lora: "pay_v2_e05", s1: 0.8, s2: 1.5 },
    ]);
    const listed = { ...scalar, characters: [
      { name: "Me", trigger: "d@vid", char_lora: "david_v1_final", s1: 0.7, s2: 1.2 },
    ] };
    expect(recipeCharacters(listed)[0].name).toBe("Me");
    expect(recipeCharacters(null)).toEqual([]);
  });
});

describe("renderPrompt", () => {
  it("fills the one placeholder", () => {
    expect(renderPrompt("<TRIGGER>, a woman", "p@y")).toBe("p@y, a woman");
  });

  it("takes a list from older callers and uses the first entry", () => {
    expect(renderPrompt("<TRIGGER> and more", ["p@y", "d@vid"])).toBe("p@y and more");
  });

  it("leaves a placeholder it was not given", () => {
    expect(renderPrompt("<TRIGGER>, a woman", undefined)).toBe("<TRIGGER>, a woman");
  });

  it("tidies an empty trigger the way it always has", () => {
    expect(renderPrompt("<TRIGGER>, kneeling", "")).toBe("kneeling");
  });

  it("a joint phrase lands whole in the one placeholder", () => {
    expect(renderPrompt("<TRIGGER>, a couch", "p@yton, woman and d@vid, man"))
      .toBe("p@yton, woman and d@vid, man, a couch");
  });
});
