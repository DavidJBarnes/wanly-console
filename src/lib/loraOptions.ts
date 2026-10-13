/**
 * What the character LoRA dropdown offers.
 *
 * Two sources, and both are needed:
 *
 *   the BUCKET  — every LoRA a worker can actually fetch, including ones no character
 *                 uses yet. This is the whole point of the dropdown: without it you can
 *                 only pick LoRAs that are already characters, so a new one can never be
 *                 added through the form built to add it (#395).
 *
 *   the BOOK    — the LoRAs existing characters already reference. Kept so that opening a
 *                 character whose file has since left the bucket still shows its own value
 *                 instead of a blank field that saves the blank back over it.
 */
export function mergeLoraOptions(
  bookLoras: readonly string[],
  bucketNames: readonly string[],
): string[] {
  const names = new Set<string>();
  // Names are stored inconsistently — the bucket has "x.safetensors", a character row may
  // have "x" — and the engine appends the extension when it is missing, so both forms work
  // at render time. Normalising here is what stops one LoRA appearing as two entries.
  for (const n of [...bookLoras, ...bucketNames]) {
    const bare = n.trim().replace(/\.safetensors$/i, "");
    if (bare) names.add(bare);
  }
  return [...names].sort();
}

/** The value the dropdowns use for their "Show all LoRAs" entry, never a real LoRA name. */
export const SHOW_ALL_LORAS = "__show_all_loras__";

/**
 * A character's own LoRAs, out of everything the dropdown could offer (console#680).
 *
 * A LoRA is the character's when its name is the character's -- optionally `-Synthetic`,
 * the synthetic-set runs -- then `_v<n>`, ignoring case: Payton gets `Payton_v2_final`,
 * `Payton_v3_final` and `Payton-Synthetic_v1_final`, which is how the trainer names its
 * output. Anchored at the start, so Joana never gets `DavidJoana_v2_final`, and only
 * `-Synthetic` counts as a suffix, so a "Kelly" would not get `Kelly-2000_*`.
 *
 * `keep` -- the character's current char_lora and the value already selected -- is always
 * in, so a legacy name (`k3llydw_v2`) or a deliberate pick from another character never
 * vanishes from its own field. Null when nothing matches the name at all (a new character,
 * a name typed half way): then the whole list is the honest answer.
 */
export function lorasForCharacter(
  name: string | null | undefined,
  loras: readonly string[],
  keep: readonly (string | null | undefined)[] = [],
): string[] | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${esc}(-synthetic)?_v\\d`, "i");
  const own = loras.filter((l) => re.test(l));
  if (own.length === 0) return null;
  const extra = keep.filter((k): k is string => !!k && k !== "none" && !own.includes(k));
  return [...extra, ...own];
}
