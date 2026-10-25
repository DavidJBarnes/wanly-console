/**
 * Best-guess pose from the start image's tags (console#694).
 *
 * Most repo images carry an action tag that is close to a pose name — Doggystyle, Missionary,
 * Cowgirl, POV, Handjob, Cumshot — so New Job from an image can open on that pose instead of
 * the starred default. Pure so node-env vitest can cover it without React.
 *
 * Scoring, per pose: every image tag found among the pose name's words is worth a lot; every
 * pose-name word no tag accounts for costs a little. So "Doggystyle" beats "Doggystyle POV"
 * unless the image is also tagged POV, and Doggystyle + POV picks "Doggystyle POV" over
 * "Doggystyle Insertion POV". Whole words only, so Kelly cannot match "KellyYoung"-style
 * names, and character tags simply match nothing.
 */
import type { Pose } from "../api/ltx";

export interface PoseGuess {
  poseId: string;
  /** The image tags that matched, as the image spells them — shown next to the picker. */
  matched: string[];
}

const words = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export function guessPoseFromTags(tags: string | null | undefined, poses: Pose[]): PoseGuess | null {
  const imageTags = (tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!imageTags.length || !poses.length) return null;
  // A name can repeat across books (wanly-api#320): prefer the starred default's book.
  const defaultBook = poses.find((p) => p.is_default)?.book_name;

  let best: { pose: Pose; score: number; matched: string[] } | null = null;
  for (const pose of poses) {
    const poseWords = words(pose.name);
    const used = new Set<string>();
    const matched: string[] = [];
    for (const tag of imageTags) {
      const tw = words(tag);
      // A multi-word tag ("Big dick") matches only if all of its words are in the name.
      if (tw.length && tw.every((w) => poseWords.includes(w))) {
        matched.push(tag);
        tw.forEach((w) => used.add(w));
      }
    }
    if (!matched.length) continue;
    const score = matched.length * 100 - poseWords.filter((w) => !used.has(w)).length;
    const better =
      !best ||
      score > best.score ||
      (score === best.score && pose.book_name === defaultBook && best.pose.book_name !== defaultBook);
    if (better) best = { pose, score, matched };
  }
  return best ? { poseId: best.pose.id, matched: best.matched } : null;
}
