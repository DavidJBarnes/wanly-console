/**
 * What a character IS, since a character can be a LoRA, a character sheet, or both
 * (console#581 / #579).
 *
 * Phase 0 (wanly-gpu-docker#155) showed a 1536x1024 character sheet, conditioned into the
 * render, holding identity better than the LoRA alone. So a character row now carries an
 * optional sheet (and an optional face close-up) beside an optional LoRA. These helpers are
 * the one place the console decides "does it have a LoRA", "what fills <TRIGGER>", what the
 * list's badges say, and what the job form tells you — pure, so vitest can hold them.
 */
import type { Character, CharacterDraft } from "../api/ltx";
import type { Gender } from "../api/types";

/** The layout the CharacterSheet LoRA was trained on. Anything else still renders. */
export const SHEET_WIDTH = 1536;
export const SHEET_HEIGHT = 1024;

type IdentityFields = Pick<Character, "char_lora"> &
  Partial<Pick<Character, "sheet_uri" | "face_ref_uri" | "identity_mode">>;

/** NULL and the legacy "none" (a character registered before it trained) are both no LoRA. */
export function hasLora(charLora: string | null | undefined): boolean {
  const n = (charLora ?? "").trim().toLowerCase();
  return n !== "" && n !== "none";
}

/** Which reference renders: the explicit mode, else the sheet, else the face, else none.
 *  Mirrors the API's default so the console never shows one and renders the other. */
export function referenceMode(c: IdentityFields): "sheet" | "face" | null {
  if (c.identity_mode === "sheet" && c.sheet_uri) return "sheet";
  if (c.identity_mode === "face" && c.face_ref_uri) return "face";
  if (c.sheet_uri) return "sheet";
  if (c.face_ref_uri) return "face";
  return null;
}

export type IdentityBadge = "LoRA" | "Sheet" | "Face";

/** The list's badges: LoRA, Sheet (or Face, for a face-only reference), or both. */
export function identityBadges(c: IdentityFields): IdentityBadge[] {
  const out: IdentityBadge[] = [];
  if (hasLora(c.char_lora)) out.push("LoRA");
  if (c.sheet_uri) out.push("Sheet");
  else if (c.face_ref_uri) out.push("Face");
  return out;
}

/** What fills <TRIGGER>: the trigger phrase ("p@yton, woman") when there is a trigger, else
 *  the character's description, else "" — which renderPrompt tidies away with its comma. A
 *  sheet-only character has no trigger: there is no LoRA caption to match. The API fills a
 *  placeholder that reaches it by the same rule. */
export function fillPhrase(c: {
  trigger?: string | null;
  gender?: Gender | null;
  description?: string | null;
}): string {
  if (c.trigger) return c.gender ? `${c.trigger}, ${c.gender}` : c.trigger;
  return (c.description ?? "").trim();
}

/** One line for the job form: what this render will carry the identity with. */
export function identityStatus(c: IdentityFields | null, useRef: boolean): string {
  if (!c) return "";
  const lora = hasLora(c.char_lora);
  const mode = referenceMode(c);
  const ref = mode === "sheet" ? "character sheet" : mode === "face" ? "face reference" : null;
  if (!ref) {
    return lora ? "Identity: LoRA only — this character has no character sheet."
      : "Identity: none — no LoRA and no character sheet.";
  }
  if (!useRef) {
    return lora ? `Identity: LoRA only — the ${ref} is turned off for this job.`
      : `Identity: NONE — this character has no LoRA, and its ${ref} is turned off. `
        + "The render will not be this person.";
  }
  return lora ? `Identity: LoRA + ${ref}.` : `Identity: ${ref} only (no LoRA).`;
}

/** What the job create sends for `use_identity_ref`: nothing when the character has no
 *  reference (the API default then means nothing either), else the toggle. */
export function identityRefToSend(
  c: IdentityFields | null, useRef: boolean,
): boolean | undefined {
  if (!c || !referenceMode(c)) return undefined;
  return useRef;
}

/** A warning for a sheet that is not the trained layout, or null when it is. Never blocks:
 *  a different layout is a quality question, not an error. */
