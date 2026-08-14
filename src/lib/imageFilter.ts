/**
 * The image-repo filter: a filename fragment and a set of whole tags, all ANDed.
 *
 * Two controls with two different jobs. Tags match in full — measured on production, a substring
 * search for "kelly" returned 74% of the repo because it also caught KellyYoung, KellyBangs and
 * KellyTeacher — while the text box matches the filename as a fragment, which is right there and
 * is the only way to find an untagged image.
 *
 * The selection lives in the URL (?tags=Kelly,Missionary) like the rest of this page's browsing
 * state, so back/forward and a refresh keep it, and a filtered view can be pasted to yourself.
 */

/** Tags are comma-joined in the URL. Empty segments are dropped rather than sent as blank tags,
 *  which the API would reject as a filter that filters nothing. */
export function parseTagParam(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const tag = part.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Back to a URL value, or null to drop the param entirely when nothing is selected. */
export function serializeTagParam(tags: string[]): string | null {
  const cleaned = tags.map((t) => t.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(",") : null;
}

/** Add or remove one tag, comparing case-insensitively so a pill cannot be selected twice under
 *  two spellings. */
export function toggleTag(tags: string[], tag: string): string[] {
  const key = tag.toLowerCase();
  return tags.some((t) => t.toLowerCase() === key)
    ? tags.filter((t) => t.toLowerCase() !== key)
    : [...tags, tag];
}

export function isTagSelected(tags: string[], tag: string): boolean {
  const key = tag.toLowerCase();
  return tags.some((t) => t.toLowerCase() === key);
}

/** Is anything filtering? Drives whether the page shows results or the folder listing. */
export function hasFilter(q: string, tags: string[]): boolean {
  return q.trim().length > 0 || tags.length > 0;
}

/** How to name the current filter in an empty state, so "no results" says what found nothing. */
export function describeFilter(q: string, tags: string[]): string {
  const parts = [...tags];
  if (q.trim()) parts.push(`"${q.trim()}"`);
  return parts.join(" + ");
}
