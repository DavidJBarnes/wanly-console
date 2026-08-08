/**
 * Preparing the four quality axes for one shared chart.
 *
 * They have wildly different natural units — identity is a 0–1 cosine, motion is pixels per
 * frame, expression is landmark movement scaled by 1000, detail is Laplacian variance in the
 * hundreds. Plotted raw on one axis, identity would be a flat line at the bottom and detail
 * would be the only thing visible.
 *
 * So each series is normalised to its own range. That deliberately discards magnitude: the
 * chart answers "when did this dip", and the headline numbers beside it carry "by how much".
 * Mixing those two jobs into one axis makes both worse.
 */

export interface Track {
  key: "identity" | "expression" | "motion" | "detail";
  label: string;
  /** Normalised 0–1 for plotting. */
  points: number[];
  /** Real values, for the tooltip and the range caption. */
  raw: number[];
  /** Average over the clip — the number worth comparing between runs. */
  mean: number;
  min: number;
  max: number;
  /** How many decimals this axis is meaningfully read at. */
  precision: number;
}

const SPECS: {
  key: Track["key"];
  label: string;
  field: string;
  precision: number;
}[] = [
  { key: "identity", label: "Identity", field: "series", precision: 3 },
  { key: "expression", label: "Expression", field: "series_expression", precision: 1 },
  { key: "motion", label: "Motion", field: "series_motion", precision: 2 },
  { key: "detail", label: "Detail", field: "series_detail", precision: 0 },
];

/** A series shorter than this is noise, not a trajectory. */
const MIN_POINTS = 8;

/**
 * Frame-to-frame values are far noisier than the trend inside them.
 *
 * Measured on job 9c7243a7: motion ranged 0.13–1.06 per frame while its eighth-by-eighth means
 * sat between 0.57 and 0.67 — flat. Every axis behaved the same way. Drawn raw, four such series
 * overlap into solid hatching that reads as chaos when the clip is in fact stationary, which is
 * the opposite of what the chart is for.
 *
 * Two things make the raw signal noisier than the thing being measured. The video is scored
 * after RIFE interpolation, so most frames are interpolated rather than generated; and the
 * delta-based axes difference adjacent frames, which amplifies whatever jitter is left.
 *
 * So the LINE is smoothed and the RANGE CHIPS stay raw — the trend and the true extremes are
 * different questions, and one series cannot answer both. Dip detection also stays on raw
 * values: it asks about one specific frame, which a rolling mean would blur into its neighbours.
 */
function smooth(values: number[]): number[] {
  // ~7% of the clip each side. On a 289-frame series that is about 0.35s of source footage:
  // wide enough to clear the interpolation jitter, narrow enough that sub-second structure
  // survives. Dip detection reads raw values, so this only has to serve the trend.
  const half = Math.max(2, Math.round(values.length / 28));
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length, i + half + 1);
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += values[j];
    return sum / (hi - lo);
  });
}

export function buildTracks(metrics: Record<string, unknown> | null | undefined): Track[] {
  if (!metrics) return [];
  const tracks: Track[] = [];

  for (const spec of SPECS) {
    const raw = metrics[spec.field];
    if (!Array.isArray(raw) || raw.length < MIN_POINTS) continue;
    const values = raw.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (values.length < MIN_POINTS) continue;

    // Ranges come from the raw values: the chips answer "how extreme did this get", and
    // smoothing would quietly shrink both ends of that answer.
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;

    // The smoothed line is normalised against the RAW range, deliberately. Rescaling it to its
    // own range instead would stretch whatever ripple survived smoothing back to full plot
    // height, so a stationary clip would look identical to a collapsing one and the chart could
    // never say "flat". Against the raw range, a series that only jitters stays near the middle
    // and one that genuinely trends travels — which is the distinction being drawn.
    //
    // A genuinely flat series would divide by zero. Render it down the middle rather than
    // dropping it — "this never changed" is information, and an absent line reads as missing
    // data instead.
    const span = max - min;
    const line = smooth(values);
    const points = span > 0 ? line.map((v) => (v - min) / span) : line.map(() => 0.5);

    tracks.push({ ...spec, points, raw: values, mean, min, max });
  }
  return tracks;
}

/**
 * Where each track sits at a given fraction through the clip.
 *
 * The series have different lengths — identity is sampled with a stride, motion is one value
 * per frame pair — so they are read by proportion rather than by index. Aligning on index
 * would silently compare frame 40 of one axis with frame 12 of another.
 */
export function sampleAt(track: Track, fraction: number): number {
  if (track.raw.length === 0) return 0;
  const i = Math.round(fraction * (track.raw.length - 1));
  return track.raw[Math.max(0, Math.min(track.raw.length - 1, i))];
}
