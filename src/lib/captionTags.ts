/**
 * The WD14 tags that landed in an SDXL run's captions (wanly-api#462).
 *
 * A tag the caption NAMES is learned onto that tag, not the trigger. So a fixed feature of the
 * person (earrings, stubble, a tattoo) that shows up here on most images is one the trigger did
 * not learn: it comes back only when prompted by its tag. Joana v4's `earrings` on 58 of 73
 * captions is the case that made this visible.
 */
import type { CaptionTagGroup, TrainingJob } from "../api/types";

/** How many tags a group lists. */
export const TOP_N = 25;
/** At or above this share of images, a tag is flagged as learned on the tag. */
export const FLAG_SHARE = 0.5;

export interface CaptionTagRow {
  tag: string;
  count: number;
  /** 0-100, rounded. */
  pct: number;
  flagged: boolean;
}

/** The run's tally, or null when it has none (LTX runs; SDXL runs before #462 not backfilled). */
export function captionTagGroups(job: Pick<TrainingJob, "caption_tags">): CaptionTagGroup[] | null {
  const groups = job.caption_tags?.groups;
  return groups && groups.length > 0 ? groups : null;
}

function prefixTokens(label: string): Set<string> {
  return new Set(label.split(",").map((t) => t.trim()).filter(Boolean));
}

function rows(tags: [string, number][] | null | undefined, group: CaptionTagGroup,
              n: number): CaptionTagRow[] {
  // The trainer already leaves the prefix out; this keeps a trigger row off the list even if
  // an older tally carried one.
  const skip = prefixTokens(group.label ?? "");
  const total = group.images || 0;
  return (tags ?? [])
    .filter(([t]) => !skip.has(t))
    .slice(0, n)
    .map(([tag, count]) => {
      const share = total ? count / total : 0;
      return { tag, count, pct: Math.round(share * 100), flagged: share >= FLAG_SHARE };
    });
}

/** The top kept tags, most frequent first. */
export function keptRows(group: CaptionTagGroup, n = TOP_N): CaptionTagRow[] {
  return rows(group.kept, group, n);
}

/** The stripped tags ("baked into the trigger"), or null when the run cannot know them. */
export function strippedRows(group: CaptionTagGroup): CaptionTagRow[] | null {
  return group.stripped == null ? null : rows(group.stripped, group, Infinity)
    .map((r) => ({ ...r, flagged: false }));
}

/** Prompt-ready: tags EXACTLY as captioned (underscores kept -- that is the token the LoRA
 *  trained on), comma-separated. */
export function promptText(tags: CaptionTagRow[]): string {
  return tags.map((r) => r.tag).join(", ");
}
