import axios from "axios";
import { LOCAL_STORAGE_TOKEN_KEY } from "../constants";
import { mergeLoraOptions } from "../lib/loraOptions";
import type { Gender } from "./types";

/**
 * LTX 2.3 recipes.
 *
 * Recipes are DATA now — rows in wanly-api, created and edited here. The POC
 * authored them in an .ods, which was a test harness that became load-bearing;
 * the sheet does not come with them.
 *
 * Its own axios instance rather than the shared one from client.ts. This used to be
 * because the engine calls below must not carry the console's bearer token to another
 * host; those calls are gone (#395), but the separate instance stays — a 401 from a
 * recipe call still must not sign the user out of the console.
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  timeout: 60_000,
});
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * A POSE. Character-agnostic on purpose.
 *
 * Poses are not tied to a character — that shape locked new LoRAs out, because a
 * character with no rows had no recipes at all. Every pose is offered for every
 * character, so adding a LoRA costs a character row and nothing else.
 */
/** One motion/act LoRA in a pose's chain.
 *
 *  Per-stage strengths because stage 1 generates at half size from noise and stage 2 refines
 *  the 2x-upscaled latent. Both default to 0.6 — what the engine applied before any of this
 *  was configurable — so adding one and touching nothing renders at the validated strength.
 *  0 is meaningful: the LoRA loads and contributes nothing, which is how you measure it.
 */
export interface ContentLora {
  name: string;
  s1: number;
  s2: number;
}

export interface Pose {
  id: string;
  name: string;
  /** Contains TRIGGER_PLACEHOLDER, filled with the character's trigger word. */
  prompt_template: string;
  /** Already resolved: the pose's own override, or the Settings default. */
  negative_prompt: string;
  /** The pose's OWN override, unresolved. Null means it inherits the default.
   *
   *  Both are needed, and confusing them is the bug this field was added for
   *  (console#430): the editor used to bind to the resolved value, so saving an
   *  untouched pose wrote the default back as an override and pinned it forever. Every
   *  pose in production had been pinned that way, which is what kept the Settings
   *  negative prompt from ever being used. */
  negative_prompt_override: string | null;
  frames: number;
  /** Video CRF applied to the conditioning frame before it anchors the render. Null uses the
   *  global stack's value. 0 is meaningful — it bypasses the encode entirely. */
  img_compression: number | null;
  /** Motion/act LoRAs, chained ahead of the character LoRA (which is identity), IN THE
   *  ORDER GIVEN — order is part of the configuration, not incidental. Empty means none,
   *  which is what most poses do. */
  content_loras: ContentLora[];
  /** Base model this pose renders on. Already resolved: the pose's own value or the
   *  stack's, which is 10Eros_v1.5_bf16 since console#431. Character LoRAs were trained
   *  against sulphur — on any other base, the default included, a LoRA can fuse nothing at
   *  all, silently, and the render comes back without the character. The engine logs its
   *  fusion count per render, which is what makes that visible. */
  checkpoint: string;
  /** The BOOK this pose is filed in (wanly-api#320). Poses stopped being one flat list:
   *  a book is a shelf of poses that belong together, and names are unique per book rather
   *  than globally. */
  book_id: string;
  /** The book's name, denormalised onto the pose so a grouped picker can render headings
   *  from the pose list alone. */
  book_name: string;
  /** THE default pose, preselected by the New Job and Next Segment modals (console#543).
   *  At most one is true. Absent from an API that predates it. */
  is_default?: boolean;
}

