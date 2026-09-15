/**
 * Which arm of the Add-from-Repo dialog is showing, and the paging clamp (console#506).
 *
 * Extracted for the reason vite.config.ts gives — tests here are node-env and pure-logic only,
 * so a rule with a right answer has to live outside the component to be covered.
 */

export type RepoBrowseMode = "folders" | "folder" | "search";

/**
 * One dialog, three views, and which one wins is not obvious from the render tree: an open
 * folder beats an active filter (you clicked into it on purpose), and a filter with no folder
 * open replaces the folder listing rather than sitting above it.
 */
export function repoBrowseMode(folderOpen: boolean, filterActive: boolean): RepoBrowseMode {
  if (folderOpen) return "folder";
  return filterActive ? "search" : "folders";
}

/** 0-based page count, always at least one so an empty result set is still "page 1 of 1". */
export function pageCount(total: number, perPage: number): number {
  if (perPage <= 0) return 1;
  return Math.max(1, Math.ceil(total / perPage));
}

/**
 * Pull a page index back inside the range a shrunken result set actually has.
 *
 * A tag click narrows the results and the page can be left past the end — clamp rather than
 * strand the user on an empty page they cannot page away from.
 */
export function clampPage(page: number, total: number, perPage: number): number {
  const max = pageCount(total, perPage) - 1;
  if (page < 0) return 0;
  return page > max ? max : page;
}
