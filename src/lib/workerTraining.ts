import type { TrainingJob } from "../api/types";
import { trainingPct } from "./trainingJob";

/**
 * The training run a worker is busy with, if any (console#671).
 *
 * The trainer drains the render side of a shared box while it trains (daemon#182: drain =
 * park) and undrains it afterwards, so a training box's row says `draining`. That is the
 * mechanism, not the activity: the card says Training instead, and does not offer Cancel
 * drain, which mid-run would let a render claim the card beside the trainer.
 */
export function trainingRun<T extends Pick<TrainingJob, "status" | "worker_name">>(
  worker: { friendly_name: string }, jobs: T[],
): T | null {
  return jobs.find((j) => (j.status === "running" || j.status === "claimed")
    && j.worker_name === worker.friendly_name) ?? null;
}

/** "Payton v2 · 43%", or without the percent before the trainer reports a step. */
export function trainingLabel(
  job: Pick<TrainingJob, "character" | "version" | "step" | "total_steps">,
): string {
  const pct = trainingPct(job);
  return `${job.character} v${job.version}${pct !== null ? ` · ${pct}%` : ""}`;
}

export const TRAINING_STATUS = { color: "#7e57c2", label: "Training" } as const;