export interface Character {
  id: string;
  name: string;
  /** Null (or the legacy "none") is no LoRA: a sheet-only character, or one registered
   *  before it trained. See lib/characterIdentity hasLora. */
  char_lora: string | null;
  /** Fills a pose's placeholder. Null for a sheet-only character (console#581), whose
   *  placeholder fills from `description` instead. */
  trigger: string | null;
  /** The other half of the caption the LoRA trained on (console#487). Null for a
   *  character that predates the trainer: it renders the bare trigger as before. */
  gender?: Gender | null;
  /** Per-stage, never flat. Stage 1 decides body and anatomy; stage 2 resolves
   *  the face. 0.8/1.5 is the validated pair. */
  strength_stage_1: number;
  strength_stage_2: number;
  /** A face for the LoRA: the anchor image of the dataset that trained it. */
  image_uri?: string | null;
  /** Which datasets trained this LoRA (migration 099), group order. Snapshotted at
   *  publish, so a later rename does not rewrite what trained. Null for characters that
   *  predate it. */
  trained_from?: { dataset_id: string | null; name: string | null; count: number }[] | null;
  /** A solo character is one person; a pair is its own row trained on both members, with the
   *  joined trigger phrase (#537). Null on rows that predate it — they are solo. */
  kind?: "solo" | "pair" | null;
  /** A pair's member character names. Null for a solo character. */
  members?: string[] | null;
  /** The base model its current LoRA trained on. */
  base_checkpoint?: string | null;
  /** THE default character, preselected like the default pose (console#543). */
  is_default?: boolean;
  /** The identity reference (console#581, wanly-api#379): an Image Repo s3:// URI for the
   *  1536x1024 character sheet and/or a face close-up, and which of them renders. */
  sheet_uri?: string | null;
  face_ref_uri?: string | null;
  identity_mode?: "sheet" | "face" | null;
  /** A few words that fill <TRIGGER> when there is no trigger. */
  description?: string | null;
}

/** What fills a placeholder: the trigger AND the word its LoRA bound it to, exactly as
 *  the training caption read — "p@yton, woman". With two identity LoRAs summed into the
 *  same weights this pair is the only thing that says which face goes on which body
 *  (console#487). No trigger is the "no character" slot and never grows a gender; no
 *  gender is the bare trigger, which is what every character rendered before. */
export function triggerPhrase(c: { trigger: string | null; gender?: Gender | null }): string {
  if (!c.trigger || !c.gender) return c.trigger ?? "";
  return `${c.trigger}, ${c.gender}`;
}

/** What a pose carries and a character's trigger fills. */
export const TRIGGER_PLACEHOLDER = "<TRIGGER>";
/** One placeholder. A list so the slot-order shape stays familiar to older callers. */
export const TRIGGER_PLACEHOLDERS = [TRIGGER_PLACEHOLDER] as const;

/** Fill a pose's <TRIGGER> with the character's trigger phrase.
 *
 *  The API does this too, before wildcard resolution — doing it here as well
 *  means the user SEES the prompt that will actually render rather than a
 *  template, which matters because the prompt is editable. A single string is the
 *  shorthand; a list (older callers) takes its first entry. No trigger leaves the
 *  placeholder in place.
 *
 *  ONE person per render, always, since the joint LoRA (wanly-api#102): its trigger phrase
 *  carries every caption pair and lands WHOLE in the one placeholder; the scene text names
 *  who is who. The two-person slot (<TRIGGER2>) was removed along with its split. */
export function renderPrompt(template: string, triggers: string | (string | undefined)[] | undefined): string {
  const first = typeof triggers === "string" ? triggers : triggers?.[0];
  let out = template;
  let tidy = false;
  if (first !== undefined) {
    out = out.split(TRIGGER_PLACEHOLDER).join(first);
    if (!first) tidy = true;
  }
  if (!tidy) return out;
  // An EMPTY trigger is the "no character" case (console#412): the pose renders on the base
  // model alone, so there is no token to name anyone. Substituting "" leaves the comma that
  // followed it — ", a woman kneeling in front of..." — which reaches the text encoder as a
  // leading empty clause. Tidy it, the same way the API tidies a dropped <SCENE>.
  return out.replace(/^\s*,\s*/, "").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();
}

