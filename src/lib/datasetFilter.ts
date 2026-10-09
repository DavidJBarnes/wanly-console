/**
 * The Datasets page's "show" filter (wanly-console#643): All · Singles · Pairs ·
 * Regularization, kept in the URL as `?show=pairs` so a link or a reload keeps it.
 *
 * ONE FIELD DECIDES, THE SAME ONE THE CARD'S BADGE READS. The owner badge ("Character · x",
 * "Pair · x", "Regularization · woman") is ownerLabel, which switches on `ds.kind`; this does
 * too, so a set can never be filtered as a pair while its badge says single. "Owned by a pair
 * character" needs no second test: the owner picker only offers solo characters for
 * kind=character and puts pair owners on kind=composition, so a pair's set IS a composition
 * set. A set with no kind (unassigned) is in no group but All -- it is what needs assigning,
 * and the card says so loudly there.
 */
import type { Dataset } from "../api/types";

export type DatasetShow = "all" | "singles" | "pairs" | "regularization";

export const DATASET_SHOWS: { value: DatasetShow; label: string }[] = [
  { value: "all", label: "All" },
  { value: "singles", label: "Singles" },
  { value: "pairs", label: "Pairs" },
  { value: "regularization", label: "Regularization" },
];

/** `?show=` read back; anything unknown (an old link, a typo) is All rather than an empty page. */
export function parseShow(raw: string | null | undefined): DatasetShow {
  return DATASET_SHOWS.some((s) => s.value === raw) ? (raw as DatasetShow) : "all";
}

/** The group a set belongs to, or null for an unassigned one (All only). */
export function datasetGroup(ds: Pick<Dataset, "kind">): Exclude<DatasetShow, "all"> | null {
  switch (ds.kind) {
    case "character": return "singles";
    case "composition": return "pairs";
    case "regularization": return "regularization";
    default: return null;
  }
}

export function matchesShow(ds: Pick<Dataset, "kind">, show: DatasetShow): boolean {
  return show === "all" || datasetGroup(ds) === show;
}

/** How many sets each option would show, for the counts on the control. */
export function showCounts(list: Pick<Dataset, "kind">[]): Record<DatasetShow, number> {
  const counts: Record<DatasetShow, number> = { all: list.length, singles: 0, pairs: 0,
    regularization: 0 };
  for (const ds of list) {
    const g = datasetGroup(ds);
    if (g) counts[g] += 1;
  }
  return counts;
}
