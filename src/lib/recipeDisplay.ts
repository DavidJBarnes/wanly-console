import { NO_CHARACTER } from "../api/ltx";
import type { LtxRecipeRef } from "../api/types";
import { recipeCharacters } from "./recipeBlob";

/**
 * Display strings for a segment's recorded LTX recipe (console#452).
 *
 * Segment.ltx_recipe is a RECORD of what a render actually ran, not a reference to look
 * anything up by -- an engine that cannot look a recipe up cannot look up a STALE one.
 * So everything here reads only the blob, and every function tolerates absence in both
 * senses: the segment carries no blob at all (WAN-era, hologram, free-form LTX), and an
 * old blob lacks keys the console since started recording (content_loras and checkpoint
 * arrived with the per-pose work, #404/#395). A missing thing displays as "not recorded"
 * in the popover -- a historical file must not be patched up with live pose or stack
 * values, which would be confidently wrong in exactly the way this blob exists to prevent.
 */

/** A content-LoRA entry as recorded in the blob. Tolerates the string-form leftovers
 *  the API tolerates by simply not asserting more than this shape. */
export interface ContentLoraEntry {
  name: string;
  s1: number;
  s2: number;
}

/**
 * "{pose} — {character}", the same shape the job name was built with when the segment was
 * created -- so a segment reads the same as the row that made it. The no-character renders
 * carry character "none" and the blob has no second half to name.
 *
 * Returns null when there is no title to show, including a malformed blob with no pose.
 */
export function recipeTitle(ref: LtxRecipeRef | null | undefined): string | null {
  if (!ref?.recipe) return null;
  const names = recipeCharacters(ref)
    .map((c) => c.name)
    .filter((n) => n && n !== NO_CHARACTER.name);
  if (!names.length) return `${ref.recipe} (no character)`;
  return `${ref.recipe} — ${names.join(" & ")}`;
}

/**
 * The recipe's defaults the render did NOT run, in recording order.
 *
 * `edited` holds the literal codes RecipeForm wrote; an unknown code passes through raw on
 * purpose -- this list grows on sightings, and swallowing a future code would make an edited
 * render look like a clean one.
 */
const EDITED_FIELD_WORDS: Record<string, string> = {
  prompt: "prompt",
  negative: "negative prompt",
  char_lora: "character LoRA",
  char_s1: "character strength (stage 1)",
  char_s2: "character strength (stage 2)",
  char2_lora: "second character's LoRA",
  char2_s1: "second character's strength (stage 1)",
  char2_s2: "second character's strength (stage 2)",
};

export function editedFields(ref: LtxRecipeRef | null | undefined): string[] {
  return (ref?.edited ?? [])
    .filter((code): code is string => Boolean(code))
    .map((code) => EDITED_FIELD_WORDS[code] ?? code);
}

/**
 * "{name} @ {s1}/{s2}", RecipeForm's "Fixed by the recipe" format exactly -- the same LoRA
 * and the same numbers must not gain a second spelling between the form that chose it and
 * the record of what ran.
 */
export function contentLoraLine(lora: ContentLoraEntry): string {
  return `${lora.name} @ ${lora.s1}/${lora.s2}`;
}

/**
 * The first eight characters of graph_sha256, or null when the blob predates the hash or
 * the worker never reported one. Its only use is comparing two segments against each other,
 * which is why it is shown truncated and offered for copying rather than as a full 64-char
 * line students of the graph would never read.
 */
export function shortGraphHash(ref: LtxRecipeRef | null | undefined): string | null {
  return ref?.graph_sha256 ? ref.graph_sha256.slice(0, 8) : null;
}

/**
 * Where the character LoRA was trained, when the blob names a real character.
 *
 * The blob records a NAME, not an id, so the link is a best-effort `?character=` on the
 * training page: a renamed or deleted character lands on a complete page with nothing
 * highlighted, which is the honest amount of certainty the blob carries.
 */
export function trainingLink(ref: LtxRecipeRef | null | undefined): string | null {
  return trainingLinks(ref)[0]?.href ?? null;
}

/** One link per person in the shot (console#473), in slot order, real characters only. */
export function trainingLinks(ref: LtxRecipeRef | null | undefined): { name: string; href: string }[] {
  return recipeCharacters(ref)
    .filter((c) => c.name && c.name !== NO_CHARACTER.name)
    .map((c) => ({ name: c.name, href: `/training?character=${encodeURIComponent(c.name)}` }));
}
