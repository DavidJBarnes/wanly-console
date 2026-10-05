/**
 * A character's versions, LTX and SDXL side by side (console#616).
 *
 * WHY SIDE BY SIDE. Since wanly-api#402 each arch numbers its own runs, so a character's SDXL
 * v1 and LTX v1 are the two LoRAs of one generation -- usually trained from the same dataset.
 * One row per version number, one column per arch, makes that alignment the first thing you
 * see, and a gap ("LTX v3, no SDXL v3 yet") just as visible.
 */
import type { TrainingJob } from "../api/types";
import { jobArch, type TrainArch } from "./trainingJob";

export interface VersionRow {
  version: number;
  ltx: TrainingJob | null;
  sdxl: TrainingJob | null;
}

const LIVE = new Set(["pending", "claimed", "running"]);

/** Which run stands for an arch+version when there are several (a failed attempt, then its
 *  retry): a live one, else a completed one, else the newest. */
function representative(runs: TrainingJob[]): TrainingJob {
  const by = (pred: (j: TrainingJob) => boolean) => runs.filter(pred)
    .sort((a, b) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? ""))[0];
  return by((j) => LIVE.has(j.status)) ?? by((j) => j.status === "completed") ?? by(() => true);
}

/** One row per version number that either arch has, newest first. */
export function versionRows(runs: TrainingJob[]): VersionRow[] {
  const groups = new Map<string, TrainingJob[]>();
  for (const j of runs) {
    const k = `${jobArch(j)}:${j.version}`;
    groups.set(k, [...(groups.get(k) ?? []), j]);
  }
  const versions = [...new Set(runs.map((j) => j.version))].sort((a, b) => b - a);
  const pick = (arch: TrainArch, v: number) => {
    const g = groups.get(`${arch}:${v}`);
    return g ? representative(g) : null;
  };
  return versions.map((v) => ({ version: v, ltx: pick("ltx", v), sdxl: pick("sdxl", v) }));
}

/** The highest COMPLETED version per arch: "latest" means a LoRA you can use. */
export function latestVersions(runs: TrainingJob[]): Record<TrainArch, number | null> {
  const top = (arch: TrainArch) => {
    const vs = runs.filter((j) => jobArch(j) === arch && j.status === "completed")
      .map((j) => j.version);
    return vs.length ? Math.max(...vs) : null;
  };
  return { ltx: top("ltx"), sdxl: top("sdxl") };
}

/** The dataset a run trained from, as it was named then. */
export function runDatasetName(job: Pick<TrainingJob, "config">): string | null {
  const d = (job.config as { dataset?: { name?: string | null } } | null)?.dataset;
  return d?.name ?? null;
}
