import type { SegmentResponse } from "../api/types";

/**
 * Can this job be re-rolled — archived and re-generated with a new seed?
 *
 * Only while the job is still a single take.
 *
 * LIVE segments only. After a roll the job holds the archived take beside the new one, and
 * rolling again is the entire workflow — counting archived takes would let the button disappear
 * after the first use, which is the opposite of what it is for.
 *
 * It goes away once a segment 1 exists: segment 1 was generated from segment 0's last frame, so
 * replacing 0 would leave every successor continuing from a frame that no longer exists.
 *
 * And only for a finished take. A running segment has to be cancelled first, or the worker
 * spends the GPU time finishing something that has already been archived.
 */
export function canRerollSeed(videoSegments: SegmentResponse[]): boolean {
  const live = videoSegments.filter((s) => !s.discarded);
  return (
    live.length === 1 &&
    live[0].index === 0 &&
    ["completed", "failed"].includes(live[0].status)
  );
}
