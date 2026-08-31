import axios from "axios";
import { LOCAL_STORAGE_TOKEN_KEY } from "../constants";

/**
 * LTX 2.3 recipes.
 *
 * Recipes are DATA now — rows in wanly-api, created and edited here. The POC
 * authored them in an .ods, which was a test harness that became load-bearing;
 * the sheet does not come with them.
 *
 * Its own axios instance rather than the shared one from client.ts, because the
 * engine calls below must never carry the console's bearer token to a different
 * host, and a 401 from the engine must never sign the user out of the console.
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

/** ltx-engine, for the LoRA list only. Reachable in dev; not from the deployed site. */
const ltx = axios.create({
  baseURL: import.meta.env.VITE_LTX_URL || "/ltx",
  timeout: 20_000,
});

/** One pose for one character. A recipe is (character, prompt) — everything else
 *  is the global stack, which is why this carries so little. */
export interface Recipe {
  id: string;
  name: string;
  prompt: string;
  /** Already resolved: the recipe's own override, or the stack's. */
  negative_prompt: string;
  frames: number;
  /** A human watched it and signed it off. Not a quality score. */
  validated: boolean;
}

export interface Character {
  id: string;
  name: string;
  char_lora: string;
  /** Per-stage, never flat. Stage 1 decides body and anatomy; stage 2 resolves
   *  the face. 0.8/1.5 is the validated pair. */
  strength_stage_1: number;
  strength_stage_2: number;
  recipes: Recipe[];
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
 * but only answers in dev.
 *
 * So the engine is a bonus, not a dependency: unreachable, the dropdown still
 * offers everything the book knows about rather than going empty.
 */
export async function listLoras(book: RecipeBook | null): Promise<string[]> {
  const names = new Set<string>((book?.characters ?? []).map((c) => c.char_lora));
  try {
    const { data } = await ltx.get<{ loras: { name: string }[] }>("/loras");
    for (const l of data.loras) names.add(l.name.replace(/\.safetensors$/, ""));
  } catch {
    // Expected wherever the engine is unreachable. The book's LoRAs still show.
  }
  return [...names].sort();
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
