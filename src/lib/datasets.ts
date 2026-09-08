/**
 * Dataset logic worth testing (wanly-api#277).
 *
 * Extracted for the reason vite.config.ts gives — tests here are node-env and pure-logic only,
 * so a rule with a right answer has to live outside a component to be covered.
 */
import type { Dataset } from "../api/types";

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

/** The S3 prefix the API will use. Shown so the folder name is not a surprise later. */
export function datasetPrefix(name: string): string {
  return "dataset-" + name.trim().toLowerCase().replace(/ /g, "-");
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
