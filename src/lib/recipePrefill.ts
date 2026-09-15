/**
 * The character/pose selection a continuation opens on (console#514).
 *
 * Extracted from RecipeForm because vitest here is node-env and pure-logic only, and the
 * bug it fixes is a timing one that a component test cannot see. The dialog remounts fresh
 * each open, but its parent re-renders on every poll with a NEW segment object standing for
 * the same segment. The prefill effect therefore runs repeatedly with equal CONTENT and
 * changing IDENTITY, and a prefill that re-applies on the second run silently reverts the
 * user's character and pose about five seconds after they pick them.
 *
 * `seeded` is the once-only latch. It is passed in (rather than read from a component ref)
 * so this decision has a right answer that can be tested without React.
 */
import type { Pose } from "../api/ltx";
import type { LtxRecipeRef } from "../api/types";
import { recipeCharacters } from "./recipeBlob";

export interface RecipePrefill {
  /** The slot characters the recorded blob names — the list form, or the scalar fallback. */
  characterNames: string[];
  /** The recorded pose's id, resolved by name. Empty when the name no longer exists, so the
   *  caller falls back to the first pose rather than silently reseeding on every poll. */
  poseId: string;
}

/**
 * Resolve what to seed, or null when there is nothing to do.
 *
 * Null means "already seeded, or no recorded blob" — never "seed an empty selection".
 * That distinction is the whole fix: once the user has made a choice there is no second
 * seed to apply, so a later poll cannot stomp it.
 */
export function seedRecipePrefill(
  seeded: boolean,
  ref: LtxRecipeRef | null | undefined,
  poses: Pose[],
): RecipePrefill | null {
  if (seeded || !ref) return null;
  const people = recipeCharacters(ref);
  return {
    characterNames: people.length ? people.map((c) => c.name) : [ref.character],
    // The recorded blob names the pose, not its id (it predates books). Names are unique
    // only WITHIN a book, so this is best-effort and an absent name resolves to "".
    poseId: poses.find((p) => p.name === ref.recipe)?.id ?? "",
  };
}
