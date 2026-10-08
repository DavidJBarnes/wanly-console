import type { TrainedOnGroup } from "../api/types";

/** A group's heading: "Joana v4 — identity · 27 × 10" -- the dataset by its name now, with the
 *  name it trained under when that differs (renamed, merged into a living set, or deleted). */
export function groupTitle(g: TrainedOnGroup): string {
  const now = g.dataset_name ?? "ad-hoc images";
  const then = g.dataset_name_as_trained;
  const name = then && then !== now ? `${now} (trained as “${then}”)` : now;
  const gone = g.dataset_exists ? "" : " — dataset deleted";
  const repeats = g.num_repeats ? ` × ${g.num_repeats}` : "";
  return `${name}${gone} — ${g.kind} · ${g.images.length}${repeats}`;
}

/** "+12 added, −4 removed since" against the dataset now, or null when it is unchanged or gone. */
export function diffSummary(g: Pick<TrainedOnGroup, "dataset_exists" | "added_since" | "removed_since">): string | null {
  if (!g.dataset_exists) return null;
  const parts = [
    ...(g.added_since.length ? [`+${g.added_since.length} added`] : []),
    ...(g.removed_since.length ? [`−${g.removed_since.length} removed`] : []),
  ];
  return parts.length ? `${parts.join(", ")} since` : "unchanged since";
}
