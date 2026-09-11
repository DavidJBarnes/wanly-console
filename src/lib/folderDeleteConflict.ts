/**
 * Pull the folder-delete conflict out of an axios error, or null if this was not a
 * refused folder delete.
 *
 * A folder of images is unrecoverable once deleted: a refusal is not a failure but the API
 * declining because something still points at one of them. The 409 names every holding
 * job/segment/dataset so the dialog can say exactly what will dangle.
 *
 * Anything that is not a well-formed folder 409 returns null so the caller falls back to
 * ordinary error handling — a network failure must not be reported as "folder in use".
 */
export function parseFolderInUse(error: unknown): {
  folder: string;
  imageCount: number;
  referencedCount: number;
  paths: Record<string, { jobIds: string[]; segmentIds: string[]; datasetIds: string[] }>;
} | null {
  const response = (error as { response?: { status?: number; data?: unknown } })?.response;
  if (response?.status !== 409) return null;

  const detail = (response.data as { detail?: unknown })?.detail;
  if (!detail || typeof detail !== "object") return null;

  const d = detail as {
    folder?: unknown;
    image_count?: unknown;
    referenced_count?: unknown;
    paths?: unknown;
  };
  if (typeof d.paths !== "object" || d.paths === null) return null;

  const paths: Record<string, { jobIds: string[]; segmentIds: string[]; datasetIds: string[] }> = {};
  for (const [path, holders] of Object.entries(d.paths as Record<string, unknown>)) {
    const h = holders as { job_ids?: unknown; segment_ids?: unknown; dataset_ids?: unknown };
    paths[path] = {
      jobIds: Array.isArray(h.job_ids) ? h.job_ids.filter((x): x is string => typeof x === "string") : [],
      segmentIds: Array.isArray(h.segment_ids)
        ? h.segment_ids.filter((x): x is string => typeof x === "string")
        : [],
      datasetIds: Array.isArray(h.dataset_ids)
        ? h.dataset_ids.filter((x): x is string => typeof x === "string")
        : [],
    };
  }

  return {
    folder: typeof d.folder === "string" ? d.folder : "",
    imageCount: typeof d.image_count === "number" ? d.image_count : 0,
    referencedCount: typeof d.referenced_count === "number" ? d.referenced_count : 0,
    paths,
  };
}
