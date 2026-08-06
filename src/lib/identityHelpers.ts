/**
 * Pure helpers behind the identity chip and trajectory panel.
 *
 * These live here rather than as exports from the components because eslint runs
 * `reactRefresh.configs.vite`, which errors on non-component exports from a component file.
 * Moving them keeps the components export-only and makes the numeric thresholds testable --
 * and every threshold in here was set from measurement, so a silent change to one would be
 * hard to notice by eye.
 */

/** Cosine bands. ArcFace on buffalo_l: ~0.4 is the same-person threshold, 0.6+ is a solid
 *  match, 0.8+ is strong. Deliberately not "good/bad" -- a profile-heavy clip legitimately
 *  scores lower than a frontal one, so colour is a hint, not a verdict. */
export function band(v: number | null | undefined): "success" | "warning" | "error" | "default" {
  if (v == null) return "default";
  if (v >= 0.7) return "success";
  if (v >= 0.5) return "warning";
  return "error";
}

/** Total drift across the clip, which reads better than a per-frame slope. */
export function totalDrift(slope: number | null, frames: number | null): number | null {
  if (slope == null || !frames || frames < 2) return null;
  return slope * (frames - 1);
}

export function fmt(v: number | null | undefined, digits = 3): string {
  return v == null ? "—" : v.toFixed(digits);
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** How many trailing samples count as "the end" when judging whether the last frame is
 *  representative. Short enough to be local, long enough not to be one noisy sample. */
export const TAIL = 12;
/** Below this the endpoint is just noise; a dip has to be worth acting on. */
export const DIP_THRESHOLD = 0.05;

export interface TailVerdict {
  end: number;
  /** Median of the samples just before the end, or null when the tail is too short to judge. */
  bodyMedian: number | null;
  /** How far the final frame sits below that median. Negative means it sits above. */
  dip: number | null;
  isDip: boolean;
  /** Best frame in the tail, and how far back it is -- what a better anchor would be worth. */
  bestTail: number;
  bestOffset: number;
}

/**
 * Is the final frame representative of where the clip settled, or a transient dip?
 *
 * This is not cosmetic: the daemon seeds the NEXT segment from the last frame, so a blink or a
 * motion blur there propagates into everything that follows. Start and end alone cannot tell a
 * steady decay from a clip that held and then dipped -- both produce identical headline numbers
 * and call for opposite fixes.
 */
export function tailVerdict(series: number[]): TailVerdict {
  const end = series[series.length - 1];
  const body = series.slice(-TAIL, -2);
  const bodyMedian = body.length >= 4 ? median(body) : null;
  const dip = bodyMedian != null ? bodyMedian - end : null;
  const tail = series.slice(-TAIL);
  const bestTail = Math.max(...tail);
  return {
    end,
    bodyMedian,
    dip,
    isDip: dip != null && dip >= DIP_THRESHOLD,
    bestTail,
    bestOffset: tail.length - 1 - tail.lastIndexOf(bestTail),
  };
}
