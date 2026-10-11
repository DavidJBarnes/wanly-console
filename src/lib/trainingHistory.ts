import type { TrainingJob } from "../api/types";
import { jobArch, type TrainArch } from "./trainingJob";

/**
 * The Characters page's run history (console#664): every LoRA run, SDXL and LTX, newest first,
 * one compact row each. A run's full card lives on its character's page; this is the "what
 * trained lately, across everyone" view the grid of characters cannot give.
 */
export interface HistoryRow {
  id: string;
  character: string;
  version: number;
  arch: TrainArch;
  status: TrainingJob["status"];
  /** The moment the row is dated by: finished if it has, else started, else queued. */
  when: string | null;
  /** What `when` is, so a queued run is not read as a finished one. */
  whenKind: "finished" | "started" | "queued";
}

export function historyWhen(job: Pick<TrainingJob, "completed_at" | "claimed_at" | "created_at">):
  { when: string | null; whenKind: HistoryRow["whenKind"] } {
  if (job.completed_at) return { when: job.completed_at, whenKind: "finished" };
  if (job.claimed_at) return { when: job.claimed_at, whenKind: "started" };
  return { when: job.created_at, whenKind: "queued" };
}

/** Newest first by `when`; an undated row sinks to the bottom rather than the top. */
export function historyRows(jobs: TrainingJob[], arch: TrainArch | "all" = "all"): HistoryRow[] {
  return jobs
    .map((j) => ({
      id: j.id, character: j.character, version: j.version, arch: jobArch(j),
      status: j.status, ...historyWhen(j),
    }))
    .filter((r) => arch === "all" || r.arch === arch)
    .sort((a, b) => (b.when ? Date.parse(b.when) : -Infinity) - (a.when ? Date.parse(a.when) : -Infinity));
}

export function isLiveStatus(s: TrainingJob["status"]): boolean {
  return s === "pending" || s === "claimed" || s === "running";
}
