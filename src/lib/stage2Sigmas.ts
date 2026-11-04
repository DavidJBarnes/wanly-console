import type { LtxRecipeRef } from "../api/types";

/**
 * What the API accepts for stage 2 sigmas (console#717), so the Settings page can say what is
 * wrong before Save. wanly-api's app/stage2_sigmas.py is the authority.
 */
const MAX_VALUES = 20;

/** What is wrong with a schedule, or null. Blank is fine: it means the default. */
export function stage2SigmasProblem(text: string): string | null {
  if (!text.trim()) return null;
  const parts = text.split(",").map((p) => p.trim());
  if (!parts.every((p) => /^\d*\.?\d+$/.test(p))) {
    return "Use plain decimals separated by commas.";
  }
  const values = parts.map(Number);
  if (values.length < 2 || values.length > MAX_VALUES) {
    return `Use between 2 and ${MAX_VALUES} values.`;
  }
  if (values[0] > 1) return "Start at 1 or below.";
  if (values.some((v, i) => i > 0 && values[i - 1] <= v)) return "Each value must be lower than the last.";
  if (values[values.length - 1] !== 0) return "End at 0.";
  return null;
}

/** Starting points for the Settings table (console#723). Each drops the leading value of the one
 *  above, so the only thing that changes is how much stage 2 is allowed to redraw. */
export const STAGE2_SIGMAS_PRESETS = [
  { name: "Default", value: "0.85, 0.7250, 0.4219, 0.0", expect: "Most redrawing, most detail, most invention" },
  { name: "Medium", value: "0.725, 0.4219, 0.0", expect: "Less invention, slightly softer" },
  { name: "Low", value: "0.4219, 0.0", expect: "Barely redraws: close to a sharpened upscale. Softer, faces may lose detail" },
] as const;

interface SigmasSegment {
  ltx_recipe?: LtxRecipeRef | null;
  claimed_at: string | null;
  reprocess_type: string | null;
}

/**
 * The stage 2 sigmas a segment ran with, or null when there is nothing to say: not an LTX
 * render, a reprocess, or not claimed yet (the API stamps the setting at claim time, so before
 * then the value is not decided). A claimed render without the key ran the recipe default.
 */
export function segmentStage2Sigmas(seg: SigmasSegment, defaultValue: string): string | null {
  if (!seg.ltx_recipe || seg.reprocess_type || !seg.claimed_at) return null;
  if (seg.ltx_recipe.stage2_sigmas) return seg.ltx_recipe.stage2_sigmas;
  return defaultValue ? `default (${defaultValue})` : "default";
}

/** One line for the job: the shared value, or "varies by segment" when the global setting
 *  changed between claims. Null when no segment has run yet. */
export function jobStage2Sigmas(segments: SigmasSegment[], defaultValue: string): string | null {
  const values = new Set(
    segments.map((s) => segmentStage2Sigmas(s, defaultValue)).filter((v): v is string => v !== null),
  );
  if (values.size === 0) return null;
  return values.size === 1 ? [...values][0] : "varies by segment";
}
