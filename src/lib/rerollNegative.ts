/**
 * What the re-roll dialog posts for the negative prompt (console#449).
 *
 * The field opens on the take's own negative — the resolved value it actually ran with — and
 * the send rule has three outcomes, matching the API's grammar:
 *
 * - UNCHANGED posts nothing, so an untouched dialog stays a seed-only (or prompt-only) roll.
 *   A take whose row is NULL still counts as unchanged when the box holds nothing: "no
 *   request" and "explicitly inherit" are the same act here, and marking the difference would
 *   dress a seed-only roll up as an edit.
 * - A CLEARED box on a take that had a value posts "" — the explicit "drop it", which the API
 *   stores as NULL so the claim resolves the live Settings default again. It can never mean
 *   "render with no negative" (console#430's rule: empty means default, not nothing), and a
 *   take whose negative was NULL offers nothing to drop.
 * - Anything else posts the text.
 *
 * Serves `SegmentResponse.negative_prompt`, which is nullable because inherited-none is a
 * real state a row can be in.
 */
export function rerollNegativeToSend(
  takeNegative: string | null | undefined,
  typed: string,
): string | undefined {
  const value = typed.trim();
  if (value === (takeNegative ?? "")) return undefined;
  return value;
}
