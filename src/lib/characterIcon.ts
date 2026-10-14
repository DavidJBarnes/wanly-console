/**
 * The character's icon, and which characters a picker offers (console#616, #617).
 *
 * ONE RULE FOR EVERY PLACE. The icon follows the character wherever it is shown or picked --
 * the Characters grid, the render and Train dialogs, the Datasets owner picker, the Training
 * page -- so where it comes from is decided here, once.
 */
import type { Character } from "../api/ltx";

type IconSource = Pick<Character, "icon_uri" | "image_uri" | "face_ref_uri" | "sheet_uri">;

/** The picked icon, else the image that already represented the character: the trained
 *  LoRA's anchor face, then the face reference, then the sheet. Null: no image at all (the
 *  avatar shows the initial). */
export function characterIconUri(c: IconSource | null | undefined): string | null {
  if (!c) return null;
  return c.icon_uri || c.image_uri || c.face_ref_uri || c.sheet_uri || null;
}

/** The icon URL for a name shown as a badge (console#684): a tag, or the character a
 *  `pair: X` chip names. Matched on the trimmed name, case-insensitively, against the map
 *  useCharacterIcons() builds (keys lower-cased). Undefined: not a character, or one with no
 *  image -- the chip shows the plain text. */
export function iconForName(icons: Map<string, string>, name: string | null | undefined): string | undefined {
  const key = name?.trim().toLowerCase();
  return key ? icons.get(key) : undefined;
}

/**
 * What a picker offers: every character that is not hidden -- plus the one currently
 * selected, hidden or not. A job made before its character was hidden must still show who it
 * is of; dropping the selected value would blank the field, and saving would change it.
 */
export function offeredCharacters<T extends Pick<Character, "name" | "hidden">>(
  characters: T[], selected?: string | null,
): T[] {
  return characters.filter((c) => !c.hidden || (!!selected && c.name === selected));
}
