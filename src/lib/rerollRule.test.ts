import { describe, expect, it } from "vitest";
import { activeRuleTake, ruleMetricMean, ruleSpec } from "./rerollRule";
import type { SegmentResponse } from "../api/types";

// The mean must match what the API's judge computes (same series field, same 8-point
// minimum), because the dialog shows this number as "this take measured X" right beside
// the threshold the API will enforce.
describe("ruleMetricMean", () => {
  it("averages the series the metric maps to", () => {
    const metrics = { series_expression: [2, 4, 2, 4, 2, 4, 2, 4] };
    expect(ruleMetricMean(metrics, "expression")).toBe(3);
  });

  it("identity reads the plain 'series' field", () => {
    const metrics = { series: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9] };
    expect(ruleMetricMean(metrics, "identity")).toBeCloseTo(0.9);
  });

  it("refuses a series shorter than the chip minimum", () => {
    // Below 8 points the metrics dialog draws no chip — the user must never be gated
    // by a number they cannot see.
    expect(ruleMetricMean({ series_motion: [1, 1, 1] }, "motion")).toBeNull();
  });

  it("ignores non-numeric entries and refuses when too few survive", () => {
    const metrics = { series_detail: [200, null, "x", 220, 210, 205, 215, 208] };
    expect(ruleMetricMean(metrics, "detail")).toBeNull();
  });

  it("handles missing metrics and unknown metric names", () => {
    expect(ruleMetricMean(null, "expression")).toBeNull();
    expect(ruleMetricMean({}, "vibes")).toBeNull();
  });
});

describe("activeRuleTake", () => {
  const seg = (over: Partial<SegmentResponse>): SegmentResponse =>
    ({ index: 0, discarded: false, reroll_rule_metric: null, ...over }) as SegmentResponse;

  it("finds the live segment-0 take carrying a rule", () => {
    const take = seg({ reroll_rule_metric: "expression" });
    expect(activeRuleTake([seg({ discarded: true }), take])).toBe(take);
  });

  it("ignores archived takes and rule-less jobs", () => {
    expect(activeRuleTake([seg({ reroll_rule_metric: "expression", discarded: true })])).toBeNull();
    expect(activeRuleTake([seg({})])).toBeNull();
  });
});

describe("ruleSpec", () => {
  it("knows all four axes and nothing else", () => {
    for (const key of ["identity", "expression", "motion", "detail"]) {
      expect(ruleSpec(key)?.key).toBe(key);
    }
    expect(ruleSpec("")).toBeUndefined();
    expect(ruleSpec(null)).toBeUndefined();
  });
});
