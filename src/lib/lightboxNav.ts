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
