/**
 * Turning a set of selected images into a training request, and a running job into something
 * readable (wanly-console#454).
 *
 * Extracted rather than left in the page for the reason vite.config.ts gives: tests here are
 * node-env and pure-logic only, so anything with a right and a wrong answer has to live outside
 * a component to be covered at all. These have right answers — an eligibility rule that lets a
 * doomed job through costs a GPU hour to discover.
 */
import type { TrainingJob } from "../api/types";
import type { Character } from "../api/ltx";

/** Below this a run is not worth the GPU hour. p@y worked on 13, which is the floor anyone has
 *  actually proved; the API refuses under 8 and this must agree with it or the dialog offers a
 *  button that 422s. */
export const MIN_IMAGES = 8;
/** A guard against a mis-click selecting a whole folder, not a quality opinion — the useful
 *  range tops out far below this. Culling k3llydw from 622 to 50 lifted mean cos 0.558 -> 0.699:
 *  more images is not better, the extras dilute. */
export const MAX_IMAGES = 400;

export interface Eligibility {
  ok: boolean;
  reason?: string;
  /** Worth saying even when the job is allowed. */
  warning?: string;
}

export function canTrain(keys: string[]): Eligibility {
  const unique = new Set(keys);
  if (unique.size < MIN_IMAGES) {
    return { ok: false, reason: `${unique.size} images — at least ${MIN_IMAGES} are needed` };
  }
  if (unique.size > MAX_IMAGES) {
    return { ok: false, reason: `${unique.size} images is more than ${MAX_IMAGES}` };
  }
  if (unique.size !== keys.length) {
    // A duplicate trains the same image twice under two names, silently reweighting the set.
    return { ok: false, reason: "the selection contains duplicates" };
  }
  if (unique.size > 80) {
    return {
      ok: true,
      warning:
        `${unique.size} images. More is not better — culling one character from 622 to 50 ` +
        `raised its identity score; the extras dilute.`,
    };
  }
  return { ok: true };
}

/**
 * A safe filename stem, as a STARTING POINT the user can correct.
 *
 * Deliberately a strip and not something cleverer. `p@y` becomes `py`, while the file this
 * project actually renders with is `pay_v2_e05.safetensors` — a human read `@` as `a`, and no
 * rule produces that. `@`→`a` is a transliteration, and a table for it generalises badly:
 * `k3lly2026` keeps its digits, so `3`→`e` would be wrong in the same breath.
 *
 * So the dialog shows this, and the user fixes it. Visibly a little wrong in a text field beats
 * invisibly wrong in the bucket.
 */
export function defaultLoraName(character: string): string {
  return character.replace(/[^A-Za-z0-9._-]/g, "") || "lora";
}

/** What the file will be called, given the stem the user settled on. */
export function loraFilename(stem: string, version: number, epoch?: number): string {
  const e = epoch === undefined ? "" : `_e${String(epoch).padStart(2, "0")}`;
  return `${stem}_v${version}${e}.safetensors`;
}

/** True when the default drops something the character name has, so the dialog can say why the
 *  filename field is not simply the name. */
export function nameNeedsSanitising(character: string): boolean {
  return defaultLoraName(character) !== character;
}

/** Percent complete, or null when there is nothing determinate to show yet. */
export function trainingPct(job: Pick<TrainingJob, "step" | "total_steps">): number | null {
  if (!job.total_steps || job.step === null || job.step === undefined) return null;
  return Math.min(100, Math.round((100 * job.step) / job.total_steps));
}

/**
 * A one-line summary for a row.
 *
 * Deliberately does not invent an ETA from nothing: a job that has not reported a step has no
 * honest estimate, and "0 min remaining" on a queued job is worse than silence.
 */
export function trainingSummary(job: TrainingJob): string {
  switch (job.status) {
    case "pending":
      return "queued";
    case "claimed":
      return `claimed by ${job.worker_name ?? "a trainer"}`;
    case "running": {
      const pct = trainingPct(job);
      return pct === null
        ? job.progress_log || "starting"
        : `${pct}% — step ${job.step} of ${job.total_steps}`;
    }
    case "completed":
      return job.checkpoints?.length
        ? `${job.checkpoints.length} checkpoints`
        : "completed";
    case "failed":
      return job.error_message || "failed";
    case "cancelled":
      return "cancelled";
    default:
      return job.status;
  }
}

/** Sort for the list: live work first, then most recent. */
export function byTrainingInterest(a: TrainingJob, b: TrainingJob): number {
  const order: Record<string, number> = {
    running: 0, claimed: 1, pending: 2, failed: 3, completed: 4, cancelled: 5,
  };
  const d = (order[a.status] ?? 9) - (order[b.status] ?? 9);
  if (d !== 0) return d;
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}

/**
 * The same rule the API enforces on a character name. Mirrored so the dialog can say so
 * before the button is pressed: a dataset called "Test faces" defaulted the character to
 * "Test faces", which the API refused with a 422 the user only saw after filling everything
 * in.
 */
export function characterProblem(name: string): string | null {
  if (!name) return "a character is required";
  if (name.length > 64) return "keep it under 64 characters";
  if (/\s/.test(name)) return "no spaces — it becomes a directory and a filename on the trainer";
  if (name.includes("/") || name.startsWith(".")) return "no slashes, and it cannot start with a dot";
  return null;
}

/** A character name a dataset name can suggest without breaking the rule above. */
export function defaultCharacterFor(datasetName: string): string {
  return datasetName.trim().replace(/\s+/g, "-").replace(/\//g, "-").replace(/^\.+/, "");
}

/** `2` out of `pay_v2_e05` or `pay_v2`. */
export function versionOfLora(stem: string): number | null {
  const m = /_v(\d+)(?:_|$)/.exec(stem);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * The version the next run of this character should be.
 *
 * One more than the highest that exists -- in a finished run, or on the character's current
 * LoRA when it was trained before the console kept runs at all. A failed or cancelled run
 * did not use its number up; retrying it as the same version is the point of retrying. The
 * dialog defaulted to 1 for everything, which for a character with a v2 in the library
 * meant a v1 that silently overwrote the last v1's files.
 */
export function nextVersion(
  character: string, jobs: TrainingJob[], characters: Character[],
): number {
  const name = character.trim().toLowerCase();
  if (!name) return 1;
  let highest = 0;
  for (const j of jobs) {
    if (j.character.toLowerCase() === name && j.status === "completed") {
      highest = Math.max(highest, j.version);
    }
  }
  const c = characters.find((x) => x.name.toLowerCase() === name);
  if (c) highest = Math.max(highest, versionOfLora(c.char_lora) ?? 0);
  return highest + 1;
}

/** `e05` or `final` out of an S3 URI -- what distinguishes one checkpoint from the next. */
export function checkpointLabel(uri: string): string {
  const stem = loraStem(uri);
  const m = /_(e\d+|final)$/.exec(stem);
  return m ? m[1] : stem;
}

/** `pay_v2_e05` out of `s3://ltx-loras/character/pay_v2_e05.safetensors` -- the name a
 *  character row stores. */
export function loraStem(uri: string): string {
  const name = uri.split("/").pop() ?? uri;
  return name.replace(/\.safetensors$/, "");
}

/** Which of a job's checkpoints the character currently renders with, if any. */
export function checkpointInUse(job: TrainingJob, characters: Character[]): string | null {
  const c = characters.find((x) => x.name === job.character);
  if (!c) return null;
  return (job.checkpoints ?? []).find((u) => loraStem(u) === c.char_lora) ?? null;
}
