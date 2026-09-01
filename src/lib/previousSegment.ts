import type { SegmentResponse } from "../api/types";

/**
 * The segment a continuation should follow, and therefore prefill from.
 *
 * The highest index that is not discarded. Both halves matter:
 *
 * - HIGHEST INDEX, not last in the array. Segment order in a response is not guaranteed to
 *   be index order, and a chain that appended out of order would otherwise prefill from the
 *   middle of itself.
 * - NOT DISCARDED. A re-roll leaves the old take in place, soft-deleted, at the SAME index
 *   as its replacement. Continuing from the take that was thrown away is precisely wrong,
 *   and it would look right — same pose, same character, just the settings of the version
 *   the user rejected.
 *
 * Returns null for a job with nothing usable, which the caller treats as "open on defaults".
 */
export function pickPreviousSegment(
  segments: SegmentResponse[] | undefined | null,
): SegmentResponse | null {
  return (segments ?? [])
    .filter((s) => !s.discarded)
    .reduce<SegmentResponse | null>(
      (best, s) => (best === null || s.index > best.index ? s : best),
      null,
    );
}
