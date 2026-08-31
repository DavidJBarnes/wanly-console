import axios from "axios";

/**
 * Client for ltx-engine, the LTX 2.3 render service.
 *
 * Deliberately NOT the shared `api` instance from client.ts. That one attaches
 * the console's bearer token to every request and redirects to /login on a 401 —
 * both wrong for a different service on a different host, where the token means
 * nothing and a 401 would log the user out of the console.
 *
 * Submitting is fire-and-forget: the engine answers straight away with an id
 * because a render takes 8-12 minutes. Everything after that is polling.
 *
 * TEMPORARY ROUTING. Today this talks to ltx-engine directly, which works in dev
 * through the Vite proxy (the engine sends no CORS headers, so the browser
 * cannot reach it any other way). Once wanly-api owns the queue and the recipe
 * book — wanly-api#206 and #207 — this module repoints at /api and the engine
 * stops being something the browser knows about at all.
 */
const ltx = axios.create({
  baseURL: import.meta.env.VITE_LTX_URL || "/ltx",
  timeout: 120_000,
});

export interface Lora {
  name: string;
  strength: number;
  /** Per-pass strength. The two stages are not interchangeable — stage 1
   *  generates at half size from noise, stage 2 refines the 2x-upscaled latent
   *  from 0.85 — and the validated recipe runs the character LoRA at 0.8 on
   *  stage 1 and 1.5 on stage 2. */
  strength_stage_1?: number | null;
  strength_stage_2?: number | null;
}

export interface LtxJob {
  job_id: string;
  status: "None" | "Processing" | "Done" | "Failed";
  video: string | null;
  /** Free-text notes the engine attaches — for a recipe render this carries the
   *  recipe name and the resolved graph hash, which is the regression trail. */
  notes?: string[];
  /** What each pass actually ran, read back off the submitted graph rather than
   *  echoed from the request. A step count the workflow could not express shows
   *  up here and nowhere else. */
  stages?: { stage: number; steps: number | null }[];
  error?: string;
}

export interface SubmitRequest {
  prompt: string;
  negative_prompt?: string | null;
  loras?: Lora[];
  /** A validated recipe by name. When set the engine builds the graph wholly
   *  from the recipe book and IGNORES the free-form fields — a recipe is a
   *  pinned configuration, not a starting point. The resolved graph is hashed,
   *  so a recipe render is provably the one that was validated. */
  recipe?: string | null;
  /** Which character's sheet tab the recipe comes from. */
  character?: string | null;
  keyframes: { image: string }[];
  width: number;
  height: number;
  num_frames?: number;
  frame_rate?: number;
  seed?: number | null;
}

/** One validated (character, pose) configuration. Authored in the recipe sheet;
 *  this endpoint is read-only. */
export interface Recipe {
  checkpoint: string;
  char_lora: string;
  char_s1: string;
  char_s2: string;
  content_lora: string;
  distill: string;
  prompt: string;
  negative: string;
  guidance: string;
  steps: string;
  frames: string;
  resolution: string;
  validated: string;
}

export interface RecipeBook {
  character: string | null;
  /** One entry per sheet tab. Each holds that character's own recipes. */
  characters?: Record<string, { recipes: Record<string, Recipe> }>;
  /** Where each parameter comes from: "ui" | "ui with defaults" | "hardcoded" |
   *  "derived". Drives which fields the form shows. */
  sources: Record<string, string>;
  /** Shared text by key — prompts, the negative, the guidance stack. */
  definitions: Record<string, string>;
  recipes: Record<string, Recipe>;
}

export async function listRecipes(): Promise<RecipeBook> {
  const { data } = await ltx.get<RecipeBook>("/recipes");
  return data;
}

export async function listLoras(): Promise<{ loras: { name: string }[] }> {
  const { data } = await ltx.get("/loras");
  return data;
}

export async function submitJob(req: SubmitRequest): Promise<LtxJob> {
  const { data } = await ltx.post<LtxJob>("/job", req);
  return data;
}

export async function getJob(id: string): Promise<LtxJob> {
  const { data } = await ltx.get<LtxJob>(`/job/${id}`);
  return data;
}

export async function ltxHealth() {
  const { data } = await ltx.get("/health");
  return data as { status: string; queue_depth: number; running: number };
}

/** The video is served by the engine, so it must go through the proxy too. */
export function videoUrl(job: LtxJob): string | null {
  if (!job.video) return null;
  return `${import.meta.env.VITE_LTX_URL || "/ltx"}/job/${job.job_id}/video`;
}

export function ltxError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d.map((x) => `${(x.loc ?? []).slice(1).join(".")}: ${x.msg}`).join("; ");
    }
    if (!err.response) return "No response from the LTX engine. Is it up on :8190?";
    return `${err.response.status} ${err.response.statusText}`;
  }
  return err instanceof Error ? err.message : String(err);
}
