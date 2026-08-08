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

export function buildTracks(metrics: Record<string, unknown> | null | undefined): Track[] {
  if (!metrics) return [];
  const tracks: Track[] = [];

  for (const spec of SPECS) {
    const raw = metrics[spec.field];
    if (!Array.isArray(raw) || raw.length < MIN_POINTS) continue;
    const values = raw.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (values.length < MIN_POINTS) continue;

    const min = Math.min(...values);
    const max = Math.max(...values);
    // A genuinely flat series would divide by zero. Render it down the middle rather than
    // dropping it — "this never changed" is information, and an absent line reads as missing
    // data instead.
    const span = max - min;
    const points = span > 0 ? values.map((v) => (v - min) / span) : values.map(() => 0.5);

    tracks.push({ ...spec, points, raw: values, min, max });
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
