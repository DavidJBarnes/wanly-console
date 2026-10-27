/**
 * The enhanced prompt as a job's prompt (wanly-api#480).
 *
 * The Sulphur-2 enhancer writes the scene from the image and its scene description. It knows
 * nothing about our characters, so on its own the prompt names nobody, and the character
 * LoRA's trigger phrase -- the token it trained on, and the who-is-who lever with two
 * characters (console#487) -- would be missing. So the filled slots' trigger phrases go in
 * front, in slot order, the way a pose template's `<TRIGGER>, ...` starts. An empty phrase (the
 * "no character" option, a sheet-only character) contributes nothing.
 */
export function withTriggers(triggers: (string | undefined | null)[], enhanced: string): string {
  const body = enhanced.trim();
  const lead = triggers.map((t) => (t ?? "").trim()).filter(Boolean);
  if (!lead.length) return body;
  return `${lead.join(", ")}, ${body}`;
}