/**
 * The "no character" option in the Character dropdown.
 *
 * Renders the pose on the base model alone — which is how you judge what a character LoRA is
 * actually contributing, and what you want for a shot whose start frame already carries the
 * identity.
 *
 * A sentinel rather than `null` because the form uses a character for six things: the
 * trigger, the LoRA, both strengths, the job name and the recorded blob. Threading `null`
 * through all of them would mean six conditionals; one object with honest values means none.
 *
 * char_lora "none" is understood the whole way down — the daemon filters it in any casing
 * and the engine's want_char has always excluded it.
 */
export const NO_CHARACTER: Character = {
  id: "",
  name: "none",
  char_lora: "none",
  trigger: "",
  strength_stage_1: 0,
  strength_stage_2: 0,
};

/** The one global configuration, the same for every pose and character. */
export interface LtxStack {
  checkpoint: string;
  content_lora: string;
  distill: string;
  distill_stage_1: number;
  distill_stage_2: number;
  frames: number;
  frame_rate: number;
  steps_stage_1: number;
  sigmas_stage_2: string;
  cfg: number;
  stg: number;
  rescale: number;
  stg_blocks: string;
  negative: string;
}

/**
 * A BOOK: a named shelf of poses (wanly-api#320).
 *
 * Not to be confused with RecipeCatalog, which is the whole `GET /recipes` payload and used
 * to carry this name. `recipe_count` is assembled by the API rather than stored, so the
 * console can grey out a delete before the API's 409 answers.
 *
 * `created_at` is present on `GET /ltx/books` but absent from the `books` list folded into
 * `GET /recipes`, which is why it is optional.
 */
export interface Book {
  id: string;
  name: string;
  description: string | null;
  /** How many poses are filed here. */
  recipe_count: number;
  created_at?: string;
}

/** The whole `GET /recipes` payload: the stack, the settings default, and every pose and
 *  character. Named "catalog" because it is not one book — books are shelves within it. */
export interface RecipeCatalog {
  stack: LtxStack;
  /** What a pose with no override of its own renders with: the Settings negative prompt,
   *  or the stack's built-in when that is blank. Shown as the editor's placeholder, so
   *  "inherits" is visible without being typed into the field. */
  default_negative_prompt: string;
  /** The shelves, so a picker can group without a second call. */
  books: Book[];
  /** Every pose, available to every character. */
  poses: Pose[];
  characters: Character[];
}

export async function listRecipes(bookId?: string): Promise<RecipeCatalog> {
  const { data } = await api.get<RecipeCatalog>("/recipes", {
    params: bookId ? { book_id: bookId } : undefined,
  });
  return data;
}

/**
 * Character LoRAs to offer.
 *
 * Two sources, unioned, because neither alone is right. The book names every
 * LoRA in use and is reachable everywhere. The engine knows what is ACTUALLY on
 * disk — including checkpoints being evaluated that no recipe references yet —
 * Union of the bucket and the book. The bucket supplies LoRAs not yet used by any
 * character — the entire point of the dropdown — while the book keeps a character's
 * OWN LoRA on the list even if the file has since left the bucket, so opening its edit
 * dialog cannot silently blank the field and save the blank back.
 *
 * A failure here propagates rather than returning []: an empty list renders as a free
 * text field, which looks like a working form and is how a typo'd LoRA name reaches a
 * worker. Better to show the error.
 */
/** One object in the LoRA bucket. `name` is the bare filename; `kind` is its shelf. */
export interface LoraObject {
  name: string;
  kind: string;
  key: string;
  size: number;
  etag: string;
  multipart: boolean;
  uri: string;
}

export async function listLoraObjects(): Promise<LoraObject[]> {
  const { data } = await api.get<LoraObject[]>("/loras");
  return data;
}

/**
 * LoRA names to offer, for one KIND.
 *
 * The two kinds answer different questions and are never interchangeable: `character` is
 * WHO (identity, chosen on a character row), `content` is WHAT IS HAPPENING (motion/act,
 * chosen on a recipe). Offering one where the other belongs produces a render that
 * succeeds and is wrong, so the filter is not cosmetic.
 *
 * The bucket is the source of truth because it is the same list a worker syncs from: what
 * you can PICK is what a worker can FETCH. This used to ask ltx-engine, which only answers
 * in dev — from the deployed console that call always failed and the list fell back to
 * LoRAs that were ALREADY characters, so you could only pick what you already had.
 */
