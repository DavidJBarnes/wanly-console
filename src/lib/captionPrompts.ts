/**
 * The Settings editors for the captioner's two prompts (console#555).
 *
 * The API owns every piece of default text (GET /settings returns each caption style's prompt
 * and the default motion template); nothing here restates any of it. What lives here is the
 * bookkeeping between three things that are easy to confuse:
 *
 *   draft     what is in the editor now. Pre-filled with the EFFECTIVE text, so you can see
 *             what you would be replacing.
 *   default   the built-in text the draft is compared against.
 *   override  what gets SAVED: "" whenever the draft is the default, so saving an untouched
 *             page never pins today's wording against a later improvement (the API applies the
 *             same rule; this keeps the request honest too).
 */

/** The motion template's placeholders, exactly as wanly-api's renderer knows them. */
const KNOWN_PLACEHOLDERS = new Set(["scene", "style", "#scene", "/scene"]);
/** `{identifier}`, optionally `{#…}` / `{/…}`. Anything else in braces is literal text. */
const PLACEHOLDER = /\{([#/]?[A-Za-z_][A-Za-z0-9_]*)\}/g;

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

/**
 * Why wanly-api would refuse this motion template with a 422, or null if it would not.
 *
 * A mirror of `validate_motion_template`, so the editor can say so while you type rather than
 * on Save. The API stays the authority; if the two ever disagree, its message is shown.
 */
export function motionTemplateProblem(template: string): string | null {
  const tokens = [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
  const unknown = [...new Set(tokens.filter((t) => !KNOWN_PLACEHOLDERS.has(t)))].sort();
  if (unknown.length) {
    const list = unknown.map((t) => `{${t}}`).join(", ");
    return `Unknown placeholder${unknown.length > 1 ? "s" : ""} ${list}. `
      + "The motion prompt understands {scene}, {style} and {#scene}…{/scene}.";
  }
  let open = false;
  for (const t of tokens) {
    if (t === "#scene") {
      if (open) return "{#scene} sections cannot be nested: close the first with {/scene}.";
      open = true;
    } else if (t === "/scene") {
      if (!open) return "{/scene} has no matching {#scene} before it.";
      open = false;
    }
  }
  return open ? "{#scene} is never closed: add {/scene} where the section ends." : null;
}

/** A length problem against the API's cap, or null. */
export function lengthProblem(text: string, max: number): string | null {
  return text.length > max ? `${text.length} characters; the limit is ${max}.` : null;
}

/** Whether the grounding section is still in the template (the warning an edit can earn). */
export function keepsGrounding(template: string): boolean {
  return template.includes("{#scene}") || template.includes("{scene}");
}

export interface TryDraft {
  captionStyle: string;
  captionDraft: string;
  captionDefault: string;
  motionStyle: string;
  motionDraft: string;
  motionDefault: string;
}

export interface TryBody {
  caption_style?: string;
  caption_instruction?: string;
  motion_style?: string;
  motion_template?: string;
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
    motion_style: d.motionStyle,
    motion_template: overrideToSave(d.motionDraft, d.motionDefault),
  };
}

export interface SavedPrompts {
  captionStyle: string;
  captionOverride: string;
  motionStyle: string;
  motionOverride: string;
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
  const motion = body.motion_template ?? "";
  // {style} can appear in an override too, so the motion style always matters.
  const sameMotion = motion.trim() === saved.motionOverride.trim()
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
