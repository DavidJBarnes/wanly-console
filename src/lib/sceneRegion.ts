/**
 * The `<SCENE>` placeholder and the filled region that replaces it (console#427).
 *
 * A pose's prompt is start-frame-agnostic by design, so it defers its static half to
 * `<SCENE>`. Filling that in used to be a one-way paste: the placeholder was replaced with
 * bare text and the one thing worth keeping — WHICH WORDS ARE THE SCENE — was gone. Getting
 * a different description then meant hand-editing the sentence back out of the prompt.
 *
 * So a filled scene stays marked:
 *
 *   template   k3llydw, <SCENE>, she grips the edge of the sofa...
 *   filled     k3llydw, <scene>a woman in a red dress on a sofa</scene>, she grips...
 *   submitted  k3llydw, a woman in a red dress on a sofa, she grips...
 *
 * The marked region is rewritable in place: re-describe, or change the start frame, and only
 * the inside changes. Text typed inside it survives until the next explicit replace.
 *
 * NEITHER FORM MAY REACH THE TEXT ENCODER. A literal placeholder is garbage tokens — the
 * same reason the API drops an unresolved `<SCENE>` rather than shipping it — so both are
 * stripped at submit, and the API strips them again on the way in.
 *
 * The PAIRED form is matched first and the leftover bare token is the placeholder. That
 * pairing, not letter case, is what tells them apart: `<scene>` opening a region and
 * `<SCENE>` standing alone are otherwise the same string in different clothes.
 */

/** The unfilled placeholder, as a pose template carries it. */
export const SCENE_TOKEN = "<SCENE>";

/** A filled region: `<scene>…</scene>`, non-greedy so two regions never merge into one. */
const REGION = /<scene>([\s\S]*?)<\/scene>/gi;
/** The bare token in either case, once the paired form has been dealt with. */
const BARE = /<\/?scene>/gi;

/** Is there a filled region to rewrite? */
export function hasSceneRegion(prompt: string): boolean {
  return new RegExp(REGION.source, "i").test(prompt);
}

/** Is there still an unfilled placeholder? */
export function hasScenePlaceholder(prompt: string): boolean {
  return prompt.replace(REGION, "").search(BARE) !== -1;
}

/** Wrap a description as a filled region. */
export function sceneRegion(description: string): string {
  return `<scene>${description.trim()}</scene>`;
}

/**
 * Put `description` into the prompt as the scene.
 *
 * Rewrites an existing region if there is one, otherwise fills the placeholder. Both, in
 * that order, so a prompt that somehow carries a region AND a stray token ends up with one
 * scene rather than two — and so re-describing an already-filled prompt replaces the words
 * instead of appending a second copy.
 */
export function fillScene(prompt: string, description: string): string {
  const region = sceneRegion(description);
  if (hasSceneRegion(prompt)) {
    let first = true;
    return prompt.replace(REGION, () => {
      // Only the first region is the scene. A second one is not something any code path
      // produces, and duplicating the description into it would be worse than leaving it.
      if (!first) return "";
      first = false;
      return region;
    });
  }
  return prompt.replace(BARE, region);
}

/** What the user typed inside the region, or null if there is no region. */
export function sceneRegionText(prompt: string): string | null {
  const m = new RegExp(REGION.source, "i").exec(prompt);
  return m ? m[1] : null;
}

/**
 * Remove the markers, keeping the words. What gets submitted.
 *
 * A leftover BARE token is dropped entirely rather than kept — it has no words in it, and
 * an unresolved placeholder reaching the encoder is exactly what this guards. The API drops
 * it too; doing it here as well means the stored prompt is the one that ran.
 */
export function stripSceneMarkers(prompt: string): string {
  return prompt.replace(REGION, "$1").replace(BARE, "");
}

/**
 * Put the placeholder back where the region is. Used to ask "did the user edit the prompt?"
 *
 * Filling `<SCENE>` is not an edit of the recipe — it is the recipe working as designed —
 * so a prompt whose only difference from its template is a filled scene must compare EQUAL
 * to that template. Without this the `edited` flag reads "prompt" on every recipe render
 * that auto-fills, which is exactly the signal that is supposed to mean somebody changed
 * the words.
 */
export function restoreScenePlaceholder(prompt: string): string {
  return prompt.replace(REGION, SCENE_TOKEN);
}
