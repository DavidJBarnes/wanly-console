import type { WorkerLoraItem, WorkerLoras } from "../api/types";

/**
 * How a worker's LoRA inventory should read on the page.
 *
 * The states carry intent, and collapsing them would destroy the feature. Since the boot
 * sync stopped eagerly fetching content LoRAs, `deferred` is the NORMAL state — a page that
 * flags it as a fault is amber on every worker forever, and one that is always amber gets
 * ignored. `stale` is then lost in that noise, and `stale` is the reason to build this at
 * all: a worker holding an outdated LoRA renders the previous character, successfully.
 */
export type Severity = "ok" | "note" | "alarm";

export function severityOf(state: WorkerLoraItem["state"]): Severity {
  switch (state) {
    case "current":
      return "ok";
    // Absent on purpose. Not a problem, and must not be shown as one.
    case "deferred":
      return "ok";
    // Present, but verified by size alone because the bucket ETag is multipart. Worth
    // saying, because a same-size retrain would not have been caught — but it is not a
    // known fault, so it must not shout.
    case "unverifiable":
      return "note";
    // Present and WRONG, or absent when it should not be. Both produce bad renders; the
    // first does so without failing, which is why it ranks with the second.
    case "stale":
    case "missing":
      return "alarm";
  }
}

/** One line for the panel header. Leads with what is wrong, because that is what is read. */
export function summarise(inv: WorkerLoras | null): string {
  if (!inv) return "Not reported";
  const items = inv.items ?? [];
  if (items.length === 0) return "No LoRAs";
  const n = (s: string) => items.filter((i) => i.state === s).length;
  const bad = n("stale") + n("missing");
  const parts: string[] = [];
  if (bad > 0) parts.push(`${bad} need attention`);
  parts.push(`${n("current") + n("unverifiable")} of ${items.length} present`);
  if (n("deferred") > 0) parts.push(`${n("deferred")} on demand`);
  return parts.join(" · ");
}

/** Alarms first — a long "current" list must not push the one broken row off the fold. */
export function orderForDisplay(items: WorkerLoraItem[]): WorkerLoraItem[] {
  const rank: Record<Severity, number> = { alarm: 0, note: 1, ok: 2 };
  return [...items].sort(
    (a, b) =>
      rank[severityOf(a.state)] - rank[severityOf(b.state)] ||
      a.kind.localeCompare(b.kind) ||
      a.name.localeCompare(b.name),
  );
}
