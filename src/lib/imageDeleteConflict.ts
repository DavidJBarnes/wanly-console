/**
 * Reading the 409 that `DELETE /images` returns when something still points at the image.
 *
 * The API refuses rather than deleting, because a deleted-but-referenced image fails silently:
 * nothing breaks until a worker claims the segment and S3 returns 404, which costs a pickup and
 * surfaces as a red segment nowhere near the cause (wanly-api#156).
 *
 * The refusal is only useful if the UI says *what* is holding the image. Before this, the
 * handler silently ignored it - the delete correctly did not happen and the user was
 * told nothing at all, which teaches people to distrust the button rather than go look at the
 * job.
 */

export interface ImageInUse {
  path: string;
  jobIds: string[];
  segmentIds: string[];
}

/**
 * Pull the conflict out of an axios error, or null if this was not a 409-in-use.
 *
 * Anything that is not a well-formed 409 returns null so the caller falls back to ordinary
 * error handling — a network failure must not be reported as "image in use".
 */
export function parseImageInUse(error: unknown): ImageInUse | null {
  const response = (error as { response?: { status?: number; data?: unknown } })?.response;
  if (response?.status !== 409) return null;

  const detail = (response.data as { detail?: unknown })?.detail;
  if (!detail || typeof detail !== "object") return null;

  const d = detail as { path?: unknown; job_ids?: unknown; segment_ids?: unknown };
  const jobIds = Array.isArray(d.job_ids) ? d.job_ids.filter((x): x is string => typeof x === "string") : [];
  const segmentIds = Array.isArray(d.segment_ids)
    ? d.segment_ids.filter((x): x is string => typeof x === "string")
    : [];

  // A 409 with no holders at all would be the API contradicting itself. Treat it as an ordinary
  // error rather than rendering "still used by 0 things".
  if (jobIds.length === 0 && segmentIds.length === 0) return null;

  return {
    path: typeof d.path === "string" ? d.path : "",
    jobIds,
    segmentIds,
  };
}

/** "2 jobs and 1 segment" — for a sentence, so it has to read naturally at 1 and at 0. */
export function describeHolders(conflict: ImageInUse): string {
  const parts: string[] = [];
  if (conflict.jobIds.length) {
    parts.push(`${conflict.jobIds.length} job${conflict.jobIds.length === 1 ? "" : "s"}`);
  }
  if (conflict.segmentIds.length) {
    parts.push(
      `${conflict.segmentIds.length} segment${conflict.segmentIds.length === 1 ? "" : "s"}`,
    );
  }
  return parts.join(" and ");
}
