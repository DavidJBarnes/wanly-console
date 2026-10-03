/**
 * Bulk delete with a pre-check (console#594).
 *
 * Bulk delete used to fire one DELETE per image and count the 409s, so the person learned
 * "Deleted N · M still in use" — not which images, not what held them, and no choice. Now
 * the selection goes through `POST /images/in-use` first (one call), the dialog shows every
 * held image with its holders, and the person picks: delete only the free ones, force all of
 * them, or cancel.
 *
 * Force here is exactly single-image force (`DELETE /images?force=true`): the image's caption
 * and dataset caption/score entries go, the dataset keeps a dead membership entry, and any job
 * that still points at the file fails when a worker picks it up. That last part is why holders
 * carry a `state`: a queued or held job is named in a warning that must be acknowledged, never
 * broken silently.
 */
import { apiError } from "./apiError";
import { describeHolders, parseImageInUse } from "./imageDeleteConflict";

/** queued: waiting for or on a worker. held: will run again without anyone re-queueing it
 *  (paused job, segment waiting on a caption). idle: finished, archived, awaiting the next
 *  segment — only a deliberate re-run would fetch the image. */
export type HolderState = "queued" | "held" | "idle";

export interface HeldJob { id: string; name: string; status: string; state: HolderState }
export interface HeldSegment {
  id: string; jobId: string; jobName: string | null; index: number; status: string;
  state: HolderState;
}
export interface HeldTraining {
  id: string; character: string; version: number | null; status: string; state: HolderState;
}
export interface HeldDataset { id: string; name: string }

export interface ImageHolders {
  jobIds: string[];
  segmentIds: string[];
  datasetIds: string[];
  trainingIds: string[];
  jobs: HeldJob[];
  segments: HeldSegment[];
  trainings: HeldTraining[];
  datasets: HeldDataset[];
  /** A queued or held holder would break if this image were force-deleted. */
  needed: boolean;
}

export type InUseMap = Record<string, ImageHolders>;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const state = (v: unknown): HolderState => (v === "queued" || v === "held" ? v : "idle");
const objects = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    : [];

/**
 * Read the `POST /images/in-use` body into camelCase, defensively.
 *
 * An entry that names no holder at all is dropped: the API contradicting itself should read
 * as "free" (and the delete's own 409 is still the gate), not as "in use by nothing".
 */
