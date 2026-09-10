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
const me: Character = {
  id: "2", name: "Me", char_lora: "david_v1_final", trigger: "d@vid",
  strength_stage_1: 0.8, strength_stage_2: 1.5,
};
const pose = (template: string): Pose => ({
  id: "p", name: "Bedroom", prompt_template: template, negative_prompt: "bad",
  negative_prompt_override: null, frames: 241, img_compression: 18,
  content_loras: [{ name: "motion", s1: 0.6, s2: 0.6 }], checkpoint: "10Eros", validated: true,
} as unknown as Pose);
const two = pose("<TRIGGER2> stands behind <TRIGGER>");
const one = pose("<TRIGGER>, a woman");

describe("triggerPhrase (console#487)", () => {
  const payton: Character = { ...pay, name: "Payton", trigger: "p@yton", gender: "woman" };
  const david: Character = { ...me, gender: "man" };

  it("is the caption the LoRA trained on: trigger, gender", () => {
    expect(triggerPhrase(payton)).toBe("p@yton, woman");
    expect(triggerPhrase(david)).toBe("d@vid, man");
  });

  it("is the bare trigger for a character with no gender, as before", () => {
    expect(triggerPhrase(pay)).toBe("p@y");
    expect(triggerPhrase({ ...pay, gender: null })).toBe("p@y");
  });

  it("never grows a gender on the no-character slot", () => {
    expect(triggerPhrase({ ...NO_CHARACTER, gender: "woman" })).toBe("");
  });

  it("fills both slots bound to their gender, and records it in the blob", () => {
    const slots = [slotFor(payton), slotFor(david)];
    const rendered = renderPrompt(two.prompt_template, slotTriggers(slots));
    expect(rendered).toBe("d@vid, man stands behind p@yton, woman");
    const blob = buildLtxRecipe({ pose: two, slots, prompt: rendered, renderedPrompt: rendered,
                                  negative: "bad", frames: 241 });
    expect(blob.characters?.map((c) => c.gender)).toEqual(["woman", "man"]);
    expect(blob.trigger).toBe("p@yton");
  });
});

describe("slotCount", () => {
  it("is one per placeholder the template uses, and at least one", () => {
    expect(slotCount(two)).toBe(2);
    expect(slotCount(one)).toBe(1);
    expect(slotCount(pose("no placeholder"))).toBe(1);
    expect(slotCount(null)).toBe(1);
  });
});

describe("buildLtxRecipe", () => {
  const slots = [slotFor(pay), slotFor(me)];
  const rendered = renderPrompt(two.prompt_template, slotTriggers(slots));

  it("records both people and mirrors the first into the scalars", () => {
    const blob = buildLtxRecipe({ pose: two, slots, prompt: rendered, renderedPrompt: rendered,
                                  negative: "bad", frames: 241 });
    expect(blob.characters).toEqual([
      { name: "p@y", trigger: "p@y", gender: null, char_lora: "pay_v2_e05", s1: 0.8, s2: 1.5 },
      { name: "Me", trigger: "d@vid", gender: null, char_lora: "david_v1_final", s1: 0.8, s2: 1.5 },
    ]);
    expect(blob.character).toBe("p@y");
    expect(blob.trigger).toBe("p@y");
    expect(blob.char_lora).toBe("pay_v2_e05");
    expect(blob.char_s1).toBe(0.8);
    expect(blob.edited).toEqual([]);
    expect(blob.content_loras).toEqual(two.content_loras);
    expect(blob.checkpoint).toBe("10Eros");
  });

  it("names the second character's fields in the edited codes", () => {
    const edited = [slotFor(pay), { ...slotFor(me), charLora: "david_v1_e03", s2: "1.2" }];
    const blob = buildLtxRecipe({ pose: two, slots: edited, prompt: rendered,
                                  renderedPrompt: rendered, negative: "bad", frames: 241 });
    expect(blob.edited).toEqual(["char2_lora", "char2_s2"]);
  });

  it("one slot records one person and no second", () => {
    const r = renderPrompt(one.prompt_template, "p@y");
    const blob = buildLtxRecipe({ pose: one, slots: [slotFor(pay)], prompt: r,
                                  renderedPrompt: r, negative: "bad", frames: 241 });
    expect(blob.characters).toHaveLength(1);
    expect(blob.trigger).toBe("p@y");
  });

  it("still notices a prompt edit and a negative edit", () => {
    const blob = buildLtxRecipe({ pose: two, slots, prompt: rendered + " at night",
                                  renderedPrompt: rendered, negative: "worse", frames: 241 });
    expect(blob.edited).toEqual(["prompt", "negative"]);
  });
});

describe("jobName", () => {
  it("joins two people, names one, says so for none", () => {
    expect(jobName(two, [slotFor(pay), slotFor(me)])).toBe("p@y & Me — Bedroom");
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

describe("renderPrompt with two slots", () => {
  it("fills both in order", () => {
    expect(renderPrompt("<TRIGGER2> behind <TRIGGER>", ["p@y", "d@vid"])).toBe("d@vid behind p@y");
  });
  it("leaves a slot it was not given", () => {
    expect(renderPrompt("<TRIGGER> and <TRIGGER2>", ["p@y"])).toBe("p@y and <TRIGGER2>");
  });
  it("tidies an empty second trigger the way it tidies the first", () => {
    expect(renderPrompt("<TRIGGER>, <TRIGGER2>, kneeling", ["p@y", ""])).toBe("p@y, kneeling");
  });
  it("still takes a single string", () => {
    expect(renderPrompt("<TRIGGER>, a woman", "p@y")).toBe("p@y, a woman");
  });
});
