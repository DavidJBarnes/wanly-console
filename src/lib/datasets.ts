/**
 * Dataset logic worth testing (wanly-api#277).
 *
 * Extracted for the reason vite.config.ts gives — tests here are node-env and pure-logic only,
 * so a rule with a right answer has to live outside a component to be covered.
 */
import type { CaptionStatus, Dataset, DatasetTrainedBy, RegularizeStatus } from "../api/types";

/**
 * Whether a dataset item is a video clip (wanly-console#625).
 *
 * There is no separate field: a clip sits in `Dataset.images` beside the stills, keyed by URI
 * like everything else, and the API normalizes every uploaded video to `.mp4`. So the
 * extension IS the type — the same rule the API and the trainer use.
 */
export function isClip(uri: string): boolean {
  return /\.mp4$/i.test(uri);
}

/** A set's stills and clips, each in the set's own order. */
export function splitClips(images: string[]): { stills: string[]; clips: string[] } {
  const stills: string[] = [];
  const clips: string[] = [];
  for (const u of images) (isClip(u) ? clips : stills).push(u);
  return { stills, clips };
}

/** "12 images", or "12 images · 3 clips" once the set holds any clips. */
export function itemCountLabel(images: string[]): string {
  const { stills, clips } = splitClips(images);
  return clips.length
    ? `${stills.length} images · ${clips.length} ${clips.length === 1 ? "clip" : "clips"}`
    : `${stills.length} images`;
}

