/**
 * A per-pose numeric override, as typed into a form field.
 *
 * Empty means "inherit the stack's value" and must become null. A typed 0 means ZERO and
 * must survive — and those two are the same falsy value in JavaScript, which is the whole
 * reason this is a named function with tests rather than an inline ternary repeated at four
 * call sites.
 *
 * Where it matters:
 *   img_compression 0  bypasses the conditioning-frame encode entirely
 *   content_s1/s2  0   loads the LoRA and gives it no weight, which is how you measure
 *                      what it actually contributes
 *
 * Collapse either to null and the render succeeds at the stack default, silently, and the
 * result looks like a finding about the LoRA rather than a bug in a form.
 */
export function overrideNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  // NaN would be sent as null and read as "inherit", which hides a typo instead of
  // surfacing it. Callers validate ranges; this only decides inherit-vs-value.
  return Number.isFinite(n) ? n : null;
}
