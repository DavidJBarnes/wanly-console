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
