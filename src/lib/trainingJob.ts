/**
 * Turning a set of selected images into a training request, and a running job into something
 * readable (wanly-console#454).
 *
 * Extracted rather than left in the page for the reason vite.config.ts gives: tests here are
 * node-env and pure-logic only, so anything with a right and a wrong answer has to live outside
 * a component to be covered at all. These have right answers — an eligibility rule that lets a
 * doomed job through costs a GPU hour to discover.
 */
import { dateTimeLabel, sameDay, spanLabel, timeLabel } from "./dateTime";
import type {
  Dataset, DatasetKind, PreflightItem, PublishMode, TrainingCreate, TrainingJob,
} from "../api/types";
import type { Character } from "../api/ltx";
import { isClip } from "./datasets";

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

/**
 * Whether a set of items can train. Counts STILLS only (wanly-console#625): the 8-400 floor and
 * ceiling are the identity group's, and clips go into a group of their own that the floor does
 * not apply to. A set of 3 photos and 10 clips is refused by the API, so it is refused here.
 */
export function canTrain(keys: string[]): Eligibility {
  const unique = new Set(keys.filter((k) => !isClip(k)));
  if (unique.size < MIN_IMAGES) {
    return { ok: false, reason: `${unique.size} images — at least ${MIN_IMAGES} are needed` };
  }
  if (unique.size > MAX_IMAGES) {
    return { ok: false, reason: `${unique.size} images is more than ${MAX_IMAGES}` };
  }
  if (new Set(keys).size !== keys.length) {
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

/** A readable sentence out of an API error, including pydantic's list-of-errors shape. */
export function apiErrorText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => {
        const loc = Array.isArray(d?.loc) ? d.loc.filter((x: unknown) => x !== "body").join(".") : "";
        const msg = typeof d?.msg === "string" ? d.msg.replace(/^Value error, /, "") : "";
        return loc && msg ? `${loc}: ${msg}` : msg || loc;
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return fallback;
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
    case "completed": {
      // Uploaded is not written (console#627): a "none" run finishes with every checkpoint
      // still on the trainer, which is a finished run, not an empty one.
      const uploaded = job.checkpoints?.length ?? 0;
      const written = Math.max(job.epochs?.length ?? 0, uploaded);
      if (!written) return "completed";
      if (written === uploaded) return `${uploaded} checkpoints`;
      return `${written} checkpoints, ${uploaded || "none"} uploaded`;
    }
    case "failed":
      return job.error_message || "failed";
    case "cancelled":
      return "cancelled";
    default:
      return job.status;
  }
}

/** Sort for the list: live work first, then most recent.
 *
 *  PENDING is the exception (console#526): the trainer claims `created_at ASC`, so pending
 *  rows ARE a queue, and a queue that displays newest-first puts the job training NEXT at
 *  the bottom — every added job visibly "cutting in line" that it is not. The queue reads
 *  top-down in the order it drains; finished work keeps newest-first, where "most recent"
 *  is the interesting one.
 */
export function byTrainingInterest(a: TrainingJob, b: TrainingJob): number {
  const order: Record<string, number> = {
    running: 0, claimed: 1, pending: 2, failed: 3, completed: 4, cancelled: 5,
  };
  const d = (order[a.status] ?? 9) - (order[b.status] ?? 9);
  if (d !== 0) return d;
  const cmp = (b.created_at ?? "").localeCompare(a.created_at ?? "");
  return a.status === "pending" ? -cmp : cmp;
}

/** Human duration, minute-precise: "42m", "1h 12m". */
export function formatRunDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "<1m";
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * What the row says about WHEN this run ran (console#527): the claim is the start, the
 * completion the end. Null before a claim — a pending run has no times to tell, and the
 * queue's job is to say it is queued. A run's clock starts at the claim, not creation:
 * an hour waiting in the queue is not an hour of training, and quoting creation would
 * quietly charge the queue's time to every short run that waited behind a long one.
 */
export function runTimeLabel(
  job: Pick<TrainingJob, "claimed_at" | "completed_at">,
): string | null {
  if (!job.claimed_at) return null;
  // Date AND time: a page of runs spans weeks, and "2:14 PM" alone named no day.
  if (!job.completed_at) return `started ${dateTimeLabel(job.claimed_at)}`;
  return `${spanLabel(job.claimed_at, job.completed_at)}`
    + ` · ${formatRunDuration(Date.parse(job.completed_at) - Date.parse(job.claimed_at))}`;
}

/** The chip's tooltip: the same times as full timestamps, queue wait included. */
export function runTimeDetail(
  job: Pick<TrainingJob, "created_at" | "claimed_at" | "completed_at">,
): string | null {
  const stamp = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString() : null;
  const parts = [
    job.created_at && `Queued ${stamp(job.created_at)}`,
    job.claimed_at && `Started ${stamp(job.claimed_at)}`,
    job.completed_at && `Finished ${stamp(job.completed_at)}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
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
  character: string, jobs: TrainingJob[], characters: Character[], arch: TrainArch = "ltx",
): number {
  const name = character.trim().toLowerCase();
  if (!name) return 1;
  let highest = 0;
  for (const j of jobs) {
    // PER ARCH (console#612): an SDXL LoRA is a different model, not the next LTX version, so
    // each arch counts its own. And LIVE runs count, not just completed ones -- a version
    // that is training is taken, and offering it was how KimJule's LTX run got "v1 is already
    // running". Failed and cancelled versions stay free to reuse.
    if (j.character.toLowerCase() === name && jobArch(j) === arch
        && ["completed", "pending", "claimed", "running"].includes(j.status)) {
      highest = Math.max(highest, j.version);
    }
  }
  // The character row's LoRA is an LTX one; it says nothing about SDXL versions.
  const c = arch === "ltx" ? characters.find((x) => x.name.toLowerCase() === name) : undefined;
  if (c) highest = Math.max(highest, versionOfLora(c.char_lora ?? "") ?? 0);
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

/**
 * The Training page is a list of CHARACTERS, each with its versions -- not a run history.
 * "It is supposed to be a list of uniquely named/version characters" (console#464). A
 * character's versions sort newest first; within a version the live or most recent run
 * comes first, so a retried v2 shows its current attempt on top of the failed one.
 */
export interface CharacterGroup {
  character: string;
  runs: TrainingJob[];
}

export function groupByCharacter(jobs: TrainingJob[]): CharacterGroup[] {
  const groups = new Map<string, TrainingJob[]>();
  for (const j of jobs) {
    const list = groups.get(j.character) ?? [];
    list.push(j);
    groups.set(j.character, list);
  }
  const out: CharacterGroup[] = [];
  for (const [character, runs] of groups) {
    runs.sort((a, b) => b.version - a.version || byTrainingInterest(a, b));
    out.push({ character, runs });
  }
  // Characters with something live first, then history by most recent activity. Among the
  // queued ones the page owes the reader the queue's real shape (console#526): the trainer
  // claims oldest-pending first, so the pending groups sort that way too — the character
  // training NEXT sits just under the one training now, and adding a job lands it where it
  // belongs, at the bottom. Newest-first here read as every new job cutting to the front.
  const rank = (g: CharacterGroup) =>
    g.runs.some((r) => r.status === "running" || r.status === "claimed") ? 0
      : g.runs.some((r) => r.status === "pending") ? 1
        : 2;
  const activity = (g: CharacterGroup) =>
    Math.max(...g.runs.map((r) => Date.parse(r.claimed_at ?? r.created_at ?? "") || 0));
  const oldestPending = (g: CharacterGroup) =>
    Math.min(...g.runs.filter((r) => r.status === "pending")
      .map((r) => Date.parse(r.created_at ?? "") || 0));
  out.sort((a, b) =>
    rank(a) - rank(b)
    || (rank(a) === 1 ? oldestPending(a) - oldestPending(b) : activity(b) - activity(a)));
  return out;
}

/** One row of a finished run's checkpoint list: what was written, and whether it is here. */
export interface EpochRow {
  label: string;
  step: number | null;
  loss: number | null;
  /** The s3:// URI when it is in the bucket. */
  uri: string | null;
  /** Asked for, not yet uploaded. */
  requested: boolean;
}

/**
 * Merge what the trainer wrote (`epochs`) with what reached the bucket (`checkpoints`).
 * Older runs have no `epochs`; their checkpoints still list, without step or loss.
 *
 * A label in `delete_requests` never lists (console#627). The API drops it from `epochs` and
 * `checkpoints` itself, but the trainer re-reports its epochs on every poll until the files
 * are gone, and a deleted checkpoint coming back with a Copy scp for a file that no longer
 * exists is worse than one that is simply absent.
 */
export function epochRows(
  job: Pick<TrainingJob, "epochs" | "checkpoints" | "publish_requests" | "delete_requests">,
): EpochRow[] {
  const deleted = new Set(job.delete_requests ?? []);
  const byLabel = new Map<string, string>();
  for (const u of job.checkpoints ?? []) {
    const label = checkpointLabel(u);
    if (!deleted.has(label)) byLabel.set(label, u);
  }
  const requested = new Set(job.publish_requests ?? []);
  const rows: EpochRow[] = (job.epochs ?? []).filter((e) => !deleted.has(e.label)).map((e) => ({
    label: e.label, step: e.step, loss: e.loss,
    uri: byLabel.get(e.label) ?? null, requested: requested.has(e.label),
  }));
  const seen = new Set(rows.map((r) => r.label));
  for (const [label, uri] of byLabel) {
    if (!seen.has(label)) rows.push({ label, step: null, loss: null, uri, requested: false });
  }
  const order = (l: string) => (l === "final" ? Number.MAX_SAFE_INTEGER : parseInt(l.slice(1), 10));
  return rows.sort((a, b) => order(a.label) - order(b.label));
}

/**
 * Points for a small loss line: x by step across the run, y by loss within [min, max] of
 * the data (not from zero -- a curve that goes 0.9 -> 0.7 is a flat line on a 0-based axis
 * and the whole point is to see it move). Returns [] with fewer than two points.
 */
export function lossPath(
  log: [number, number][] | null | undefined, width: number, height: number, pad = 4,
): { points: { x: number; y: number; step: number; loss: number }[]; min: number; max: number } {
  const pts = (log ?? []).filter((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[1]));
  if (pts.length < 2) return { points: [], min: 0, max: 0 };
  const steps = pts.map((p) => p[0]);
  const losses = pts.map((p) => p[1]);
  const x0 = Math.min(...steps), x1 = Math.max(...steps);
  let min = Math.min(...losses), max = Math.max(...losses);
  if (max === min) { max = min + 0.01; }
  const sx = (v: number) => pad + ((v - x0) / Math.max(1, x1 - x0)) * (width - 2 * pad);
  const sy = (v: number) => height - pad - ((v - min) / (max - min)) * (height - 2 * pad);
  return { points: pts.map((p) => ({ x: sx(p[0]), y: sy(p[1]), step: p[0], loss: p[1] })), min, max };
}

/** The recipe's `num_repeats`: every image is seen this many times per epoch. */
export const NUM_REPEATS = 10;
/** The recipe's proven step count. Strong at 750-1000, brittle well past 1200. */
export const RECIPE_STEPS = 1200;
/** Measured on the 3090 for this recipe (100 steps in ~6 min). */
export const SECONDS_PER_STEP = 3.7;

/** Steps in one epoch over this many images at the recipe's repeats: the estimate the dialog
 *  uses until preflight returns the real `samples_per_epoch`. */
export function stepsPerEpoch(images: number, arch: TrainArch = "ltx"): number {
  return Math.max(1, images) * (arch === "sdxl" ? SDXL_REPEATS : NUM_REPEATS);
}

/**
 * Steps for a whole number of epochs, so the last epoch checkpoint is also the final.
 *
 * From a samples-per-epoch rather than an image count (#537). A run is no longer one set at
 * 10 repeats: regularization pools are sized to match the character images, and pairs mix
 * several groups at their own repeats, so only the server's `samples_per_epoch` is the real
 * epoch length. Batch size is 1, so a sample is a step.
 */
export function stepsForSamples(epochs: number, samplesPerEpoch: number): number {
  return Math.max(1, Math.floor(epochs)) * Math.max(1, samplesPerEpoch);
}

/** The recipe's 1200 steps as whole epochs of this length. Never below 1. */
export function defaultEpochsForSamples(samplesPerEpoch: number): number {
  return Math.max(1, Math.round(RECIPE_STEPS / Math.max(1, samplesPerEpoch)));
}

export function estimatedMinutes(steps: number, arch: TrainArch = "ltx"): number {
  return Math.round((steps * (arch === "sdxl" ? SDXL_SECONDS_PER_STEP : SECONDS_PER_STEP)) / 60);
}

// ---- SDXL start-image LoRAs (console#600) ---------------------------------------------------
//
// David makes start images in SDXL (A1111, outside Wanly), and identity comes mostly from the
// start image. The trainer reproduces his hand-made "aio" runs: BigaspV2Lustify, rank 128,
// 8 repeats, 12 epochs, WD14 tags. The recipe is the API's and the trainer's; the console only
// picks the arch and shows what it costs.

export type TrainArch = "ltx" | "sdxl";
/** aio's repeats: one epoch is images x 8. */
export const SDXL_REPEATS = 8;
/** aio's epoch count -- k3lly_aio-2_e12 is the twelfth. */
export const SDXL_EPOCHS = 12;
/** Measured: k3lly_aio-2 ran 6528 steps on 3090a at 1.31 s/step (its TensorBoard log). */
export const SDXL_SECONDS_PER_STEP = 1.31;

/** An SDXL run's checkpoints are for the start-image generator, not the LTX engine -- no
 *  "Use" button, only Download. Reads the job's snapshot, so a row from before console#600
 *  (no `arch`) is LTX, as it was. */
export function isSdxlJob(job: Pick<TrainingJob, "config">): boolean {
  return (job.config as { arch?: unknown } | null)?.arch === "sdxl";
}

// ---- The Train dialog (#537) ---------------------------------------------------------------
//
// What is NOT here, on purpose: the rules. Whether captions are complete, scores clear the
// floor, datasets are owned by the right character, a pair has its composition set, a
// regularization pool exists — all of that is POST /training/preflight's answer, rendered as
// it comes back. A copy of those rules in TypeScript is a second implementation that drifts,
// and a checklist that drifts is worse than none: it says green over a request that 422s.
// What stays client-side is only what needs no data: is the field filled in.

/** A character that has trained has a trigger the LoRA learned; changing it after that binds
 *  the face to nothing, so the API refuses and the UI shows it read-only.
 *
 *  `char_lora` "none" is UNTRAINED, in any casing: the API stores a registered-but-untrained
 *  character that way (the same "off" spelling the daemon filters), and its own trained test is
 *  `trained_from` set or `char_lora != "none"`. Reading "none" as a LoRA name would lock the
 *  trigger of every character the moment it was registered. */
export function characterHasTrained(c: Pick<Character, "char_lora" | "trained_from">): boolean {
  const lora = (c.char_lora ?? "").trim();
  return (Boolean(lora) && lora.toLowerCase() !== "none") || Boolean(c.trained_from?.length);
}

/** Rows without a kind predate pairs, and every one of them is one person. */
export function isPairCharacter(c: Pick<Character, "kind">): boolean {
  return c.kind === "pair";
}

/** "David" + "Kelly-2026" -> "DavidKelly-2026". A default the user can edit — it is what the
 *  existing pair rows are called, and a composition dataset is owned by exactly this name. */
export function defaultPairName(a: string, b: string): string {
  return `${a.trim()}${b.trim()}`;
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase() && Boolean(a?.trim());
}

/** The datasets of this kind owned by this character (or pair). Case-insensitive, because
 *  the owner was typed by a person and "david" owning a set of David is not a mistake worth
 *  hiding the set over — the API makes the same call. */
export function datasetsOwnedBy(
  datasets: Dataset[], kind: DatasetKind, owner: string,
): Dataset[] {
  return datasets.filter((d) => d.kind === kind && sameName(d.character, owner));
}

/** Everything the dialog holds that the request is built from. */
export interface TrainForm {
  mode: "solo" | "pair";
  /** Solo: the character. */
  character: string;
  /** Pair: the two members, and the pair's own name. */
  memberA: string;
  memberB: string;
  pairName: string;
  /** Chosen character dataset per member (solo: keyed by the character). */
  datasets: Record<string, string>;
  compositionId: string | null;
  allowNoComposition: boolean;
  /** "These are verified real photos of her" (console#575): profiles and face-filling selfies
   *  of the real person score low or read as no face, and must not be thrown out for it. */
  allowLowScores: boolean;
  version: number;
  steps: number;
  publish: PublishMode;
  /** The recipe. Defaults are Kelly-2000 v5's, the run that held her best. */
  baseCheckpoint: string;
  regularization: boolean;
  captionMode: "per_image" | "trigger_only";
  /** Which model the LoRA is for (console#600). */
  arch: TrainArch;
}

/**
 * The bases the trainer can train against. Dev first, and the default: Kelly-2000 v1 and v5
 * (the two that held her) trained on it; v2/v3 trained on 10Eros, and whether that swap cost
 * identity has not been measured on its own. Rendering still happens on the render stack's
 * checkpoint either way.
 */
export const BASE_CHECKPOINTS: { value: string; label: string }[] = [
  { value: "ltx-2.3-22b-dev", label: "LTX-2.3 dev (Kelly-2000 v1/v5)" },
  { value: "10Eros_v1.5_bf16", label: "10Eros v1.5 (the render checkpoint)" },
];

/**
 * v5's recipe: dev base, no regularization pool, stored captions (blank = the bare trigger;
 * type only props). Regularization is opt-in because the run that used it (Kelly-2000 v2, with
 * long captions) came out a generic woman, and the pools were deleted after.
 */
export const RECIPE_DEFAULTS: Pick<TrainForm, "baseCheckpoint" | "regularization" | "captionMode" | "arch"> = {
  baseCheckpoint: BASE_CHECKPOINTS[0].value, regularization: false, captionMode: "per_image",
  arch: "ltx",
};

/** Who this run trains as — the row it publishes to. */
export function runCharacter(f: Pick<TrainForm, "mode" | "character" | "pairName">): string {
  return (f.mode === "solo" ? f.character : f.pairName).trim();
}

/**
 * The request body for both /training/preflight and /training. One builder for both, so what
 * was checked is exactly what is sent.
 */
export function trainingBody(f: TrainForm): TrainingCreate {
  // SDXL: none of the LTX recipe knobs -- the base, the captions (WD14, by the trainer) and
  // regularization (none) are the aio recipe's, decided server-side. Solo or pair (#621).
  const recipe = f.arch === "sdxl" ? {
    arch: "sdxl" as const,
    ...(f.allowLowScores ? { allow_low_scores: true } : {}),
  } : {
    caption_mode: f.captionMode, regularization: f.regularization,
    base_checkpoint: f.baseCheckpoint || null,
    // Only when ticked, so a request that never met the question does not carry an answer.
    ...(f.allowLowScores ? { allow_low_scores: true } : {}),
  };
  const pick = (names: string[]) => Object.fromEntries(
    names.filter((n) => f.datasets[n]).map((n) => [n, f.datasets[n]]));
  if (f.mode === "solo") {
    const ds = pick([f.character]);
    return {
      mode: "solo", character: f.character.trim(),
      ...(Object.keys(ds).length ? { datasets: ds } : {}),
      version: f.version, steps: f.steps, publish: f.publish, ...recipe,
    };
  }
  const ds = pick([f.memberA, f.memberB]);
  return {
    mode: "pair", character: f.pairName.trim(),
    members: [f.memberA.trim(), f.memberB.trim()],
    ...(Object.keys(ds).length ? { datasets: ds } : {}),
    composition_dataset_id: f.compositionId,
    // Only with no composition set: acknowledging a risk that is not being taken means
    // nothing, and a stale tick must not ride along into a later run that has one.
    allow_no_composition: !f.compositionId && f.allowNoComposition,
    version: f.version, steps: f.steps, publish: f.publish, ...recipe,
  };
}

/**
 * What is too obviously missing to be worth asking the server about. NOT a validator: a null
 * here means "ask preflight", not "valid".
 */
export function formIncomplete(f: TrainForm): string | null {
  if (f.mode === "solo") return f.character.trim() ? null : "pick a character";
  if (!f.memberA.trim() || !f.memberB.trim()) return "pick both characters";
  if (sameName(f.memberA, f.memberB)) return "a pair is two different characters";
  const name = f.pairName.trim();
  if (!name) return "name the pair";
  return characterProblem(name);
}

/**
 * Where the dialog starts when it is opened from a dataset: a character set opens Solo on its
 * owner, a composition set opens Pair on its pair — with the members filled in when the pair
 * is already a registered row. Anything else opens empty.
 */
export function initialFromDataset(
  ds: Pick<Dataset, "id" | "kind" | "character"> | undefined, characters: Character[],
): Partial<TrainForm> {
  if (!ds?.character) return {};
  if (ds.kind === "character") {
    return { mode: "solo", character: ds.character, datasets: { [ds.character]: ds.id } };
  }
  if (ds.kind === "composition") {
    const pair = characters.find((c) => isPairCharacter(c) && sameName(c.name, ds.character));
    const [a = "", b = ""] = pair?.members ?? [];
    return { mode: "pair", pairName: ds.character, memberA: a, memberB: b, compositionId: ds.id };
  }
  return {};
}

/** The blocking list out of POST /training's 422 `{detail: {problems}}` — the case where the
 *  world changed between the last preflight and the click. Null when it is some other error. */
export function problemsFromError(e: unknown): PreflightItem[] | null {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  const problems = (detail as { problems?: unknown } | null | undefined)?.problems;
  if (!Array.isArray(problems)) return null;
  return problems.filter(
    (p): p is PreflightItem => typeof p?.code === "string" && typeof p?.message === "string");
}

// ---- Time estimates for every run (console#602) ---------------------------------------------
//
// ALL-IN, FROM HISTORY. What a person wants is "when will the LoRA be downloadable", and a run's
// training rate alone undersells that: claim -> completed on 3090a also holds the drain wait,
// latent/text caching and the final upload. Measured over the completed LTX runs it is 3.6-4.6 s
// a step all-in, median ~4.3, where SECONDS_PER_STEP's 3.7 was the bare training rate -- the
// dialog was 20-30% short. And the bare rate itself varies 2.2-3.8 s/it with the dataset's
// image sizes, so a constant is wrong either way. The median of this arch's own recent runs
// tracks both, and corrects itself as runs land.
//
// The constants below are the FALLBACK, for an arch with too little history (SDXL, at first).
//
// What it cannot know: how long the render in progress takes to finish before the drain lands.
// Hence "≈".

/** How many recent completed runs of an arch the median is taken over. */
export const ETA_HISTORY = 10;
/** Fewer completed runs than this and the history is not trusted; the fallback applies. */
export const ETA_MIN_HISTORY = 3;
/** All-in LTX seconds per step when there is no history: the measured median. */
export const LTX_ALL_IN_SECONDS_PER_STEP = 4.3;
/** Minutes per uploaded checkpoint, measured: 650 MB LTX ~18 min on 3090a's uplink; SDXL's
 *  fp16 rank-128 file is ~0.9 GB. */
export const UPLOAD_MINUTES: Record<TrainArch, number> = { ltx: 18, sdxl: 25 };
/** SDXL with no history: tagging and model load before step 1. */
export const SDXL_OVERHEAD_MINUTES = 3;

export function jobArch(job: Pick<TrainingJob, "config">): TrainArch {
  return isSdxlJob(job) ? "sdxl" : "ltx";
}

/**
 * The median all-in seconds per step over this arch's most recent completed runs, or null
 * when there are fewer than ETA_MIN_HISTORY. A run more than twice the median is dropped
 * first: one that sat drained behind a long render (Me v2, 25 s/step) is not what a step costs.
 */
export function allInSecondsPerStep(
  arch: TrainArch,
  jobs: Pick<TrainingJob, "config" | "status" | "claimed_at" | "completed_at" | "total_steps">[],
): number | null {
  const rates = jobs
    .filter((j) => j.status === "completed" && jobArch(j) === arch
      && j.claimed_at && j.completed_at && j.total_steps)
    .sort((a, b) => Date.parse(b.completed_at!) - Date.parse(a.completed_at!))
    .slice(0, ETA_HISTORY)
    .map((j) => (Date.parse(j.completed_at!) - Date.parse(j.claimed_at!)) / 1000 / j.total_steps!)
    .filter((r) => r > 0);
  if (rates.length < ETA_MIN_HISTORY) return null;
  const med = median(rates);
  const kept = rates.filter((r) => r <= 2 * med);
  return median(kept.length ? kept : rates);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The upload mode a run was queued with. A run from before console#627 has "final" or "all";
 *  one with no `publish` at all predates the choice and uploaded its final. */
export function jobPublish(job: Pick<TrainingJob, "config">): PublishMode {
  const p = (job.config as { publish?: string }).publish;
  return p === "none" || p === "all" ? p : "final";
}

/** Uploads that land after training ends: the final's, and under "all" the last epoch's too
 *  (the earlier epochs go up while the next one trains). "none" uploads nothing on its own. */
function trailingUploads(publish: PublishMode): number {
  return publish === "all" ? 2 : publish === "final" ? 1 : 0;
}

/**
 * Minutes for a whole run of `steps`, claim to downloadable -- or, under "none", to the last
 * checkpoint written: nothing is downloadable until it is asked for.
 *
 * The all-in rates (history and the LTX constant) already carry the final's upload, the mode
 * every run used before console#627, so they are adjusted by the uploads this mode adds or
 * drops relative to it. "none" history runs make the history rate slightly pessimistic for
 * the others, never by more than one upload spread over the run.
 */
export function estimateRunMinutes(
  arch: TrainArch, steps: number, publish: PublishMode, history: Parameters<typeof allInSecondsPerStep>[1],
): number {
  const extra = (trailingUploads(publish) - 1) * UPLOAD_MINUTES[arch];
  const rate = allInSecondsPerStep(arch, history);
  // max(1, ...): an "all-in" rate from a short run can carry less than one upload's minutes.
  if (rate !== null) return Math.max(1, Math.round((steps * rate) / 60 + extra));
  const train = (steps * (arch === "sdxl" ? SDXL_SECONDS_PER_STEP : LTX_ALL_IN_SECONDS_PER_STEP)) / 60;
  // The LTX constant is already all-in; SDXL's is the bare training rate, measured.
  const overhead = arch === "sdxl" ? SDXL_OVERHEAD_MINUTES + UPLOAD_MINUTES.sdxl : 0;
  return Math.max(1, Math.round(train + overhead + extra));
}

/** The trainer's own rate, off its progress line ("step 34/1536 (2%), 1.35s/it, ..."). */
export function liveSecondsPerIt(progress: string | null | undefined): number | null {
  const m = /([\d.]+)s\/it/.exec(progress ?? "");
  const v = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Minutes until this run is downloadable (under "none": done training), or null when it is
 * not live.
 *
 * Training: steps left x the live rate, then the final upload -- none under "none". Before
 * the first step (staging, draining, caching): the whole-run estimate less what has elapsed
 * since the claim, never below the upload still to come.
 */
export function remainingMinutes(
  job: TrainingJob, history: TrainingJob[], now: number,
): number | null {
  const arch = jobArch(job);
  const publish = jobPublish(job);
  // The live rate is the bare training rate, so this is the full upload, not a delta.
  const upload = publish === "none" ? 0 : UPLOAD_MINUTES[arch];
  const steps = job.total_steps ?? Number((job.config as { steps?: number }).steps ?? 0);
  if (job.status === "pending") return estimateRunMinutes(arch, steps, publish, history);
  if (job.status !== "claimed" && job.status !== "running") return null;
  const live = liveSecondsPerIt(job.progress_log);
  if (job.step && live && job.total_steps) {
    return Math.round(((job.total_steps - job.step) * live) / 60 + upload);
  }
  const whole = estimateRunMinutes(arch, steps, publish, history);
  const elapsed = job.claimed_at ? (now - Date.parse(job.claimed_at)) / 60000 : 0;
  return Math.round(Math.max(upload, whole - elapsed));
}

export interface RunEta {
  /** When it starts; null for a run that already has. */
  startsAt: number | null;
  doneAt: number;
  minutesLeft: number;
}

/**
 * An ETA for every live run, from the queue as a whole. ONE trainer, first in first out (the
 * claim orders by created_at), so a queued run starts when everything ahead of it is done.
 */
export function queueEtas(jobs: TrainingJob[], now: number): Map<string, RunEta> {
  const out = new Map<string, RunEta>();
  let free = now;
  for (const j of jobs.filter((x) => x.status === "claimed" || x.status === "running")) {
    const left = remainingMinutes(j, jobs, now) ?? 0;
    out.set(j.id, { startsAt: null, doneAt: now + left * 60000, minutesLeft: left });
    free = Math.max(free, now + left * 60000);
  }
  const pending = jobs.filter((x) => x.status === "pending")
    .sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? ""));
  for (const j of pending) {
    const run = remainingMinutes(j, jobs, now) ?? 0;
    const doneAt = free + run * 60000;
    out.set(j.id, { startsAt: free, doneAt, minutesLeft: Math.round((doneAt - now) / 60000) });
    free = doneAt;
  }
  return out;
}

/** "1 h 25 min" / "35 min". */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/** The one line a live run shows: "≈ 35 min left · done ~6:40 PM", and for a queued run
 *  "starts ~6:40 PM · done ~8:10 PM". */
export function etaLabel(eta: RunEta | undefined): string | null {
  if (!eta) return null;
  // Today: just the time. Another day (a long queue): the date too.
  const t = (ms: number) => (sameDay(ms, Date.now()) ? timeLabel(ms) : dateTimeLabel(ms));
  return eta.startsAt !== null
    ? `≈ starts ~${t(eta.startsAt)} · done ~${t(eta.doneAt)} (${formatMinutes(eta.minutesLeft)})`
    : `≈ ${formatMinutes(eta.minutesLeft)} left · done ~${t(eta.doneAt)}`;
}

// ---- Copy a checkpoint as an scp command (console#604, #606) -------------------------------
//
// Pulling a LoRA onto 3090b, where A1111 runs, over ZeroTier. scp straight from the trainer
// box's run directory: every epoch is there the moment it is written, so this works for epochs
// that were never uploaded, with no S3 round trip and nothing that expires. (An S3 curl came
// first; David wanted a plain scp.)

/** Where the trainer box keeps run directories on the HOST: LORA_RUNS_DIR in its worker.env,
 *  mounted into the container as /loras. */
export const TRAINER_RUNS_DIR = "/home/david/projects/loras";
/** The trainer when a run does not say which box it was (every run so far is 3090a's). */
export const DEFAULT_TRAINER_HOST = "3090a.zero";

/** Single-quote for a POSIX shell, only when it needs it. */
export function shq(s: string): string {
  return /^[A-Za-z0-9._@%+=:,/-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The file a label names in the run's output directory, exactly as the trainer writes it:
 * `<character>_v<N>-0000NN` per epoch, no number for the final. LTX's is the `.comfy` variant
 * -- the one the engine loads; the plain twin beside it is musubi's own format.
 */
export function trainerCheckpointPath(
  job: Pick<TrainingJob, "config" | "character" | "version">, label: string,
): string {
  const sdxl = isSdxlJob(job);
  const m = /^e(\d+)$/.exec(label);
  const stem = `${job.character}_v${job.version}` + (m ? `-${m[1].padStart(6, "0")}` : "");
  const dir = `${TRAINER_RUNS_DIR}/${job.character}/${sdxl ? "sdxl" : "ltx23b"}-v${job.version}/output`;
  return `${dir}/${stem}${sdxl ? "" : ".comfy"}.safetensors`;
}

/**
 * The command a checkpoint row copies (console#610): one plain pattern for every run, into the
 * directory it is pasted in --
 *
 *     scp 3090a.zero:/home/david/projects/loras/Joana/sdxl-v2/output/Joana_v2.safetensors Joana_sdxl_v2_final.safetensors
 *
 * Renamed on arrival so the arch and epoch label are in the name: the trainer's own names
 * (Joana_v2-000003) carry neither.
 */
export function scpCommand(
  job: Pick<TrainingJob, "config" | "character" | "version" | "worker_name"
    | "thumbnail_uri" | "dataset_images">,
  label: string,
): string {
  const host = job.worker_name || DEFAULT_TRAINER_HOST;
  const arch = isSdxlJob(job) ? "_sdxl" : "";
  const dest = `${job.character}${arch}_v${job.version}_${label}`;
  const lora = `scp ${host}:${shq(trainerCheckpointPath(job, label))} ${shq(`${dest}.safetensors`)}`;
  // THE PREVIEW TOO (#610): A1111 and StabilityMatrix show <name>.preview.<ext> beside a LoRA
  // as its card image. The run's thumbnail -- the dataset's anchor face -- is already on the
  // trainer, staged with the rest.
  const thumb = trainerThumbnailPath(job);
  if (!thumb) return lora;
  return `${lora} && scp ${host}:${shq(thumb.path)} ${shq(`${dest}.preview${thumb.ext}`)}`;
}

/**
 * Where the run's thumbnail sits on the trainer, or null when it is not one of group 0's
 * images. The trainer stages group 0's images in order as data/sel_NNN<ext>, ext lowercased
 * from the file name, so the anchor's index in dataset_images names its file. (Checked on
 * Joana v2: its anchor is index 3, and data/sel_003.jpg is byte-identical to it in S3.)
 */
export function trainerThumbnailPath(
  job: Pick<TrainingJob, "config" | "character" | "version" | "thumbnail_uri" | "dataset_images">,
): { path: string; ext: string } | null {
  const i = job.thumbnail_uri ? job.dataset_images.indexOf(job.thumbnail_uri) : -1;
  if (i < 0) return null;
  const m = /(\.[^./]+)$/.exec(job.thumbnail_uri!);
  const ext = (m ? m[1] : ".jpg").toLowerCase();
  const run = trainerCheckpointPath(job, "final").replace(/\/output\/[^/]+$/, "");
  return { path: `${run}/data/sel_${String(i).padStart(3, "0")}${ext}`, ext };
}

/**
 * The trigger word(s) a run trained under, as a prompt should type them (console#608): the
 * job's own snapshot, not the registry's current value -- a re-registered trigger does not
 * change what this file learned. A pair lists each identity group's trigger (composition and
 * regularization groups have none), deduplicated, in group order.
 */
export function runTriggers(job: Pick<TrainingJob, "trigger" | "identities">): string[] {
  const all = [job.trigger, ...(job.identities ?? []).map((g) => g.trigger)];
  return [...new Set(all.filter((t): t is string => Boolean(t && t.trim())))];
}

/**
 * The triggers joined the way the run's captions joined them, so the badge shows -- and copies
 * -- what to type (console#629). An SDXL run trained on booru tags, a pair's both-in-frame
 * images as "d@vid, jo@na, 1boy, 1girl", so "and" was never in a caption and is a stray word
 * in an A1111 prompt. An LTX pair's composition captions read "d@vid, man and k3lly2026,
 * woman": there " and " is the trained form.
 */
export function runTriggerPhrase(
  job: Pick<TrainingJob, "trigger" | "identities" | "config">,
): string {
  return runTriggers(job).join(isSdxlJob(job) ? ", " : " and ");
}