export function parseInUseResponse(data: unknown): InUseMap {
  const paths = (data as { paths?: unknown })?.paths;
  if (!paths || typeof paths !== "object") return {};
  const out: InUseMap = {};
  for (const [path, raw] of Object.entries(paths as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const jobs = objects(r.jobs).map((j) => ({
      id: str(j.id), name: str(j.name), status: str(j.status), state: state(j.state),
    }));
    const segments = objects(r.segments).map((s) => ({
      id: str(s.id),
      jobId: str(s.job_id),
      jobName: typeof s.job_name === "string" ? s.job_name : null,
      index: typeof s.index === "number" ? s.index : 0,
      status: str(s.status),
      state: state(s.state),
    }));
    const trainings = objects(r.trainings).map((t) => ({
      id: str(t.id),
      character: str(t.character),
      version: typeof t.version === "number" ? t.version : null,
      status: str(t.status),
      state: state(t.state),
    }));
    const datasets = objects(r.datasets).map((d) => ({ id: str(d.id), name: str(d.name) }));
    const entry: ImageHolders = {
      jobIds: strings(r.job_ids),
      segmentIds: strings(r.segment_ids),
      datasetIds: strings(r.dataset_ids),
      trainingIds: strings(r.training_ids),
      jobs,
      segments,
      trainings,
      datasets,
      // Derived as well as read: a holder marked queued must warn even if `needed` is absent.
      needed: r.needed === true || [...jobs, ...segments, ...trainings].some((h) => h.state !== "idle"),
    };
    const total = entry.jobIds.length + entry.segmentIds.length + entry.datasetIds.length +
      entry.trainingIds.length;
    if (total === 0) continue;
    out[path] = entry;
  }
  return out;
}

/** Which of the selected paths are free and which are held, in selection order. */
export function splitSelection(paths: string[], inUse: InUseMap): { free: string[]; held: string[] } {
  const free: string[] = [];
  const held: string[] = [];
  for (const p of paths) (inUse[p] ? held : free).push(p);
  return { free, held };
}

/** "2 jobs and 1 dataset", for one image's line in the dialog. */
export function describeImageHolders(h: ImageHolders): string {
  return describeHolders({ path: "", ...h });
}

export interface NeededHolder {
  kind: "job" | "segment" | "training";
  id: string;
  /** The job a link should open — a segment's parent job. Null for a training run. */
  jobId: string | null;
  label: string;
  state: HolderState;
}

/**
 * Every queued or held holder across these images, deduped: what a force delete would break.
 *
 * Deduped by holder, not by image: one queued job holding five selected images is one line.
 * A job and its own segment are still listed separately, because a paused job and its
 * awaiting-caption segment are two different things the person may want to go look at.
 */
export function neededHolders(inUse: InUseMap, paths?: string[]): NeededHolder[] {
  const seen = new Map<string, NeededHolder>();
  for (const p of paths ?? Object.keys(inUse)) {
    const h = inUse[p];
    if (!h) continue;
    for (const j of h.jobs) {
      if (j.state === "idle") continue;
      seen.set(`job:${j.id}`, {
        kind: "job", id: j.id, jobId: j.id, state: j.state,
        label: `${j.name || j.id} (${j.status})`,
      });
    }
    for (const s of h.segments) {
      if (s.state === "idle") continue;
      seen.set(`segment:${s.id}`, {
        kind: "segment", id: s.id, jobId: s.jobId, state: s.state,
        label: `${s.jobName || s.jobId} · segment ${s.index + 1} (${s.status.replace(/_/g, " ")})`,
      });
    }
    for (const t of h.trainings) {
      if (t.state === "idle") continue;
      seen.set(`training:${t.id}`, {
        kind: "training", id: t.id, jobId: null, state: t.state,
        label: `training ${t.character}${t.version != null ? ` v${t.version}` : ""} (${t.status})`,
      });
    }
  }
  return Array.from(seen.values());
}

/**
 * Needed holders in `after` that the person was not shown in `before`.
 *
 * The force run re-checks just before it deletes. Anything new here — a job queued on one of
 * these images while the dialog was open — means the acknowledgement no longer covers what
 * would break, so the run stops and the dialog is shown again rather than breaking it silently.
 */
export function newlyNeeded(before: InUseMap, after: InUseMap, paths: string[]): NeededHolder[] {
  const shown = new Set(neededHolders(before, paths).map((h) => `${h.kind}:${h.id}`));
  return neededHolders(after, paths).filter((h) => !shown.has(`${h.kind}:${h.id}`));
}

export interface DeleteOutcome {
  path: string;
  filename: string;
  /** Null when deleted; otherwise why not, in words. */
  error: string | null;
}

/** Why one delete in the run did not happen. A refusal names its holders; anything else is
 *  the API's own reason (a 503 says what is busy). */
export function deleteFailureReason(e: unknown): string {
  const conflict = parseImageInUse(e);
  if (conflict) return `now in use by ${describeHolders(conflict)}, so it was skipped`;
  return apiError(e, "delete failed");
}

/** The one-line result for the snackbar, plus the failures the dialog lists. */
export function summarizeBulkDelete(outcomes: DeleteOutcome[], skipped: number): {
  deleted: number;
  failures: DeleteOutcome[];
  message: string;
} {
  const failures = outcomes.filter((o) => o.error !== null);
  const deleted = outcomes.length - failures.length;
  const parts = [`Deleted ${deleted} image${deleted === 1 ? "" : "s"}`];
  if (skipped) parts.push(`${skipped} in use kept`);
  if (failures.length) parts.push(`${failures.length} failed`);
  return { deleted, failures, message: parts.join(" · ") };
}
