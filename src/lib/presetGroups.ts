/**
 * Preset "groups", derived from the name rather than stored.
 *
 * Presets are named `<GROUP> - <DESCRIPTION>` by hand ("Final - Doggystyle (front facing)"), so
 * the grouping already exists in the library — it is just not addressable. Reading it back out of
 * the name means no schema column, no migration, and no second place to keep in sync: renaming a
 * preset regroups it. The cost is that the convention is only a convention, which is why anything
 * without the separator stays visible under UNGROUPED instead of silently disappearing.
 */

/** The separator is the SPACED hyphen. "Wan-2.2 base" is one name, not group "Wan" — hyphens
 *  inside a word are common enough that matching a bare "-" would invent groups nobody meant. */
const SEPARATOR = " - ";

/** Bucket for presets that do not follow the naming convention. Not a group anyone typed, so it
 *  only ever appears as a pill when something actually falls into it. */
export const UNGROUPED = "Ungrouped";

export interface NamedPreset {
  name: string;
}

/** The group a preset name declares, or null if it declares none.
 *
 *  Split on the FIRST separator: "Final - Doggystyle - front" is group "Final", because the
 *  description is free text and may well contain another spaced hyphen. */
export function groupOf(name: string): string | null {
  const i = name.indexOf(SEPARATOR);
  if (i <= 0) return null;
  return name.slice(0, i).trim() || null;
}

/**
 * Every group present in `presets`, alphabetically, with UNGROUPED last if it is occupied.
 *
 * Derived from whatever list is passed in — which is how the pills end up respecting the "show
 * archived" toggle without knowing it exists: pass the archived-included list and archived-only
 * groups appear; pass the active list and they do not.
 *
 * Matching is case-insensitive so "final - a" and "Final - b" are one pill rather than two; the
 * first spelling encountered is the one shown.
 */
export function collectGroups(presets: NamedPreset[]): string[] {
  const seen = new Map<string, string>();
  let hasUngrouped = false;
  for (const p of presets) {
    const g = groupOf(p.name);
    if (!g) {
      hasUngrouped = true;
      continue;
    }
    const key = g.toLowerCase();
    if (!seen.has(key)) seen.set(key, g);
  }
  const groups = [...seen.values()].sort((a, b) => a.localeCompare(b));
  return hasUngrouped ? [...groups, UNGROUPED] : groups;
}

/**
 * The presets to show for a pill selection.
 *
 * No selection means no filter — the pills are a way to narrow the library, not a gate in front
 * of it. Multiple selected pills union, so two groups can be compared side by side.
 */
export function filterByGroups<T extends NamedPreset>(presets: T[], selected: Set<string>): T[] {
  if (selected.size === 0) return presets;
  const wanted = new Set([...selected].map((g) => g.toLowerCase()));
  return presets.filter((p) => wanted.has((groupOf(p.name) ?? UNGROUPED).toLowerCase()));
}
