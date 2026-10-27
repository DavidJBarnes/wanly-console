/**
 * The Settings editor for the captioner's prompt (console#555).
 *
 * The API owns every piece of default text (GET /settings returns each caption style's
 * prompt); nothing here restates any of it. What lives here is the
 * bookkeeping between three things that are easy to confuse:
 *
 *   draft     what is in the editor now. Pre-filled with the EFFECTIVE text, so you can see
 *             what you would be replacing.
 *   default   the built-in text the draft is compared against.
 *   override  what gets SAVED: "" whenever the draft is the default, so saving an untouched
 *             page never pins today's wording against a later improvement (the API applies the
 *             same rule; this keeps the request honest too).
 */

/** The text the editor starts from: the saved override, or the default it stands in for. */
export function effectiveText(override: string, defaultText: string): string {
  return override.trim() ? override : defaultText;
}

/**
 * Whether the draft differs from the default, i.e. whether it will be saved as an override.
 *
 * Whitespace at the ends is ignored, as the API does. An EMPTY draft is not "modified": the API
 * reads "" as "use the default", so that is what saving it would do.
 */
export function isModified(draft: string, defaultText: string): boolean {
  const d = draft.trim();
  return d !== "" && d !== defaultText.trim();
}

/** What to send as the setting: the draft, or "" when it is the default. */
export function overrideToSave(draft: string, defaultText: string): string {
  return isModified(draft, defaultText) ? draft : "";
}

/** Whether saving now would change the stored override. */
export function hasUnsavedChange(draft: string, defaultText: string, savedOverride: string): boolean {
  // A saved override equal to the default (stored before the API normalised it) means the
  // default, so compare meanings rather than raw strings.
  return overrideToSave(draft, defaultText).trim() !== overrideToSave(savedOverride, defaultText).trim();
}

/**
 * The caption draft after the detail-level dropdown changes.
 *
 * An unmodified draft follows the style, which is the point of pre-filling it: choosing "rich"
 * should show what rich asks for. A modified one is the user's own text and wins over any
 * style, so it is left alone.
 */
export function draftAfterStyleChange(draft: string, oldDefault: string, newDefault: string): string {
  return isModified(draft, oldDefault) ? draft : newDefault;
}

/** A length problem against the API's cap, or null. */
export function lengthProblem(text: string, max: number): string | null {
  return text.length > max ? `${text.length} characters; the limit is ${max}.` : null;
}

export interface TryDraft {
  captionStyle: string;
  captionDraft: string;
  captionDefault: string;
}

export interface TryBody {
  caption_style?: string;
  caption_instruction?: string;
}

/**
 * The POST /images/scene/try body for the editors' CURRENT text.
 *
 * Every field is sent, because omitting one means "the saved value" to the API, and the point
 * of this column is the page as it stands. A draft equal to the default goes as "", which the
 * API reads as "the default", the same thing saving it would do.
 */
export function draftTryBody(d: TryDraft): TryBody {
  return {
    caption_style: d.captionStyle,
    caption_instruction: overrideToSave(d.captionDraft, d.captionDefault),
  };
}

export interface SavedPrompts {
  captionStyle: string;
  captionOverride: string;
}

/**
 * Whether the current text would produce the same prompts as the saved settings, in which
 * case the "saved" column would be a second, identical captioner call and is skipped.
 *
 * Compared as the API would resolve them: an override wins over the style, so two different
 * styles under the same override are the same prompt.
 */
export function draftMatchesSaved(body: TryBody, saved: SavedPrompts): boolean {
  const caption = body.caption_instruction ?? "";
  return caption.trim() || saved.captionOverride.trim()
    ? caption.trim() === saved.captionOverride.trim()
    : body.caption_style === saved.captionStyle;
}

/** An s3:// path the try endpoint will accept, or an explanation. */
export function imagePathProblem(path: string): string | null {
  const p = path.trim();
  if (!p) return "Choose an image or paste its s3:// path.";
  if (!/^s3:\/\/[^/]+\/.+/.test(p)) return "That is not an s3:// path (s3://bucket/key).";
  return null;
}
