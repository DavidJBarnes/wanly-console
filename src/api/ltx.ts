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
   *  stack's. Character LoRAs were trained against sulphur — on another base a LoRA can
   *  fuse nothing at all, silently, and the render comes back without the character. The
   *  engine logs its fusion count per render, which is what makes that visible. */
  checkpoint: string;
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
  const out = template.split(TRIGGER_PLACEHOLDER).join(trigger);
  if (trigger) return out;
  // An EMPTY trigger is the "no character" case (console#412): the pose renders on the base
  // model alone, so there is no token to name anyone. Substituting "" leaves the comma that
  // followed it — ", a woman kneeling in front of..." — which reaches the text encoder as a
  // leading empty clause. Tidy it, the same way the API tidies a dropped <SCENE>.
  return out.replace(/^\s*,\s*/, "").replace(/,\s*,/g, ",").trim();
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

export interface RecipeBook {
  stack: LtxStack;
  /** What a pose with no override of its own renders with: the Settings negative prompt,
   *  or the stack's built-in when that is blank. Shown as the editor's placeholder, so
   *  "inherits" is visible without being typed into the field. */
  default_negative_prompt: string;
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
