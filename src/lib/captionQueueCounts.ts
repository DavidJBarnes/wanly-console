import type { CaptionQueueStatus } from "../api/types";

/**
 * What the toolbar's caption chip counts (console#727). The lane holds at most one of the
 * describe queue's images at a time, so the upload backlog is added on top of the lane's own
 * depth; an API older than the queue sends no backlog and counts as none.
 */
export function captionQueueCounts(q: CaptionQueueStatus): {
  left: number;
  behind: number;
  failed: number;
} {
  const backlog = q.backlog ?? 0;
  return {
    left: q.depth + backlog,
    behind: q.waiting + backlog,
    failed: q.backlog_failed ?? 0,
  };
}
