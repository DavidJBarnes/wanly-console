/**
 * The recipe placeholder for the start image's enhanced prompt (wanly-api#484).
 *
 * Filled IN THE FORM the way `<SCENE>` is (lib/captionRegion): the frame's saved script lands
 * in the editable box as a marked region, so it is read before it renders and can be rewritten
 * in place when the start frame changes:
 *
 *   template   <TRIGGER>, <PROMPT>
 *   filled     k3llydw, woman, <prompt>This close-up video shows...</prompt>
 *   submitted  k3llydw, woman, This close-up video shows...
 *
 * A placeholder still bare at submit -- a continuation (its frame is generated and never
 * enhanced), or a frame with no enhanced prompt -- goes to the API as written. The API fills it
 * at the claim from the JOB's start image, and drops it when that has none.
 */
export const PROMPT_TOKEN = "<PROMPT>";

/** A filled region, non-greedy so two never merge. */
const REGION = /<prompt>([\s\S]*?)<\/prompt>/gi;
/** Any prompt tag, any case -- the bare placeholder or a stray marker. */
const ANY_TAG = /<\/?prompt>/gi;

/** Does this prompt want the enhanced prompt at all -- filled or not? */
export function wantsEnhanced(prompt: string): boolean {
  return new RegExp(ANY_TAG.source, "i").test(prompt);
}

/** Is there a filled region? */
export function hasEnhancedRegion(prompt: string): boolean {
  return new RegExp(REGION.source, "i").test(prompt);
}

/**
 * Put the enhancer's script in as the prompt region: rewrite the region if there is one, else
 * fill the placeholder. Angle-bracket tokens are scrubbed from the script first: it is model
 * output, and the API reads `<name>` as a wildcard or placeholder.
 */
export function fillEnhanced(prompt: string, enhanced: string): string {
  const region = `<prompt>${enhanced.replace(/<[^<>]*>/g, "").trim()}</prompt>`;
  if (hasEnhancedRegion(prompt)) {
    let first = true;
    return prompt.replace(REGION, () => {
      if (!first) return "";
      first = false;
      return region;
    });
  }
  return prompt.split(PROMPT_TOKEN).join(region);
}

/** Put the placeholder back where the region is -- for "was the recipe edited?", and when
 *  the start frame changes to one with no enhanced prompt. */
export function unfillEnhanced(prompt: string): string {
  return prompt.replace(REGION, PROMPT_TOKEN);
}

/** As submitted: a region becomes its words, the bare placeholder is KEPT for the API, any
 *  other spelling is removed. */
export function submitEnhanced(prompt: string): string {
  return prompt
    .replace(REGION, (_m, words: string) => words.replace(ANY_TAG, ""))
    .replace(ANY_TAG, (m) => (m === PROMPT_TOKEN ? m : ""));
}

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
