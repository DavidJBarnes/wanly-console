/**
 * What the pose editor's negative-prompt box starts from, and what it sends back.
 *
 * These are two halves of one rule, and getting them out of step is the bug they exist to
 * prevent (console#430). The box used to open on the pose's RESOLVED negative — its own
 * override, or the default falling through — and save `typed.trim() || null`. Opening a
 * pose that inherited and pressing Save therefore wrote the default back as the pose's own
 * override, silently. Every pose in production was pinned that way, which is why the
 * Settings negative prompt had never applied to a single render.
 *
 * So the box shows the OVERRIDE only. Empty means "inherit", both on the way in and on the
 * way out, and the default is shown as a placeholder instead — visible, but not typed in.
 */

/** The value the field opens on. A pose that inherits opens EMPTY, never on the default. */
export function initialNegativeOverride(
  pose: { negative_prompt_override?: string | null } | null,
): string {
  return pose?.negative_prompt_override ?? "";
}

/**
 * What to send for that field.
 *
 * null clears the override and restores the inherit. An empty STRING would be a different
 * and much worse thing — a pose that renders with no negative conditioning at all.
 */
export function negativeOverrideToSend(typed: string): string | null {
  return typed.trim() || null;
}
