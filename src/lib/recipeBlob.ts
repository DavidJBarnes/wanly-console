/**
 * Building a segment's recipe blob from what the form chose (console#473).
 *
 * Extracted from RecipeForm for two reasons. The form built the blob in two literals that
 * had drifted (the new-job one omitted `trigger`), and vitest here is node-env and
 * pure-logic only, so a blob with a right answer has to live outside a component to be
 * covered at all. A second person doubled the number of things that could drift.
 */
import { NO_CHARACTER, TRIGGER_PLACEHOLDERS, triggerPhrase } from "../api/ltx";
import type { Character, Pose } from "../api/ltx";
import type { LtxRecipeCharacter, LtxRecipeRef } from "../api/types";

/** One character slot as the form holds it: the chosen character plus the editable
 *  LoRA and per-stage strengths, which start as the character's own. */
export interface CharacterSlot {
  character: Character;
  charLora: string;
  s1: string;
  s2: string;
}

export function slotFor(character: Character): CharacterSlot {
  return {
    character,
    charLora: character.char_lora,
    s1: String(character.strength_stage_1),
    s2: String(character.strength_stage_2),
  };
}

/** The people in a recorded blob, list-or-scalar, exactly as the API reads it. */
export function recipeCharacters(ref: LtxRecipeRef | null | undefined): LtxRecipeCharacter[] {
  if (!ref) return [];
  if (ref.characters?.length) return ref.characters;
  if (!ref.character && !ref.char_lora) return [];
  return [{
    name: ref.character, trigger: ref.trigger ?? "", char_lora: ref.char_lora,
    s1: ref.char_s1, s2: ref.char_s2,
  }];
}

/** The `edited` codes for one slot: what the render did NOT take from the character. */
function slotEdits(slot: CharacterSlot, index: number): string[] {
  const prefix = index === 0 ? "char" : `char${index + 1}`;
  return [
    slot.charLora !== slot.character.char_lora ? `${prefix}_lora` : null,
    Number(slot.s1) !== slot.character.strength_stage_1 ? `${prefix}_s1` : null,
    Number(slot.s2) !== slot.character.strength_stage_2 ? `${prefix}_s2` : null,
  ].filter((c): c is string => c !== null);
}

/** The recipe blob a segment records. `characters` in slot order plus the scalar mirror
 *  of slot 0, so every reader of either shape keeps working. */
export function buildLtxRecipe(args: {
  pose: Pose;
  slots: CharacterSlot[];
  /** The prompt as it will render, with any <scene> markers already restored. */
  prompt: string;
  /** The pose's prompt rendered for these characters, unedited. */
  renderedPrompt: string;
  negative: string;
  frames: number;
}): LtxRecipeRef {
  const { pose, slots, prompt, renderedPrompt, negative, frames } = args;
  const first = slots[0] ?? slotFor(NO_CHARACTER);
  const characters: LtxRecipeCharacter[] = slots.map((s) => ({
    name: s.character.name,
    trigger: s.character.trigger,
    gender: s.character.gender ?? null,
    char_lora: s.charLora,
    s1: Number(s.s1),
    s2: Number(s.s2),
  }));
  const edited = [
    prompt.trim() !== renderedPrompt.trim() ? "prompt" : null,
    negative.trim() !== pose.negative_prompt.trim() ? "negative" : null,
    ...slots.flatMap(slotEdits),
  ].filter((c): c is string => c !== null);
  return {
    recipe: pose.name,
    characters,
    character: first.character.name,
    trigger: first.character.trigger,
    char_lora: first.charLora,
    char_s1: Number(first.s1),
    char_s2: Number(first.s2),
    frames,
    // Carried so the render records the CRF it actually used, and so the engine can apply a
    // pose's override. Sent as-is including 0, which is a real setting.
    img_compression: pose.img_compression,
    // The pose's content LoRAs, chained AHEAD of the character LoRAs, in the order given.
    // Recorded rather than looked up later: the row can be edited afterwards.
    content_loras: pose.content_loras,
    checkpoint: pose.checkpoint,
    edited,
  };
}

/** What fills each slot, in order, as renderPrompt takes them: the trigger phrase —
 *  "p@yton, woman" — not the bare trigger (console#487). */
export function slotTriggers(slots: CharacterSlot[]): string[] {
  return slots.map((s) => triggerPhrase(s.character));
}

/** "p@y & Me — Bedroom", "p@y — Missionary", "Missionary (no character)". */
export function jobName(pose: Pose, slots: CharacterSlot[]): string {
  const names = slots.map((s) => s.character.name).filter((n) => n !== NO_CHARACTER.name);
  return names.length ? `${names.join(" & ")} — ${pose.name}` : `${pose.name} (no character)`;
}

/** How many character slots this pose has: one per placeholder its template uses, and at
 *  least one, so a pose with no placeholder still takes (and records) a character. */
export function slotCount(pose: Pose | null): number {
  if (!pose) return 1;
  const used = TRIGGER_PLACEHOLDERS.filter((p) => pose.prompt_template.includes(p)).length;
  return Math.max(1, used);
}
