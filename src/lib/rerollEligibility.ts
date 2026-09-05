import type { JobStatus, SegmentResponse } from "../api/types";

/**
 * Which segment the Re-roll button acts on, or null when it should not be offered.
 *
 * THE JOB'S CURRENT TAKE — the highest-index live segment (console#424). This used to answer
 * a narrower question ("is this job still a single take at index 0?"), and the generalisation
 * keeps the same protection: a segment with a live successor is the frame that successor
 * continues from, so replacing it would leave every one of them continuing from a frame that
 * no longer exists. Segment 0 stays re-rollable exactly as long as it is the only one.
 *
 * LIVE segments only. After a roll the job holds the archived take beside the new one, and
 * rolling again is the entire workflow — counting archived takes would hide the button after
 * the first use, which is the opposite of what it is for.
 *
 * Only a finished take. A running segment has to be cancelled first, or the worker spends the
 * GPU time finishing something that has already been archived.
 *
 * And never on a finalized job: its stitched output describes the takes that were live when
 * it was built, so archiving one behind that video would make the record wrong. The API
 * refuses these too — this is about not offering a button that cannot work.
 */
const NO_REROLL: JobStatus[] = ["finalized", "finalizing", "archived"];

export function rerollableSegment(
  videoSegments: SegmentResponse[],
  jobStatus: JobStatus,
): SegmentResponse | null {
  if (NO_REROLL.includes(jobStatus)) return null;

  const live = videoSegments.filter((s) => !s.discarded);
  if (live.length === 0) return null;

  const current = live.reduce((a, b) => (b.index > a.index ? b : a));
  return ["completed", "failed"].includes(current.status) ? current : null;
}
