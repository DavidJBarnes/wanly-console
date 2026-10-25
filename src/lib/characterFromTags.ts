/**
 * Best-guess character from the start image's tags (console#696), the character half of
 * poseFromTags (console#694).
 *
 * Only used when no character is starred: a star is a deliberate "render this one", so it
 * beats whatever the image is tagged with. Pure so node-env vitest can cover it without React.
 *
 * A tag names a character when it IS the character's name, ignoring case -- the same rule
 * TagChip uses for its icon (console#684). Two people are tagged under a different name than
 * their character carries, so they are aliased here. A pair whose members are all tagged
 * beats either member alone: an image tagged David + Chelsey is the pair's render, not hers.
 */
import type { Character } from "../api/ltx";

/** Image tag -> character name, for tags that are not the character's own name. Lower-case
 *  keys. Exact tags only: KellyBangs and KellyTeacher are not aliases of anyone. */
const TAG_ALIASES: Record<string, string> = {
  kellyyoung: "Kelly-2000",
  kelly: "Kelly-2026",
};

export interface CharacterGuess {
  name: string;
  /** The image tags that picked it, as the image spells them — shown next to the picker. */
  matched: string[];
}

export function guessCharacterFromTags(
  tags: string | null | undefined, characters: Character[],
): CharacterGuess | null {
  const imageTags = (tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  // Hidden characters are never offered (console#617), so never guessed either.
  const offered = characters.filter((c) => !c.hidden);
  const byName = new Map(offered.map((c) => [c.name.toLowerCase(), c]));

  // Character name (lower-case) -> the tag that named it, in tag order.
  const named = new Map<string, string>();
  for (const tag of imageTags) {
    const key = (TAG_ALIASES[tag.toLowerCase()] ?? tag).toLowerCase();
    if (byName.has(key) && !named.has(key)) named.set(key, tag);
  }
  if (!named.size) return null;

  // The pair with the most members, all of them tagged.
  const pair = offered
    .filter((c) => c.kind === "pair" && c.members?.length
      && c.members.every((m) => named.has(m.toLowerCase())))
    .sort((a, b) => (b.members?.length ?? 0) - (a.members?.length ?? 0))[0];
  if (pair) {
    return { name: pair.name, matched: pair.members!.map((m) => named.get(m.toLowerCase())!) };
  }
  // Else the first tag that names someone. A pair can be tagged by its own name, too.
  const [key, tag] = [...named][0];
  return { name: byName.get(key)!.name, matched: [tag] };
}
