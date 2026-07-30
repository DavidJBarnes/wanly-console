import { useCallback } from "react";
import { useSearchParams } from "react-router";

export type QueryUpdates = Record<string, string | number | null | undefined>;

/**
 * Small helper around `useSearchParams` for keeping list state (pagination,
 * search, filters) in the URL instead of component state.
 *
 * Why the URL: pages like Videos / Image Repo unmount when you click through to
 * /jobs/:id, so anything held in `useState` is lost and the list snaps back to
 * page 1 on return. The query string survives unmount/remount, browser
 * back/forward, refresh, and is shareable.
 *
 * `setQuery` always uses `replace: true` so paging through a list does not
 * stack up one history entry per click (back would otherwise have to be pressed
 * once per page change). Replacing still records the params on the *current*
 * history entry, so a later push (e.g. navigating to /jobs/:id) followed by a
 * browser back restores the list exactly as it was left.
 *
 * Pass `null`/`undefined`/`""` to drop a param, so defaults never litter the URL.
 * Batch every key you want to change into a single `setQuery` call — two calls
 * in the same tick would both start from the same (pre-update) params.
 */
export function useQueryState() {
  const [params, setSearchParams] = useSearchParams();

  const setQuery = useCallback(
    (updates: QueryUpdates) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === undefined || value === "") {
              next.delete(key);
            } else {
              next.set(key, String(value));
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { params, setQuery };
}

/**
 * Read a 1-based page param as the 0-based index MUI's TablePagination wants.
 * Missing/garbage/out-of-range values fall back to the first page.
 */
export function getPage(params: URLSearchParams, key: string): number {
  const parsed = Number.parseInt(params.get(key) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 1 ? parsed - 1 : 0;
}

/** 0-based page index -> URL value (1-based). The first page is omitted. */
export function pageValue(page: number): number | null {
  return page > 0 ? page + 1 : null;
}

/** Read a rows-per-page param, ignoring anything that is not an offered option. */
export function getPerPage(
  params: URLSearchParams,
  key: string,
  allowed: readonly number[],
  fallback: number,
): number {
  const parsed = Number.parseInt(params.get(key) ?? "", 10);
  return allowed.includes(parsed) ? parsed : fallback;
}

/** Rows-per-page -> URL value. The default is omitted. */
export function perPageValue(value: number, fallback: number): number | null {
  return value === fallback ? null : value;
}
