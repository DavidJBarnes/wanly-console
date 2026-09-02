import axios from "axios";
import { LOCAL_STORAGE_TOKEN_KEY } from "../constants";
import { mergeLoraOptions } from "../lib/loraOptions";

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
export interface Pose {
  id: string;
  name: string;
  /** Contains TRIGGER_PLACEHOLDER, filled with the character's trigger word. */
  prompt_template: string;
  /** Already resolved: the pose's own override, or the stack's. */
  negative_prompt: string;
  frames: number;
  /** Video CRF applied to the conditioning frame before it anchors the render. Null uses the
   *  global stack's value. 0 is meaningful — it bypasses the encode entirely. */
  img_compression: number | null;
  /** The POSE is proven — this prompt produces what it claims. Whether a given
   *  character renders well is a property of its LoRA, which ratings record. */
  validated: boolean;
}

export interface Character {
  id: string;
  name: string;
  char_lora: string;
  /** Fills a pose's placeholder. "Adding a character costs a LoRA and a trigger
   *  swap" — this is the trigger half. */
  trigger: string;
  /** Per-stage, never flat. Stage 1 decides body and anatomy; stage 2 resolves
   *  the face. 0.8/1.5 is the validated pair. */
  strength_stage_1: number;
  strength_stage_2: number;
}

/** What a pose carries and a character's trigger fills. */
export const TRIGGER_PLACEHOLDER = "<TRIGGER>";

/** Fill a pose's placeholder with a character's trigger word.
 *
 *  The API does this too, before wildcard resolution — doing it here as well
 *  means the user SEES the prompt that will actually render rather than a
 *  template, which matters because the prompt is editable. */
export function renderPrompt(template: string, trigger: string): string {
  return template.split(TRIGGER_PLACEHOLDER).join(trigger);
}

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

export interface RecipeBook {
  stack: LtxStack;
  /** Every pose, available to every character. */
  poses: Pose[];
  characters: Character[];
}

export async function listRecipes(): Promise<RecipeBook> {
  const { data } = await api.get<RecipeBook>("/recipes");
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
  book: RecipeBook | null,
  kind: "character" | "content" = "character",
): Promise<string[]> {
  const objs = await listLoraObjects();
  // Only character LoRAs union with the book: a character's own char_lora must stay
  // pickable even once its file leaves the bucket, but that has no meaning for content.
  const fromBook = kind === "character" ? (book?.characters ?? []).map((c) => c.char_lora) : [];
  return mergeLoraOptions(
    fromBook,
    objs.filter((o) => o.kind === kind).map((o) => o.name),
  );
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
  validated?: boolean;
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

export interface CharacterDraft {
  name: string;
  char_lora: string;
  /** Optional on create only — the API defaults it to the name. */
  trigger?: string | null;
  strength_stage_1?: number;
  strength_stage_2?: number;
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
