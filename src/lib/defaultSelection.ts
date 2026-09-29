/**
 * What the New Job and Next Segment modals open on when nothing is chosen yet (console#543).
 *
 * One pose and one character can be starred as THE default on the LoRA recipes page; the API
 * keeps at most one of each. The form used to open on whichever came first alphabetically,
 * which was almost never the one being rendered.
 *
 * The default only fills a BLANK. Anything already selected wins: a user's pick, and a
 * clone's or a continuation's carried-over choice (which the prefill in RecipeForm applies
 * after this, over the top). With no default starred this is exactly the old first-in-list
 * behaviour. Pure so node-env vitest can cover it without React.
 */
import type { Character, Pose } from "../api/ltx";

/** The character name to select: `current` if one is, else the default, else the first. */
export function preselectCharacter(current: string, characters: Character[]): string {
  if (current) return current;
  return (characters.find((c) => c.is_default) ?? characters[0])?.name ?? "";
}

/** The pose id to select: `current` if one is, else the default, else the first. */
export function preselectPose(current: string, poses: Pose[]): string {
  if (current) return current;
  return (poses.find((p) => p.is_default) ?? poses[0])?.id ?? "";
}
