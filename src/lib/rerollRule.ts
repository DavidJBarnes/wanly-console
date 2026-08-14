/**
 * "Re-roll until" rules: the four quality axes a re-roll chain can gate on.
 *
 * The API judges a finished take by the MEAN of the matching per-frame series in
 * identity_metrics — the same number the metrics dialog's chips display — so this module
 * mirrors that computation exactly (same series fields, same 8-point minimum). The dialog
 * uses it to show "this take measured X" beside the threshold input, and the banner chip
 * uses it to say whether a finished chain ended by meeting its rule or by giving up.
 * Two different values behind one decision would make both untrustworthy.
 */

import type { SegmentResponse } from "../api/types";

export interface RerollRuleSpec {
  key: string;
  label: string;
  /** Field inside identity_metrics holding the per-frame series. */
  seriesField: string;
  /** Decimals the axis is meaningfully read at (matches trajectorySeries). */
  precision: number;
  /** Step for the threshold input, scaled to the axis' natural units. */
  step: number;
  /** A starting threshold in the axis' typical range, for when the take itself
   *  has no measurement to pre-fill from. */
  fallbackThreshold: number;
}

export const REROLL_RULE_SPECS: RerollRuleSpec[] = [
  { key: "identity", label: "Identity", seriesField: "series", precision: 3, step: 0.01, fallbackThreshold: 0.85 },
  { key: "expression", label: "Expression", seriesField: "series_expression", precision: 1, step: 0.5, fallbackThreshold: 4 },
  { key: "motion", label: "Motion", seriesField: "series_motion", precision: 2, step: 0.05, fallbackThreshold: 0.6 },
  { key: "detail", label: "Detail", seriesField: "series_detail", precision: 0, step: 10, fallbackThreshold: 200 },
];

export function ruleSpec(metric: string | null | undefined): RerollRuleSpec | undefined {
  return REROLL_RULE_SPECS.find((s) => s.key === metric);
}

/** Below this the metrics dialog draws no chip, and the API's judge refuses to gate — the
 *  user must never be shown (or gated by) a number they can't see in the dialog. */
const MIN_POINTS = 8;

/** The mean the API's judge will compare against, or null when unevaluable. */
export function ruleMetricMean(
  metrics: Record<string, unknown> | null | undefined,
  metric: string,
): number | null {
  const spec = ruleSpec(metric);
  if (!spec || !metrics) return null;
  const series = metrics[spec.seriesField];
  if (!Array.isArray(series)) return null;
  const values = series.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length < MIN_POINTS) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function formatRuleValue(metric: string, value: number): string {
  const spec = ruleSpec(metric);
  return value.toFixed(spec ? spec.precision : 2);
}

/** The live segment-0 take carrying a rule, if the job has one. */
export function activeRuleTake(videoSegments: SegmentResponse[]): SegmentResponse | null {
  const take = videoSegments.find(
    (s) => !s.discarded && s.index === 0 && s.reroll_rule_metric != null,
  );
  return take ?? null;
}
