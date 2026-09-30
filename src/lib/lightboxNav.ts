/**
 * Stepping through a pool of images in the lightbox (console#522).
 *
 * The lightbox used to hold a single image with no reference to the grid it was
 * opened from; these are the rules for being able to say "next" and "previous".
 */

export type LightboxNav = { index: number; total: number };

interface Stamped {
  path: string;
  last_modified: string;
}

/**
 * The folder grid's browse order, as a copy: newest-first (or oldest-first)
 * by `last_modified`. Shared by the grid's page slice and the lightbox pool so
 * "next image" means the next card the user can see — same order, not a sort
 * that happens to agree today.
 */
export function orderForBrowse<T extends Stamped>(images: T[], sortDesc: boolean): T[] {
  return [...images].sort((a, b) => {
    const cmp = a.last_modified.localeCompare(b.last_modified);
    return sortDesc ? -cmp : cmp;
  });
}

/**
 * The index after stepping `dir` (-1 back, +1 forward) through a pool of `total`.
 *
 * Clamps rather than wraps: at the ends the arrows disappear, and silently
 * teleporting from the last image to the first in a 96-image grid is not what
 * a stray Right-press should do. Returns `from` for an empty pool or a zero
 * step, so callers can trust an index in [0, total).
 */
export function stepIndex(from: number, total: number, dir: -1 | 1): number {
  if (total <= 0) return from;
  const next = from + dir;
  if (next < 0 || next >= total) return from;
  return next;
}

/**
 * Where `image` sits in the currently visible pool, as {index, total}.
 * Matched by `path`, not identity: tag saves and descriptions replace the image
 * object inside the pool's source array, and the lightbox must still know where
 * it is. `null` when the image isn't in the pool at all (deleted, or filtered
 * away) — navigation is then unavailable rather than wrong.
 */
export function lightboxNav<T extends { path: string }>(image: T | null, pool: T[]): LightboxNav | null {
  if (!image) return null;
  const index = pool.findIndex((item) => item.path === image.path);
  if (index === -1) return null;
  return { index, total: pool.length };
}

/**
 * Where the lightbox can step to from `image`, as pool indices (console#560).
 *
 * `index` is the image's own position, or null when it has LEFT the pool while on screen:
 * tagged out of the Untagged view (the whole point of that view), or unfavourited out of
 * Favourites. Its neighbours close the gap, so the image that now sits at `lastIndex` —
 * where it was last seen — is the next one, and the one before that is the previous one.
 * Navigating from where you were beats the arrows vanishing, which is what `lightboxNav`
 * alone did, and why the Untagged view "had no arrows": the first tag took the image out
 * of the pool.
 *
 * `lastIndex` is only trusted for a detached image; pass null when there is none. Null
 * overall when there is nowhere to go and nothing to say (closed, or detached with no
 * memory of where it was).
 */
export type LightboxSteps = {
  index: number | null;
  total: number;
  prev: number | null;
  next: number | null;
};

export function lightboxSteps<T extends { path: string }>(
  image: T | null,
  pool: T[],
  lastIndex: number | null,
): LightboxSteps | null {
  if (!image) return null;
  const total = pool.length;
  const index = pool.findIndex((item) => item.path === image.path);
  if (index !== -1) {
    return {
      index,
      total,
      prev: index > 0 ? index - 1 : null,
      next: index < total - 1 ? index + 1 : null,
    };
  }
  if (lastIndex === null || total === 0) return null;
  const at = Math.min(Math.max(lastIndex, 0), total);
  return { index: null, total, prev: at > 0 ? at - 1 : null, next: at < total ? at : null };
}

/**
 * What the lightbox shows after the image on screen is deleted (console#560): the NEXT
 * image, or the previous one when it was the last, or null — close — when none are left.
 *
 * Taken from the pool as it was BEFORE the delete, so "next" means the image the person
 * would have reached with →, not whatever a refetch happens to put there. A deleted image
 * that had already left the pool (tagged out of Untagged, then deleted) is found by
 * `lastIndex`, the same memory `lightboxSteps` uses.
 */
export function successorAfterDelete<T extends { path: string }>(
  pool: T[],
  deletedPath: string,
  lastIndex: number | null,
): T | null {
  const index = pool.findIndex((item) => item.path === deletedPath);
  const rest = index === -1 ? pool : pool.filter((item) => item.path !== deletedPath);
  if (rest.length === 0) return null;
  const at = index !== -1 ? index : lastIndex;
  if (at === null) return null;
  return rest[Math.min(Math.max(at, 0), rest.length - 1)];
}

/**
 * The array the lightbox steps through: whichever grid is on screen.
 * Precedence mirrors ImageRepo's render gates — a filter shows search results
 * wherever it was typed; then the toggles; otherwise the open folder.
 */
export function poolForView<T>(view: {
  filterActive: boolean;
  favoritesView: boolean;
  untaggedView: boolean;
  search: T[];
  favorites: T[];
  untagged: T[];
  folder: T[];
}): T[] {
  if (view.filterActive) return view.search;
  if (view.favoritesView) return view.favorites;
  if (view.untaggedView) return view.untagged;
  return view.folder;
}

/** True when an ArrowLeft/ArrowRight press should be left to the focused element. */
export function isTypingTarget(target: unknown): boolean {
  // Duck-typed, not `instanceof HTMLElement`: the console's tests run in node
  // (vite.config.ts), and the DOM convention here is pure logic, not jsdom.
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable === true;
}