/** Tags are a comma-separated string, matching ImageFile.tags rather than a second convention. */
export function parseTags(tags: string | null | undefined): string[] {
  return (tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Same character class the API enforces. Kept in step so the dialog cannot offer a name the
 *  API will reject — the name becomes part of every image's S3 key, forever. */
const NAME_RE = /^[A-Za-z0-9 _.@-]+$/;

export function datasetNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return "a name is required";
  if (n.length > 100) return "keep it under 100 characters";
  if (!NAME_RE.test(n)) return "letters, numbers, spaces, and . _ - @ only";
  return null;
}

/** Newest activity first — a dataset you just uploaded into is the one you are working on. */
export function byRecent(a: Dataset, b: Dataset): number {
  return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
}

/**
 * Remove one image from a set, returning the list to PATCH back.
 *
 * The API replaces `images` wholesale, so removal is "send the list without it" — which means
 * the caller has to get the list right. Here rather than in the component so the rules below
 * are actually covered.
 *
 * IDENTITY IS THE URI, not the index. The grid is rendered from a filtered or sliced view as
 * often as not, so an index into what is on screen is not an index into `ds.images`.
 */
export function withoutImage(images: string[], uri: string): string[] {
  return images.filter((u) => u !== uri);
}

/**
 * Whether removing one more would take the set below what training accepts.
 *
 * Removal is still allowed — a set of the wrong person is worse than a small one, and the
 * intended flow is crop-every-face then cull. But the button should say what it costs, because
 * the alternative is a 422 at train time with no hint of which step caused it.
 */
export const MIN_TRAINABLE = 8;

export function removalWarning(count: number): string | null {
  if (count <= MIN_TRAINABLE) {
    return `Removing another leaves ${count - 1}; training needs at least ${MIN_TRAINABLE}.`;
  }
  return null;
}

/**
 * Merge repo images into a set, returning the list to PATCH back.
 *
 * Appending to the set's own order — the trainer stages them in this order, and the captions
 * pair against it, so a merge must not shuffle what is already there. Duplicates are dropped:
 * an image already in the set gains nothing by being added twice, and training refuses
 * duplicates outright.
 */
export function mergeIntoSet(images: string[], uris: string[]): string[] {
  const have = new Set(images);
  const out = [...images];
  for (const u of uris) {
    if (!have.has(u)) {
      have.add(u);
      out.push(u);
    }
  }
  return out;
}

/** What stands between a selection and a crop, or null if none does. */
export function cropSelectionProblem(selected: Set<string>): string | null {
  if (selected.size === 0) return "pick at least one image";
  return null;
}

/** buffalo_l's same-person floor. Shown as a line to read against, never used to delete. */
export const COS_FLOOR = 0.4;

export type ScoreVerdict = "anchor" | "match" | "below" | "no-face" | "unscored";

/**
 * How to label one image's likeness to the anchor.
 *
 * `null` cos is an ABSENT score, not a low one — the detector found no face. Rendering that as
 * the worst match in the set would send you to delete a photo whose only problem is that the
 * face is turned away, and it reads identically to "this is a different person".
 */
export function verdictFor(
  score: { cos: number | null; is_anchor: boolean } | undefined,
  floor = COS_FLOOR,
): ScoreVerdict {
  if (!score) return "unscored";
  if (score.is_anchor) return "anchor";
  if (score.cos === null) return "no-face";
  return score.cos >= floor ? "match" : "below";
}

/** Two decimals is the resolution the decision is made at; more digits imply precision the
 *  0.4 floor does not have. */
export function formatCos(cos: number | null): string {
  return cos === null ? "no face" : cos.toFixed(2);
}

/**
 * Worst first, so a cull starts where the answer is obvious.
 *
 * The anchor sorts last — it always scores 1.0 against itself, and floating it to the top on
 * that basis would put the one image you must not delete under the delete button. Images with
 * no face sort with the worst, because they are the other thing worth looking at, but they are
 * distinguishable by their label.
 */
export function byLikeness<T extends { cos: number | null; is_anchor: boolean }>(
  a: T, b: T,
): number {
  if (a.is_anchor !== b.is_anchor) return a.is_anchor ? 1 : -1;
  const av = a.cos ?? -1;
  const bv = b.cos ?? -1;
  return av - bv;
}

/**
 * One image's score for the ring (#537): a score from the scoring just done on this page wins,
 * then the one the API saved with the set, then nothing. Before the API kept scores the ring
 * was grey after every reload, so "was this set ever checked" had no answer on the page.
 */
export function scoreFor(
  ds: Pick<Dataset, "anchor_uri" | "scores">,
  uri: string,
  fresh: Record<string, { cos: number | null; is_anchor: boolean }>,
): { cos: number | null; is_anchor: boolean } | undefined {
  if (fresh[uri]) return fresh[uri];
  if (uri === ds.anchor_uri) return { cos: 1, is_anchor: true };
  const saved = ds.scores ?? {};
  if (uri in saved) return { cos: saved[uri] ?? null, is_anchor: false };
  return undefined;
}

/** How many of the set's images have a caption body. An empty string is not a caption. */
export function captionCoverage(ds: Pick<Dataset, "images" | "captions">): {
  captioned: number; missing: number;
} {
  const caps = ds.captions ?? {};
  const captioned = ds.images.filter((u) => (caps[u] ?? "").trim() !== "").length;
  return { captioned, missing: ds.images.length - captioned };
}

/** "Captioning 12 of 40", or the failure, or null when there is nothing to report. */
export function captionProgressLabel(s: CaptionStatus | null): string | null {
  if (!s) return null;
  if (s.error) return `captioning stopped: ${s.error}`;
  if (s.running) return `captioning ${s.captioned} of ${s.total}`;
  return null;
}

/** "Rendering 12 of 150 (1 failed)", or null when nothing is running. Failures are said
 *  even so: a pool that stops at 140 should not look like it stopped at 150. */
export function regularizeProgressLabel(s: RegularizeStatus | null): string | null {
  if (!s || !s.running) return null;
  return `rendering ${s.done} of ${s.requested}` + (s.failed ? ` (${s.failed} failed)` : "");
}

/** 0-100 for a determinate bar, or null when the total is not known yet. */
export function progressPct(done: number, total: number): number | null {
  if (!total) return null;
  return Math.min(100, Math.round((100 * done) / total));
}

/** The owner line a card shows, or null for an unassigned set. */
export function ownerLabel(ds: Pick<Dataset, "kind" | "character" | "reg_class">): string | null {
  switch (ds.kind) {
    case "character": return ds.character ? `Character · ${ds.character}` : "Character · no owner";
    case "composition": return ds.character ? `Pair · ${ds.character}` : "Pair · no owner";
    case "regularization": return `Regularization · ${ds.reg_class ?? "no class"}`;
    default: return null;
  }
}

/** Whether the kind has everything it needs to be trainable at all. The API is the judge of
 *  the rest; this only decides whether the card calls it unassigned. */
export function isAssigned(ds: Pick<Dataset, "kind" | "character" | "reg_class">): boolean {
  if (ds.kind === "regularization") return Boolean(ds.reg_class);
  if (ds.kind === "character" || ds.kind === "composition") return Boolean(ds.character?.trim());
  return false;
}

/**
 * One run that trained on a set or an image: "Kelly-2000 v5 (completed)", with " SDXL" for an
 * SDXL run — versions are numbered per arch (wanly-api#402), so "v1" alone is ambiguous.
 */
export function trainedByLabel(
  t: Pick<DatasetTrainedBy, "character" | "version" | "status"> & { arch?: string | null },
): string {
  return `${t.character} v${t.version}${t.arch === "sdxl" ? " SDXL" : ""} (${t.status})`;
}

/**
 * The "trained" chip (wanly-api#419): which runs a set fed. INFORMATION, not a lock — a set
 * stays the subject's living set after it trains, and each run keeps its own record of what
 * it trained on (Training page → Trained on). Null when nothing trained on it.
 */
export function trainedLabel(ds: Pick<Dataset, "trained_by">): string | null {
  const runs = ds.trained_by ?? [];
  if (!runs.length) return null;
  return `Trained ${runs.map(trainedByLabel).join(", ")}`;
}

/**
 * An image's "used in" badge (wanly-api#422): "v1, v3" — or "Joana v1 · Me v2 SDXL" when the
 * runs are not all one character's. Null for an image no run trained on.
 */
export function usedInLabel(
  runs: ReadonlyArray<Pick<DatasetTrainedBy, "character" | "version"> & { arch?: string | null }>
    | undefined,
): string | null {
  if (!runs?.length) return null;
  const groups = new Map<string, number[]>();
  for (const r of runs) {
    const key = `${r.character}\u0000${r.arch === "sdxl" ? " SDXL" : ""}`;
    const vs = groups.get(key) ?? [];
    if (!vs.includes(r.version)) vs.push(r.version);
    groups.set(key, vs);
  }
  const oneCharacter = new Set(runs.map((r) => r.character)).size === 1;
  return [...groups.entries()].map(([key, vs]) => {
    const [character, arch] = key.split("\u0000");
    const versions = vs.sort((a, b) => a - b).map((v) => `v${v}`).join(", ");
    return `${oneCharacter ? "" : `${character} `}${versions}${arch}`;
  }).join(" · ");
}

type LockFacts = Pick<Dataset, "locked" | "locked_at" | "locked_reason" | "archived_at">;

/** The hand-lock text (wanly-api#358), or null when it was never locked by hand. */
export function manualLockLabel(ds: Pick<Dataset, "locked_at" | "locked_reason">): string | null {
  if (!ds.locked_at) return null;
  const reason = ds.locked_reason?.trim();
  return reason ? `Locked by hand: ${reason}` : "Locked by hand";
}

/**
 * The lock chip's text, or null when the set is editable. Training locks nothing any more
 * (wanly-api#420): only a hand lock — optional — or archiving makes a set read-only.
 */
export function lockLabel(ds: LockFacts): string | null {
  if (ds.archived_at) return "Archived";
  return manualLockLabel(ds) ?? (ds.locked ? "Locked" : null);
}

/**
 * Why an edit control is off, or null when the set is editable. One sentence, the same the
 * API's 409 says: what makes it read-only, and the way back.
 */
export function lockedReason(ds: LockFacts): string | null {
  if (!ds.locked && !ds.archived_at) return null;
  if (ds.archived_at) {
    return "Archived: this version set was folded into its subject's living set. Unarchive it to change it.";
  }
  const reason = ds.locked_reason?.trim();
  return `Locked by hand${reason ? ` (“${reason}”)` : ""}. Unlock it to change it.`;
}

/** Whether to offer the Lock button: an editable, unarchived set. */
export function canLockByHand(ds: Pick<Dataset, "locked" | "archived_at">): boolean {
  return !ds.locked && !ds.archived_at;
}

/** Whether to offer the Unlock button: only on a hand-locked set. */
export function canUnlock(ds: Pick<Dataset, "locked_at" | "archived_at">): boolean {
  return Boolean(ds.locked_at) && !ds.archived_at;
}

/** A timestamp's LOCAL calendar date as YYYY-MM-DD — the same in every locale. */
export function localDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The "unlocked <date>" chip (wanly-api#363), or null. Only while the set is still unlocked:
 * once it is locked by hand again, the lock chip says so and this would only confuse it.
 */
export function unlockedLabel(ds: Pick<Dataset, "locked" | "unlocked_at">): string | null {
  if (ds.locked || !ds.unlocked_at) return null;
  return `Unlocked ${localDate(ds.unlocked_at)}`;
}

/** The body POST /datasets/{id}/lock is sent: the reason trimmed, and left out when blank so
 *  the chip does not end in an empty "Locked by hand: ". */
export function lockReasonBody(reason: string): string | undefined {
  const r = reason.trim();
  return r ? r : undefined;
}

/** The name the Clone prompt starts with — "<name> copy", cut to the API's 100-character
 *  limit so the default is never one the API rejects. */
export function defaultCloneName(name: string): string {
  const suffix = " copy";
  return name.trim().slice(0, 100 - suffix.length).trimEnd() + suffix;
}
