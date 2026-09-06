/**
 * Telling two workers apart by what they are running (wanly-gpu-docker#72).
 *
 * The 3090 and a RunPod pod ran different code for 14 hours. The only symptom was a 422 on a
 * content LoRA that looked random — the pod fetched it, the 3090 could not. Nothing in the
 * console said the two boxes were on different builds, so the answer came from SSHing into
 * both and reading git.
 */

export interface BuildIdentity {
  daemon_commit: string | null;
  image_ref: string | null;
}

/** A short, stable label. Falsy values collapse to "?" so a partial report still renders. */
export function buildLabel(w: BuildIdentity): string {
  return `${short(w.daemon_commit)} / ${short(w.image_ref)}`;
}

/** Shas arrive full-length from the image (github.sha) and short from the daemon. Show seven
 *  either way, so two workers can be compared by eye without one being three times longer. */
export function short(sha: string | null): string {
  const s = (sha ?? "").trim();
  if (!s) return "?";
  const bare = s.startsWith("sha256:") ? s.slice("sha256:".length) : s;
  return bare.length > 7 ? bare.slice(0, 7) : bare;
}

/**
 * Which workers disagree with the rest of the fleet.
 *
 * The MAJORITY is the reference, not "latest" — the console cannot see what main is, and
 * asking would put a GitHub dependency in a page that has to render when GitHub is down.
 * Majority is enough for the thing this exists to catch: one box left behind.
 *
 * A worker that reports nothing is NOT flagged. An older daemon that cannot report is a
 * different problem from a worker that is demonstrably behind, and flagging it would make
 * the signal noise on the day this ships, before any worker has restarted.
 *
 * With only one worker there is nothing to disagree with, so nothing is ever flagged.
 */
export function driftingWorkers<T extends BuildIdentity & { id: string }>(
  workers: T[],
): Set<string> {
  const reported = workers.filter((w) => w.daemon_commit || w.image_ref);
  if (reported.length < 2) return new Set();

  const counts = new Map<string, number>();
  for (const w of reported) {
    const k = buildLabel(w);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // Ties are not drift: two workers on two builds is a disagreement, but neither is "the"
  // majority, so flag BOTH rather than picking one arbitrarily.
  const top = Math.max(...counts.values());
  const majorities = [...counts.entries()].filter(([, n]) => n === top);
  if (majorities.length > 1) return new Set(reported.map((w) => w.id));

  const winner = majorities[0][0];
  return new Set(reported.filter((w) => buildLabel(w) !== winner).map((w) => w.id));
}
