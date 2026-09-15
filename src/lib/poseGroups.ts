/**
 * Grouping poses by their book for the RecipeForm picker (wanly-api#320).
 *
 * Poses stopped being one flat list: a Book is a shelf of poses that belong together, and
 * names are unique only within a book. The picker still shows every pose — it is grouped,
 * not filtered — because a pose is character-agnostic and a new character should see all of
 * them. Pure logic, so it lives outside the component to be covered by node-env vitest.
 */
import type { Pose } from "../api/ltx";

/** Poses grouped by `book_name`, in first-seen order of both groups and their poses. */
export function groupPosesByBook(poses: Pose[]): [string, Pose[]][] {
  const groups = new Map<string, Pose[]>();
  for (const p of poses) {
    const name = p.book_name || "Unfiled";
    const group = groups.get(name);
    if (group) group.push(p);
    else groups.set(name, [p]);
  }
  return [...groups.entries()];
}
