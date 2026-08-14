import type { SegmentResponse } from "../api/types";

/**
 * Split a job's segments into the ones that are part of the video and the archived takes that
 * sit behind them.
 *
 * Re-rolling makes index stop being unique. The archived take keeps index 0 so the record reads
 * as "the discarded version of segment 0", and the replacement takes index 0 as its position in
 * the video — so a flat list shows two segment 0s, each with its own trim controls, drawn by the
 * branch lane as though the second continued from the first. They are not a sequence, they are
 * alternatives, and the display has to say so.
 *
 * Everything that treats a segment as a position in the video — the lane, trims, transitions,
 * "what plays next" — belongs to `live`. Archived takes are evidence, reachable under the take
 * that replaced them.
 */
export interface TakeGroups {
  /** In video order. One per index. */
  live: SegmentResponse[];
  /** Archived takes keyed by the index they were replaced at, newest first. */
  archivedByIndex: Map<number, SegmentResponse[]>;
}

export function groupTakes(videoSegments: SegmentResponse[]): TakeGroups {
  const live = videoSegments
    .filter((s) => !s.discarded)
    .sort((a, b) => a.index - b.index);

  const archivedByIndex = new Map<number, SegmentResponse[]>();
  for (const seg of videoSegments) {
    if (!seg.discarded) continue;
    const takes = archivedByIndex.get(seg.index) ?? [];
    takes.push(seg);
    archivedByIndex.set(seg.index, takes);
  }
  // Newest first: the most recently archived take is the one just replaced, and it is the one
  // being compared against.
  for (const takes of archivedByIndex.values()) {
    takes.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }

  return { live, archivedByIndex };
}

/**
 * What to show as a take's seed.
 *
 * Only a seed the segment actually carries. The alternative — deriving job.seed + index in the
 * browser — cannot be done honestly: seeds are stored as 64-bit integers and 95% of existing jobs
 * have one above 2**53, so the job seed the browser holds has already been rounded and any sum
 * from it is a number that never generated anything. The API sends seeds as strings for exactly
 * this reason, and stamps an archived take with the seed it ran on.
 */
export function takeSeed(seg: SegmentResponse): string | null {
  return seg.seed ?? null;
}

/**
 * Every archived take, in the order they are listed at the bottom of the page.
 *
 * By position, then newest first within a position. They sit in one section under all the
 * segments rather than folded under the take that replaced each of them: interleaving them put a
 * "previous takes" fold between segment 0 and segment 1, which breaks the one thing the segment
 * list is for — reading the video in order.
 *
 * Collecting them all also means a take whose position has no live segment still appears.
 * Discarding a segment WITHOUT re-rolling it is the ordinary flow — a bad segment leaves the cut
 * while its rating and notes stay on the job — and those takes have no live sibling to sit under.
 */
export function allArchivedTakes(groups: TakeGroups): SegmentResponse[] {
  return [...groups.archivedByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, takes]) => takes);
}
