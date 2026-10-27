/**
 * The Settings editors for the captioner's two prompts (console#555, console#573).
 *
 * The API owns every piece of default text (GET /settings returns each caption style's prompt
 * and the default motion instructions); nothing here restates any of it. What lives here is the
 * bookkeeping between three things that are easy to confuse:
 *
 *   draft     what is in the editor now. Pre-filled with the EFFECTIVE text, so you can see
 *             what you would be replacing.
 *   default   the built-in text the draft is compared against.
 *   override  what gets SAVED: "" whenever the draft is the default, so saving an untouched
 *             page never pins today's wording against a later improvement (the API applies the
 *             same rule; this keeps the request honest too).
 *
 * Both editors hold plain sentences only (console#573). The motion prompt used to be a template
 * with {scene}, {style} and {#scene}…{/scene}; the API now adds the capture-style sentence and
 * the scene grounding itself, so there is no syntax to validate or warn about here.
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

/**
 * The motion override to send, or undefined to leave the saved one alone.
 *
 * A pre-#555 whole prompt (`legacy`) is still in force until the motion prompt is saved, and
 * the editor is pre-filled with it so you can see it. Saving the page for some other reason
 * must not quietly turn it into instructions -- which would wrap it in a style sentence and
 * the grounding and change what the captioner reads -- so while the draft is still that text,
 * nothing is sent for it.
 */
export function motionToSend(draft: string, defaultText: string, legacy: string): string | undefined {
  if (legacy.trim() && draft.trim() === legacy.trim()) return undefined;
  return overrideToSave(draft, defaultText);
}

/** Whether saving now would change the stored motion override. */
export function motionHasUnsavedChange(
  draft: string, defaultText: string, savedOverride: string, legacy: string,
): boolean {
  if (legacy.trim()) return motionToSend(draft, defaultText, legacy) !== undefined;
  return hasUnsavedChange(draft, defaultText, savedOverride);
}

export interface TryDraft {
  captionStyle: string;
  captionDraft: string;
  captionDefault: string;
  motionStyle: string;
  motionDraft: string;
  motionDefault: string;
  /** A pre-#555 whole prompt still in force, or "". */
  motionLegacy: string;
}

export interface TryBody {
  caption_style?: string;
  caption_instruction?: string;
  motion_style?: string;
  motion_instruction?: string;
}

/**
 * The POST /images/scene/try body for the editors' CURRENT text.
 *
 * Every field is sent, because omitting one means "the saved value" to the API, and the point
 * of this column is the page as it stands. A draft equal to the default goes as "", which the
 * API reads as "the default", the same thing saving it would do. The one omission is the
 * motion draft while it is still a legacy whole prompt: omitted is how the API is told to use
 * that prompt, exactly as saving the page would leave it.
 */
export function draftTryBody(d: TryDraft): TryBody {
  const body: TryBody = {
    caption_style: d.captionStyle,
    caption_instruction: overrideToSave(d.captionDraft, d.captionDefault),
    motion_style: d.motionStyle,
  };
  const motion = motionToSend(d.motionDraft, d.motionDefault, d.motionLegacy);
  if (motion !== undefined) body.motion_instruction = motion;
  return body;
}

export interface SavedPrompts {
  captionStyle: string;
  captionOverride: string;
  motionStyle: string;
  /** The saved motion instructions ("" = the default). */
  motionOverride: string;
  /** A pre-#555 whole prompt in force, or "". */
  motionLegacy: string;
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
  const sameCaption = caption.trim() || saved.captionOverride.trim()
    ? caption.trim() === saved.captionOverride.trim()
    : body.caption_style === saved.captionStyle;
  // Omitted means "the saved motion prompt", whatever it is. Otherwise compare the text; the
  // API adds the style sentence to any instructions, so the motion style always matters.
  // Any text sent while a legacy whole prompt is saved replaces it, so it cannot match.
  const sameMotion = (body.motion_instruction === undefined
    || (!saved.motionLegacy.trim()
      && body.motion_instruction.trim() === saved.motionOverride.trim()))
    && body.motion_style === saved.motionStyle;
  return sameCaption && sameMotion;
}

/** An s3:// path the try endpoint will accept, or an explanation. */
export function imagePathProblem(path: string): string | null {
  const p = path.trim();
  if (!p) return "Choose an image or paste its s3:// path.";
  if (!/^s3:\/\/[^/]+\/.+/.test(p)) return "That is not an s3:// path (s3://bucket/key).";
  return null;
}

/** Whether text in the finder box is really a pasted s3:// path, to be used as the image. */
export function looksLikeS3Path(text: string): boolean {
  return imagePathProblem(text) === null;
}

/** An image in a repo listing: all the finder needs to show and choose one. */
export interface FinderImage {
  path: string;
  filename: string;
  last_modified: string;
}

/**
 * The most recent repo images, for the finder's empty-box state (console#573).
 *
 * There is no "recent images" endpoint and /images/search refuses an empty query (an
 * unfiltered search is the folder listing), so this IS the folder listing: GET /images/folders
 * comes back newest folder first, and the newest few folders are opened until `limit` images
 * are in hand. Newest image first across them, because a folder's own listing is in key order.
 * `maxFolders` bounds the requests when the newest folders are nearly empty.
 */
export async function recentRepoImages<T extends FinderImage>(
  folderNames: string[],
  listFolder: (name: string) => Promise<T[]>,
  limit: number,
  maxFolders = 3,
): Promise<T[]> {
  const found: T[] = [];
  for (const name of folderNames.slice(0, maxFolders)) {
    found.push(...(await listFolder(name)));
    if (found.length >= limit) break;
  }
  return found
    .sort((a, b) => b.last_modified.localeCompare(a.last_modified))
    .slice(0, limit);
}

/** What the finder says when there are no thumbnails to show, or null when there are. */
export function finderEmptyMessage(query: string, hits: FinderImage[] | null): string | null {
  if (hits === null || hits.length > 0) return null;
  const q = query.trim();
  return q ? `No images match “${q}”.` : "The image repo has no images yet.";
}
