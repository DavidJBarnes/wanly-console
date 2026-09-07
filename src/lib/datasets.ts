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