export function sheetSizeWarning(width: number, height: number): string | null {
  if (width === SHEET_WIDTH && height === SHEET_HEIGHT) return null;
  return `This sheet is ${width}×${height}. The CharacterSheet LoRA was trained on `
    + `${SHEET_WIDTH}×${SHEET_HEIGHT} sheets — other layouts render, but were not tested.`;
}

/** The character dialog's fields, as typed. */
export interface CharacterForm {
  name: string;
  lora: string;
  trigger: string;
  gender: "" | Gender;
  s1: string;
  s2: string;
  sheetUri: string;
  faceRefUri: string;
  identityMode: "" | "sheet" | "face";
  description: string;
}

export function formFor(c: Character | null): CharacterForm {
  return {
    name: c?.name ?? "",
    lora: hasLora(c?.char_lora) ? c!.char_lora! : "",
    trigger: c?.trigger ?? "",
    gender: c?.gender ?? "",
    s1: String(c?.strength_stage_1 ?? 0.8),
    s2: String(c?.strength_stage_2 ?? 1.5),
    sheetUri: c?.sheet_uri ?? "",
    faceRefUri: c?.face_ref_uri ?? "",
    identityMode: c?.identity_mode ?? "",
    description: c?.description ?? "",
  };
}

/** Why the form cannot be saved, or null. At least one of a LoRA or a character sheet is
 *  required; strengths only matter — and are only checked — when there is a LoRA. A
 *  character registered for training (LoRA "none", no sheet) can still be edited. */
export function formError(f: CharacterForm, original: Character | null): string | null {
  if (!f.name.trim()) return "A character needs a name.";
  const registeredOnly = original !== null && !hasLora(original.char_lora)
    && !original.sheet_uri && !original.face_ref_uri;
  if (!f.lora.trim() && !f.sheetUri && !registeredOnly) {
    return "Choose a LoRA, a character sheet, or both.";
  }
  if (f.lora.trim()) {
    // Number("") is 0, and a strength of 0 is a LoRA that loads and does nothing: the
    // render costs its ten minutes and comes back as the base model. Caught here.
    const n1 = Number(f.s1);
    const n2 = Number(f.s2);
    if (!Number.isFinite(n1) || !Number.isFinite(n2) || n1 <= 0 || n2 <= 0) {
      return "Both strengths must be numbers greater than 0.";
    }
  }
  if (f.identityMode === "face" && !f.faceRefUri) return "Choose a face reference to use it.";
  return null;
}

/**
 * The request body for the form. Create sends what is set; update also sends what was
 * CLEARED (null), so removing a sheet or the LoRA reaches the API.
 *
 * Trigger and gender are never sent for a trained (locked) character — the API refuses a
 * change, and "unchanged" is best said by not saying (#537). An empty trigger on update is
 * not sent either: absent means "leave it alone".
 */
export function draftFor(
  f: CharacterForm, original: Character | null, locked: boolean,
): Partial<CharacterDraft> {
  const lora = f.lora.trim();
  const sheet = f.sheetUri || null;
  const face = f.faceRefUri || null;
  const mode = f.identityMode || null;
  const description = f.description.trim() || null;
  const strengths = lora
    ? { strength_stage_1: Number(f.s1), strength_stage_2: Number(f.s2) } : {};
  if (!original) {
    return {
      name: f.name.trim(),
      ...(lora ? { char_lora: lora } : {}),
      // Absent means "no opinion": the API defaults it to the name for a LoRA character and
      // leaves a sheet-only one without.
      trigger: f.trigger.trim() || null,
      gender: f.gender || null,
      ...strengths,
      ...(sheet ? { sheet_uri: sheet } : {}),
      ...(face ? { face_ref_uri: face } : {}),
      ...(mode ? { identity_mode: mode } : {}),
      ...(description ? { description } : {}),
    };
  }
  const hadLora = hasLora(original.char_lora);
  return {
    name: f.name.trim(),
    // A LoRA chosen is sent; one REMOVED from a character that had one goes as null, which
    // the API allows only while a sheet remains. A registration with "none" is left alone.
    ...(lora ? { char_lora: lora } : hadLora ? { char_lora: null } : {}),
    ...(locked ? {} : {
      ...(f.trigger.trim() ? { trigger: f.trigger.trim() } : {}),
      gender: f.gender || null,
    }),
    ...strengths,
    sheet_uri: sheet,
    face_ref_uri: face,
    identity_mode: mode,
    description,
  };
}
