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

/**
 * A DRAFT has neither a LoRA nor a sheet/face reference (console#592). It exists so Build
 * sheet has a character to make the first sheet for -- the sheet flow lives on an existing
 * character -- and it cannot render: the API refuses a job for it with draftMessage.
 *
 * A pair has no reference of its own and renders with its FIRST member's, so a pair with no
 * joint LoRA is a draft when that member (looked up in `all`) has no reference either.
 * Mirrors the API's character_registry.is_draft.
 */
export function isDraft(
  c: IdentityFields & Partial<Pick<Character, "kind" | "members">>,
  all: readonly (IdentityFields & Pick<Character, "name">)[] = [],
): boolean {
  if (hasLora(c.char_lora)) return false;
  if ((c.kind ?? "solo") === "pair") {
    const first = all.find((m) => m.name === c.members?.[0]);
    return !first || !referenceMode(first);
  }
  return !referenceMode(c);
}

/** What a draft says wherever it would render. The API's refusal reads the same. */
export function draftMessage(name: string): string {
  return `${name} has no LoRA or sheet yet: build a sheet or attach a LoRA.`;
}

/**
 * The job form's refusal for a draft (console#592), or null. What renders is the job's LoRA
 * (the slot's, which may differ from the character's) and the character's reference, so the
 * render is a draft when the character is one AND the slot carries no LoRA either -- the same
 * rule the API refuses the submit with.
 */
export function draftRenderProblem(
  c: (IdentityFields & Pick<Character, "name"> & Partial<Pick<Character, "kind" | "members">>)
    | null,
  slotLora: string | null | undefined,
  all: readonly (IdentityFields & Pick<Character, "name">)[] = [],
): string | null {
  if (!c || hasLora(slotLora) || !isDraft(c, all)) return null;
  return draftMessage(c.name);
}

export type IdentityBadge = "LoRA" | "Sheet" | "Face";

/** The list's badges: LoRA, Sheet (or Face, for a face-only reference), or both. None for a
 *  draft -- the list shows isDraft's own badge, which knows about pairs. */
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
      : "Identity: none — a draft, with no LoRA and no character sheet. It cannot render.";
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

/** Why the form cannot be saved, or null. Only a name is required: a character with neither
 *  a LoRA nor a sheet is a DRAFT (console#592), saved so Build sheet can make its first
 *  sheet (see formIsDraft). Strengths only matter — and are only checked — when there is
 *  a LoRA. */
export function formError(f: CharacterForm): string | null {
  if (!f.name.trim()) return "A character needs a name.";
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

/** True when the form, as typed, saves a draft: no LoRA, no sheet, no face reference. */
export function formIsDraft(f: CharacterForm): boolean {
  return !f.lora.trim() && !f.sheetUri && !f.faceRefUri;
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
      // leaves a sheet-only one, or a draft (console#592), without.
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
    // A LoRA chosen is sent; one REMOVED from a character that had one goes as null (with no
    // sheet left, the character becomes a draft). A registration with "none" is left alone.
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
