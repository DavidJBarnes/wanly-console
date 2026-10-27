/**
 * The `<SCENE>` placeholder and the filled region that replaces it (console#427).
 *
 * A pose's prompt is start-frame-agnostic by design, so it defers the frame-specific part to
 * a placeholder: `<SCENE>` for what the frame IS. Filling it in used to be a one-way paste:
 * the placeholder was replaced with bare text and the one thing worth keeping -- WHICH WORDS
 * CAME FROM THE CAPTIONER -- was gone. Getting a different description then meant
 * hand-editing the sentence back out of the prompt.
 *
 * So a filled scene stays marked:
 *
 *   template   k3llydw, <SCENE>, she grips the edge of the sofa
 *   filled     k3llydw, <scene>a woman in a red dress on a sofa</scene>, she grips...
 *   submitted  k3llydw, a woman in a red dress on a sofa, she grips...
 *
 * A marked region is rewritable in place: re-describe, or change the start frame, and only
 * the inside changes. Text typed inside it survives until the next explicit replace.
 *
 * AN UNFILLED PLACEHOLDER IS SUBMITTED AS-IS (console#577). A filled region is unwrapped to
 * its words at submit, but a bare `<SCENE>` goes to the API untouched: that placeholder is
 * how the API knows the render needs a scene caption, and it holds the segment
 * (`awaiting_caption`, wanly-api caption_hold) until the words are saved, then fills them in
 * verbatim. The API is what keeps a literal placeholder away from the text encoder: it fills
 * it, or refuses to hand the segment out.
 *
 * Any OTHER marker spelling -- an unpaired `<scene>`, `<Scene>` -- is not a placeholder the
 * API recognises and would reach the encoder as garbage, so it is stripped.
 *
 * The PAIRED form is matched first and the leftover bare token is the placeholder. That
 * pairing, not letter case, is what tells them apart: `<scene>` opening a region and
 * `<SCENE>` standing alone are otherwise the same string in different clothes.
 *
 * THE MOTION HALF IS GONE (wanly-api#481). Older pose templates still carry a `<MOTION>`
 * placeholder, and a prompt filled before the removal can carry a `<motion>…</motion>`
 * region. Nothing will ever fill `<MOTION>` again, so submitting it would either hold the
 * render forever or put the literal token in front of the text encoder. Both spellings are
 * scrubbed at submit: a bare/stray motion tag is removed, and a filled motion region is
 * removed WORDS AND ALL -- they came from the retired half, and wanly-api#482 drops them the
 * same way. The separator either leaves behind is tidied.
 */

/** Which half of the description. Only the scene half remains (wanly-api#481). */
export type CaptionHalf = "scene";

export const HALVES: readonly CaptionHalf[] = ["scene"] as const;

/** The unfilled placeholder, as a pose template carries it. */
export const SCENE_TOKEN = "<SCENE>";

/** The placeholder for a half, e.g. `<SCENE>`. */
export function placeholderToken(half: CaptionHalf): string {
  return `<${half.toUpperCase()}>`;
}

/** A filled region: `<scene>…</scene>`, non-greedy so two regions never merge into one. */
function regionRe(half: CaptionHalf, flags = "gi"): RegExp {
  return new RegExp(`<${half}>([\\s\\S]*?)<\\/${half}>`, flags);
}

/** The bare token in either case, once the paired form has been dealt with. */
function bareRe(half: CaptionHalf): RegExp {
  return new RegExp(`<\\/?${half}>`, "gi");
}

/** Is there a filled region of this half to rewrite? */
export function hasRegion(prompt: string, half: CaptionHalf): boolean {
  return regionRe(half, "i").test(prompt);
}

/** Is there still an unfilled placeholder for this half? */
export function hasPlaceholder(prompt: string, half: CaptionHalf): boolean {
  return prompt.replace(regionRe(half), "").search(bareRe(half)) !== -1;
}

/** Does this prompt want this half at all — filled or not? */
export function wants(prompt: string, half: CaptionHalf): boolean {
  return hasPlaceholder(prompt, half) || hasRegion(prompt, half);
}

