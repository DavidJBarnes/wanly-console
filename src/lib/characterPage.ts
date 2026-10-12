import type { Character } from "../api/ltx";
import type { Dataset } from "../api/types";
import { characterIconUri } from "./characterIcon";

/** Characters and Datasets collapsed (wanly-api#452): small rules shared by the pages. */

/** The picture that stands for a character: a hand-chosen icon, then its dataset's anchor
 *  (David: "make the anchor the card pic"), then the old fallbacks. */
export function characterPicture(
  c: Pick<Character, "icon_uri" | "image_uri" | "face_ref_uri" | "sheet_uri">,
  anchor: string | null | undefined,
): string | null {
  return c.icon_uri || anchor || characterIconUri(c);
}

/** A set is a character's OWN when it is that registered character's living character set
 *  (or a pair's living composition set). Such a set lives on the character's page. */
export function ownerOf(
  ds: Pick<Dataset, "kind" | "character" | "archived_at">,
  characters: Pick<Character, "name">[],
): string | null {
  if (!ds.character || ds.archived_at) return null;
  if (ds.kind !== "character" && ds.kind !== "composition") return null;
  return characters.some((c) => c.name === ds.character) ? ds.character : null;
}

/** Where an old /datasets/:id link to a character's own set goes. */
export function characterSetHome(owner: string, run: string | null): string {
  const q = run ? `?tab=training&run=${encodeURIComponent(run)}` : "?tab=images";
  return `/characters/${encodeURIComponent(owner)}${q}`;
}

export type CharacterTab = "settings" | "images" | "sheet" | "training" | "history";
export const CHARACTER_TABS: CharacterTab[] = ["settings", "images", "sheet", "training", "history"];

/** Which tab a URL opens (console#666). Settings is first and the default; the old
 *  `?tab=identity` is Settings now; a `?run=<id>` link (the Characters page's training
 *  history) opens Training, where that run's card is. */
export function tabFromParams(p: URLSearchParams): CharacterTab {
  const t = p.get("tab");
  if (t === "identity") return "settings";
  if (CHARACTER_TABS.includes(t as CharacterTab)) return t as CharacterTab;
  return p.get("run") ? "training" : "settings";
}
