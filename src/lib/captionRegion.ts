/**
 * The `<SCENE>` / `<MOTION>` placeholders and the filled regions that replace them
 * (console#427, console#529).
 *
 * A pose's prompt is start-frame-agnostic by design, so it defers the frame-specific parts
 * to placeholders: `<SCENE>` for what the frame IS, `<MOTION>` for what happens next.
 * Filling one in used to be a one-way paste: the placeholder was replaced with bare text
 * and the one thing worth keeping — WHICH WORDS CAME FROM THE CAPTIONER — was gone. Getting
 * a different description then meant hand-editing the sentence back out of the prompt.
 *
 * So a filled half stays marked:
 *
 *   template   k3llydw, <SCENE>, she grips the edge of the sofa, <MOTION>
 *   filled     k3llydw, <scene>a woman in a red dress on a sofa</scene>, she grips...,
 *              <motion>she leans forward as the light shifts</motion>
 *   submitted  k3llydw, a woman in a red dress on a sofa, she grips..., she leans forward...
 *
 * A marked region is rewritable in place: re-describe, or change the start frame, and only
 * the inside changes. Text typed inside it survives until the next explicit replace.
 *
 * AN UNFILLED PLACEHOLDER IS SUBMITTED AS-IS (console#577). A filled region is unwrapped to
 * its words at submit, but a bare `<SCENE>`/`<MOTION>` goes to the API untouched: that
 * placeholder is how the API knows the render needs a caption half, and it holds the segment
 * (`awaiting_caption`, wanly-api caption_hold) until the words are saved, then fills them in
 * verbatim. Deleting it here -- which this module used to do -- made the hold impossible, and
 * a Motion recipe queued before its caption landed rendered with an EMPTY prompt. The API is
 * what keeps a literal placeholder away from the text encoder: it fills it, or refuses to
 * hand the segment out.
 *
 * Any OTHER marker spelling -- an unpaired `<scene>`, a stray `</motion>`, `<Scene>` -- is
 * not a placeholder the API recognises and would reach the encoder as garbage, so it is
 * stripped.
 *
 * The PAIRED form is matched first and the leftover bare token is the placeholder. That
 * pairing, not letter case, is what tells them apart: `<scene>` opening a region and
 * `<SCENE>` standing alone are otherwise the same string in different clothes.
 *
 * ONE module, two halves, with every pattern built from the half's own name so an opening
 * tag can only ever close with its own kind. `<scene>…</motion>` is not a region, and a
 * pattern that accepted either close would let an unclosed opener swallow everything up to
 * the next close of either kind — deleting the real words in between.
 */

/** Which half of the description. The two behave identically; only the name differs. */
export type CaptionHalf = "scene" | "motion";

export const HALVES: readonly CaptionHalf[] = ["scene", "motion"] as const;

/** The unfilled placeholder, as a pose template carries it. */
export const SCENE_TOKEN = "<SCENE>";
export const MOTION_TOKEN = "<MOTION>";

/** The placeholder for a half, e.g. `<MOTION>`. */
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
 * Every marker in one pattern: a filled region (closing tag a backreference to its opener, so
 * `<scene>…</motion>` is never a region) or a bare/stray tag of either half, any case.
 */
const ANY_MARKER = /<(scene|motion)>([\s\S]*?)<\/\1>|<\/?(?:scene|motion)>/gi;

/** A marker of either half, any spelling -- for scrubbing the words inside a region. */
const ANY_TAG = /<\/?(?:scene|motion)>/gi;

/**
 * The prompt as it is submitted (console#577).
 *
 *   filled region    `<motion>she leans in</motion>`  ->  `she leans in`
 *   placeholder      `<SCENE>` / `<MOTION>`           ->  KEPT, exactly as written
 *   stray spelling   `<scene>` alone, `</motion>`     ->  removed
 *
 * The placeholder is kept because the API needs to see it: it is what makes the caption hold
 * fire and fill the saved words in at release. Dropping it made the API create the segment
 * PENDING with the half simply missing -- a Motion recipe went out with an empty prompt.
 *
 * One non-rescanning pass for both halves, so words unwrapped for one half can never be read
 * as the other half's marker. Markers typed INSIDE a region are scrubbed: they are not the
 * description, and a canonical `<MOTION>` there would otherwise be taken for a placeholder.
 */
export function submitPrompt(prompt: string): string {
  return prompt.replace(ANY_MARKER, (match, _half?: string, words?: string) => {
    if (words !== undefined) return words.replace(ANY_TAG, "");
    return match === SCENE_TOKEN || match === MOTION_TOKEN ? match : "";
  });
}

/**
 * Put the placeholders back where the regions are, for both halves. Used to ask "did the
 * user edit the prompt?"
 *
 * Filling `<SCENE>` or `<MOTION>` is not an edit of the recipe — it is the recipe working
 * as designed — so a prompt whose only difference from its template is a filled region must
 * compare EQUAL to that template. Without this the `edited` flag reads "prompt" on every
 * recipe render that auto-fills, which is exactly the signal that is supposed to mean
 * somebody changed the words.
 */
export function restorePlaceholders(prompt: string): string {
  return HALVES.reduce(
    (p, half) => p.replace(regionRe(half), placeholderToken(half)), prompt);
}