export async function listLoras(
  catalog: RecipeCatalog | null,
  kind: "character" | "content" = "character",
): Promise<string[]> {
  const objs = await listLoraObjects();
  // Only character LoRAs union with the catalog: a character's own char_lora must stay
  // pickable even once its file leaves the bucket, but that has no meaning for content.
  // A sheet-only character has no LoRA (null) and contributes nothing here (console#581).
  const fromBook = kind === "character"
    ? (catalog?.characters ?? []).flatMap((c) => (c.char_lora ? [c.char_lora] : []))
    : [];
  return mergeLoraOptions(
    fromBook,
    objs.filter((o) => o.kind === kind).map((o) => o.name),
  );
}

/**
 * Base models a pose can be rendered on.
 *
 * The union of what LIVE workers report, not a list held anywhere. A checkpoint is a 46 GB
 * file on a GPU box, so whether one is loadable is a fact about that box — and the engine
 * binds to localhost, so workers report it through their heartbeat.
 *
 * Offline workers are excluded deliberately: offering a checkpoint that exists only on a box
 * which is not running produces a job nothing can claim, which is a queue that silently
 * stops rather than an error.
 */
export async function listCheckpoints(): Promise<{ checkpoints: string[]; default: string }> {
  const { data } = await api.get<{ checkpoints: string[]; default: string }>("/ltx/checkpoints");
  return data;
}

