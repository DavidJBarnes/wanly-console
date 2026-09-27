/**
 * Dataset logic worth testing (wanly-api#277).
 *
 * Extracted for the reason vite.config.ts gives — tests here are node-env and pure-logic only,
 * so a rule with a right answer has to live outside a component to be covered.
 */
import type { CaptionStatus, Dataset, RegularizeStatus } from "../api/types";

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
