/**
 * The recipe placeholder for the job's start image's enhanced prompt (wanly-api#484). Unlike
 * `<SCENE>` it is never filled here: it is submitted as written and the API swaps the saved
 * script in when the segment is claimed -- from the JOB's start image for every segment, and
 * dropped when that image has none.
 */
export const PROMPT_TOKEN = "<PROMPT>";

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