export function ltxError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d.map((x) => `${(x.loc ?? []).slice(1).join(".")}: ${x.msg}`).join("; ");
    }
    if (err.response?.status === 401) return "Not signed in, or the session expired.";
    if (!err.response) return "No response from the API.";
    return `${err.response.status} ${err.response.statusText}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------------------
// Authoring poses and characters (console#361)
//
// Recipes became rows in wanly-api#212 so they could change without a spreadsheet or a
// migration. Until these existed the only way to add a pose or a character was SQL, which
// mattered most for characters: a character is a LoRA plus a trigger, and it is what makes
// every pose available to a newly trained LoRA.
// ---------------------------------------------------------------------------------------

export interface PoseDraft {
  name: string;
  prompt_template: string;
  negative_prompt?: string | null;
  frames?: number | null;
  img_compression?: number | null;
  /** Null clears the override and the pose falls back to the stack, which is "none". */
  /** An empty array CLEARS them; undefined leaves them alone. */
  content_loras?: ContentLora[] | null;
  /** Null clears the override and the pose falls back to the stack. */
  checkpoint?: string | null;
  /** The book to file this pose in. Omitted on create, the API defaults it to the default
   *  book ("10eros"); an unknown id is a 404. */
  book_id?: string | null;
}

export async function createPose(draft: PoseDraft): Promise<Pose> {
  const { data } = await api.post<Pose>("/ltx/recipes", draft);
  return data;
}

export async function updatePose(id: string, patch: Partial<PoseDraft>): Promise<Pose> {
  const { data } = await api.patch<Pose>(`/ltx/recipes/${id}`, patch);
  return data;
}

export async function deletePose(id: string): Promise<void> {
  await api.delete(`/ltx/recipes/${id}`);
}

/** Star or unstar THE default pose (console#543). Starring clears the previous default in
 *  the same transaction; unstarring leaves no default, which is a valid state. */
export async function setDefaultPose(id: string, isDefault: boolean): Promise<Pose> {
  const path = `/ltx/recipes/${id}/default`;
  const { data } = isDefault ? await api.post<Pose>(path) : await api.delete<Pose>(path);
  return data;
}

export interface BookDraft {
  name: string;
  /** Null clears it. */
  description?: string | null;
}

export async function createBook(draft: BookDraft): Promise<Book> {
  const { data } = await api.post<Book>("/ltx/books", draft);
  return data;
}

export async function updateBook(id: string, patch: Partial<BookDraft>): Promise<Book> {
  const { data } = await api.patch<Book>(`/ltx/books/${id}`, patch);
  return data;
}

/** Refuses with a 409 while the book still holds poses; the API's message names how many. */
export async function deleteBook(id: string): Promise<void> {
  await api.delete(`/ltx/books/${id}`);
}

export interface CharacterDraft {
  name: string;
  /** Absent for a character registered before it has trained (#537): the trigger and gender
   *  come first, and the LoRA arrives when the run publishes. Null removes the LoRA, which
   *  the API allows only while a character sheet or face reference remains (console#581). */
  char_lora?: string | null;
  kind?: "solo" | "pair";
  /** Optional on create only — the API defaults it to the name. */
  trigger?: string | null;
  /** Null clears it: a LoRA that trained on a bare caption should not render one. */
  gender?: Gender | null;
  strength_stage_1?: number;
  strength_stage_2?: number;
  image_uri?: string | null;
  /** The identity reference (console#581). Null clears on update. */
  sheet_uri?: string | null;
  face_ref_uri?: string | null;
  identity_mode?: "sheet" | "face" | null;
  description?: string | null;
}

export async function createCharacter(draft: CharacterDraft): Promise<Character> {
  const { data } = await api.post<Character>("/ltx/characters", draft);
  return data;
}

export async function updateCharacter(
  id: string,
  patch: Partial<CharacterDraft>,
): Promise<Character> {
  const { data } = await api.patch<Character>(`/ltx/characters/${id}`, patch);
  return data;
}

export async function deleteCharacter(id: string): Promise<void> {
  await api.delete(`/ltx/characters/${id}`);
}

// ---------------------------------------------------------------- character sheets (#582)

/** The prompt's pronoun for a sheet: the recipe was written for "she"; a man gets "he". */
export type SheetGender = "female" | "male";

export interface SheetPresets {
  /** Pre-filled outfit and hair per pronoun. */
  defaults: Record<SheetGender, { outfit: string; hair: string }>;
  default_count: number;
  max_count: number;
  /** The face panel's padding around the detected face, in photo pixels. */
  crop_padding?: number;
}

export interface SheetGenerateBody {
  /** ONE photo of her, face + body (Image Repo s3:// URI, #585): the turnaround's image 1 --
   *  her build comes from it -- and the source the face panel is auto-cropped from. */
  photo_uri: string;
  /** What she wears in the photo, described. */
  outfit: string;
  hair?: string;
  /** Photo pixels around the detected face for the face panel (API default 140). */
  crop_padding?: number;
  gender?: SheetGender;
  count?: number;
  seeds?: number[];
}

export interface SheetCandidate {
  seed: number;
  /** The 1088x1024 turnaround and the composed 1536x1024 sheet: drafts in the jobs bucket. */
  candidate_uri: string;
  sheet_uri: string;
  preview_uri?: string | null;
  prompt?: string | null;
  model?: string | null;
  settings?: string | null;
  /** How the face panel was cut: "auto_crop" (from the same photo) or "centre" (no detector). */
  face_panel?: string | null;
  face_panel_note?: string | null;
  /** The crop's provenance; `scale` > 1 means the face was enlarged to fill the panel. */
  face_panel_crop?: {
    source?: string | null; box?: number[] | null; crop?: number[] | null;
    padding?: number | null; scale?: number | null;
  } | null;
  /** A JPEG of the 448x1024 face panel auto-cropped from the photo. */
  face_panel_preview_uri?: string | null;
  identity?: { aura: number | null; reason: string | null } | null;
  width?: number | null;
  height?: number | null;
  timings_ms?: Record<string, number> | null;
}

/** A sheet job on the image-edit queue: queued -> waiting (`message` says why) -> running ->
 *  done | failed. Candidates appear as each is made; a failed job keeps the ones it made. */
export interface SheetJob {
  id: string;
  state: "queued" | "waiting" | "running" | "done" | "failed";
  message: string;
  character_id?: string | null;
  character_name?: string | null;
  /** The one photo the sheet is built from. */
  photo_uri?: string | null;
  request: Record<string, unknown>;
  seeds: number[];
  candidates: SheetCandidate[];
  position?: number | null;
  error?: string | null;
  worker?: string | null;
  elapsed_s?: number | null;
  saved: { seed: number; sheet_uri: string; sheet_id?: string }[];
}

/** Where a saved sheet came from (wanly-api migration 108). */
export interface CharacterSheetRecord {
  id: string;
  character_id?: string | null;
  character_name: string;
  sheet_uri: string;
  candidate_uri?: string | null;
  face_uri: string;
  outfit: string;
  hair?: string | null;
  body?: string | null;
  gender?: string | null;
  prompt: string;
  seed: number;
  model?: string | null;
  settings?: string | null;
  face_panel?: string | null;
  identity?: { aura: number | null; reason: string | null } | null;
  job_id?: string | null;
  /** "one_photo" (#585: face_uri is the one photo, the face panel cropped from it); null for
   *  a sheet built from a face photo + body words before that. */
  photo_mode?: string | null;
  face_panel_crop?: Record<string, unknown> | null;
  created_at?: string | null;
}

export async function getSheetPresets(): Promise<SheetPresets> {
  const { data } = await api.get<SheetPresets>("/ltx/characters/sheet/presets");
  return data;
}

export async function startSheetJob(characterId: string, body: SheetGenerateBody): Promise<SheetJob> {
  const { data } = await api.post<SheetJob>(`/ltx/characters/${characterId}/sheet/generate`, body);
  return data;
}

export async function getSheetJob(jobId: string): Promise<SheetJob> {
  const { data } = await api.get<SheetJob>(
    `/ltx/characters/sheet/jobs/${encodeURIComponent(jobId)}`);
  return data;
}

/** Approve a candidate: its sheet is saved to the Image Repo and becomes the character's. */
export async function composeSheet(
  characterId: string, jobId: string, seed: number,
): Promise<{ character: Character; sheet: CharacterSheetRecord }> {
  const { data } = await api.post<{ character: Character; sheet: CharacterSheetRecord }>(
    `/ltx/characters/${characterId}/sheet/compose`, { job_id: jobId, seed });
  return data;
}

export async function listCharacterSheets(characterId: string): Promise<CharacterSheetRecord[]> {
  const { data } = await api.get<CharacterSheetRecord[]>(`/ltx/characters/${characterId}/sheets`);
  return data;
}

/** Star or unstar THE default character. See setDefaultPose. */
export async function setDefaultCharacter(id: string, isDefault: boolean): Promise<Character> {
  const path = `/ltx/characters/${id}/default`;
  const { data } = isDefault
    ? await api.post<Character>(path)
    : await api.delete<Character>(path);
  return data;
}

/**
 * Problems with a pose template that are worth SAYING but never worth blocking.
 *
 * A pose with no <TRIGGER> is unusual and legitimate — a shot that never names the
 * subject still renders. Producing one silently is what is not fine. A template that
 * hardcodes a character name is the exact mistake wanly-api#212 exists to undo: it
 * locks the pose to one LoRA while appearing to be general.
 */
export function poseWarnings(template: string, characters: Character[]): string[] {
  const out: string[] = [];
  if (!template.includes(TRIGGER_PLACEHOLDER)) {
    out.push(
      `No ${TRIGGER_PLACEHOLDER} — this pose will render the same prompt for every ` +
        `character, so nothing names the subject.`,
    );
  }
  const named = characters
    .map((c) => c.trigger)
    .filter((t) => t && new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(template));
  if (named.length) {
    out.push(
      `Hardcodes ${named.join(", ")} — a pose is meant to work for every character. ` +
        `Use ${TRIGGER_PLACEHOLDER} instead.`,
    );
  }
  return out;
}
