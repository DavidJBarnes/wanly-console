/**
 * A content-LoRA strength, as typed into a form field.
 *
 * The strength fields hold a STRING while they are being edited, and this is why. Round-
 * tripping every keystroke through a number — `value={String(c.s1)}` over
 * `onChange={... Number(e.target.value)}` — erases the decimal point the moment it is
 * typed: "0." parses to 0, renders back as "0", and the caret lands after a digit again.
 * The field then accepts whole numbers only, so 0.6 — the strength the engine has applied
 * since before this was adjustable — could not be typed at all (console#419).
 *
 * The string is the state; parsing happens once, on save.
 *
 * Bounded at 2 to match the engine, which rejects anything higher with a 422 — ten minutes
 * into a claimed segment, not here. 0 is legal: it loads the LoRA and gives it no weight,
 * which is how you measure what it contributes. Empty is not — a LoRA the pose lists has no
 * "inherit the stack" fallback to fall back to.
 *
 * Returns null for anything unusable, which the caller reports against the named LoRA
 * rather than sending on.
 */
export function parseContentLoraStrength(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 2) return null;
  return n;
}
