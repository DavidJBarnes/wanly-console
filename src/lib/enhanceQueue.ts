import type { EnhanceQueueResult, EnhanceQueueStatus } from "../api/types";

/** Images that left the line since the last read without failing: their prompts are saved. */
export function newlyEnhanced(
  prev: EnhanceQueueStatus | null, next: EnhanceQueueStatus,
): string[] {
  if (!prev) return [];
  const still = new Set([...next.waiting, ...next.failed.map((f) => f.path)]);
  return prev.waiting.filter((p) => !still.has(p));
}

/** A queue request's outcome in a sentence, naming whatever was left out and why. */
export function describeQueued(r: EnhanceQueueResult): string {
  const parts = [`Queued ${r.queued} for Enhance prompt.`];
  if (r.already_enhanced) parts.push(`${r.already_enhanced} already have a prompt.`);
  if (r.no_action) parts.push(`${r.no_action} have no Action tag with a description.`);
  return parts.join(" ");
}
