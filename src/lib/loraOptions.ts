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