/** Wrap a description as a filled region of this half. */
export function captionRegion(half: CaptionHalf, description: string): string {
  return `<${half}>${description.trim()}</${half}>`;
}

/**
 * Put `description` into the prompt as this half.
 *
 * Rewrites an existing region if there is one, otherwise fills the placeholder. Both, in
 * that order, so a prompt that somehow carries a region AND a stray token ends up with one
 * description rather than two — and so re-describing an already-filled prompt replaces the
 * words instead of appending a second copy.
 */
export function fill(prompt: string, half: CaptionHalf, description: string): string {
  const filled = captionRegion(half, description);
  if (hasRegion(prompt, half)) {
    let first = true;
    return prompt.replace(regionRe(half), () => {
      // Only the first region is the description. A second one is not something any code
      // path produces, and duplicating the words into it would be worse than leaving it.
      if (!first) return "";
      first = false;
      return filled;
    });
  }
  return prompt.replace(bareRe(half), filled);
}

/** What the user typed inside this half's region, or null if there is no region. */
export function regionText(prompt: string, half: CaptionHalf): string | null {
  const m = regionRe(half, "i").exec(prompt);
  return m ? m[1] : null;
}

/**
 * Every scene marker in one pattern: a filled region or a bare/stray tag, any case. Motion
 * markers are matched too, as legacy markers to drop (wanly-api#481): a filled motion region
 * as a whole (group 2), else a bare/stray motion tag (group 3).
 */
const ANY_MARKER =
  /<scene>([\s\S]*?)<\/scene>|(<motion>[\s\S]*?<\/motion>)|<\/?scene>|(<\/?motion>)/gi;

/** A marker of either name, any spelling -- for scrubbing the words inside a region. */
const ANY_TAG = /<\/?(?:scene|motion)>/gi;

/**
 * Tidy what removing a legacy motion marker leaves behind: the comma that introduced it, a
 * doubled comma, doubled spaces, a separator dangling at either end. Only run when a motion
 * marker was actually removed, so a prompt without one is never reformatted.
 */
function tidy(prompt: string): string {
  return prompt
    .replace(/[ \t]*,(?:[ \t]*,)+/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+,/g, ",")
    .replace(/^[\s,]+|[\s,]+$/g, "");
}

/**
 * The prompt as it is submitted (console#577).
 *
 *   filled region    `<scene>a woman</scene>`  ->  `a woman`
 *   placeholder      `<SCENE>`                 ->  KEPT, exactly as written
 *   stray spelling   `<scene>` alone, `<Scene>` ->  removed
 *   legacy motion    `<MOTION>`, `</motion>`    ->  removed, separators tidied (wanly-api#481)
 *   motion region    `<motion>she leans</motion>` -> removed WITH its words (wanly-api#482)
 *
 * The placeholder is kept because the API needs to see it: it is what makes the caption hold
 * fire and fill the saved words in at release.
 *
 * Markers typed INSIDE a region are scrubbed: they are not the description, and a canonical
 * `<SCENE>` there would otherwise be taken for a placeholder.
 */
export function submitPrompt(prompt: string): string {
  let sawMotion = false;
  const out = prompt.replace(ANY_MARKER, (
    match, words?: string, motionRegion?: string, motionTag?: string,
  ) => {
    if (motionRegion !== undefined || motionTag !== undefined) {
      sawMotion = true;
      return "";
    }
    if (words !== undefined) return words.replace(ANY_TAG, "");
    return match === SCENE_TOKEN ? match : "";
  });
  return sawMotion ? tidy(out) : out;
}

/**
 * Put the placeholder back where the region is. Used to ask "did the user edit the prompt?"
 *
 * Filling `<SCENE>` is not an edit of the recipe — it is the recipe working
 * as designed — so a prompt whose only difference from its template is a filled region must
 * compare EQUAL to that template. Without this the `edited` flag reads "prompt" on every
 * recipe render that auto-fills, which is exactly the signal that is supposed to mean
 * somebody changed the words.
 */
export function restorePlaceholders(prompt: string): string {
  return HALVES.reduce(
    (p, half) => p.replace(regionRe(half), placeholderToken(half)), prompt);
}
