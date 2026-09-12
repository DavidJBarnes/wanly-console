export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

/** What an LTX recipe render actually ran. Recorded on the segment, not used to
 *  look anything up — an engine that cannot look a recipe up cannot look up a
 *  stale one. `graph_sha256` is written back by the worker once the engine has
 *  resolved the graph; it is a record, not an input. */
/** The word a LoRA's caption bound its trigger to: every run captions its images
 *  "<trigger>, <gender>", and a render prompt has to say the same pair (console#487). */
export type Gender = "woman" | "man" | "person";

/** One person in the shot (console#473). Slot 0 fills `<TRIGGER>`, slot 1 `<TRIGGER2>`. */
export interface LtxRecipeCharacter {
  name: string;
  trigger: string;
  /** Recorded since console#487 so a re-roll can rebuild "p@yton, woman" after the
   *  character row is gone. Absent on older blobs. */
  gender?: Gender | null;
  char_lora: string;
  s1: number;
  s2: number;
}

export interface LtxRecipeRef {
  /** The pose name. Poses are character-agnostic; the characters are recorded beside it. */
  recipe: string;
  /** The people in the shot, in slot order, at most two. Blobs from before console#473
   *  have only the scalar fields below, which are ALWAYS written too, mirrored from
   *  `characters[0]`, so every reader of either shape keeps working. */
  characters?: LtxRecipeCharacter[];
  character: string;
  /** The trigger word that filled the pose's placeholder, recorded so the render can be
   *  reproduced without depending on the character row still existing or still having it. */
  trigger?: string;
  char_lora: string;
  char_s1: number;
  char_s2: number;
  frames: number;
  /** Conditioning-frame CRF this render used. Recorded because it materially changes how
   *  long the start frame holds (wanly-api#235). */
  img_compression?: number | null;
  /** Motion/act LoRAs this render used, chained AHEAD of the character LoRA (which is
   *  identity), IN APPLICATION ORDER. Recorded rather than looked up later: the recipe row
   *  can be edited afterwards, and order and strengths both materially change the output,
   *  so a segment has to say exactly what it ran. */
  content_loras?: { name: string; s1: number; s2: number }[] | null;
  /** Base model this render used. Recorded because it materially changes the output, and
   *  because a character LoRA can fuse nothing at all against a base it was not trained
   *  on — a segment must say which one it ran against. */
  checkpoint?: string | null;
  /** Which of the recipe's defaults the user changed, if any. */
  edited?: (string | null)[];
  graph_sha256?: string;
}

export interface SegmentCreate {
  prompt: string;
  ltx_recipe?: LtxRecipeRef | null;
  duration_seconds?: number;
  speed?: number;
  start_image?: string | null;
  negative_prompt?: string | null;
  auto_finalize?: boolean;
  transition?: string | null;
  video_preset_id?: string | null;
}






export interface JobCreate {
  name: string;
  width: number;
  height: number;
  fps: number;
  seed?: number | null;
  lightx2v_strength_high?: number | null;
  lightx2v_strength_low?: number | null;
  cfg_high?: number | null;
  cfg_low?: number | null;
  steps_total?: number | null;
  high_noise_steps?: number | null;
  flow_shift?: number | null;
  video_preset_id?: string | null;
  continuation_mode?: string | null; // "vace" | "traditional"
  starting_image_uri?: string | null;
  starting_image_hash?: string | null;
  first_segment: SegmentCreate;
  tags?: string | null;
}


export interface JobResponse {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  seed: number;
  starting_image: string | null;
  continuation_mode?: string | null;
  lightx2v_strength_high: number | null;
  lightx2v_strength_low: number | null;
  cfg_high: number | null;
  cfg_low: number | null;
  steps_total: number | null;
  high_noise_steps: number | null;
  flow_shift: number | null;
  video_preset_id?: string | null;
  priority: number;
  status: JobStatus;
  segment_count: number;
  completed_segment_count: number;
  estimated_run_time: number | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

export interface SegmentResponse {
  id: string;
  job_id: string;
  /** The seed this segment generated with, or null when it derives one from the job — a
   *  segment that never asked for a particular seed. Null is the normal case: the seed is
   *  locked across a chain, so every live segment runs on job.seed. A segment carries its
   *  own only when it is a discarded take, stamped at re-roll time with what it ran on.
   *
   *  This said "(job.seed + index)", which was the rule before the seed was locked.
   *
   *  A STRING: seeds are 64-bit and 95% of jobs have one above 2**53, so as a JSON number it
   *  would arrive rounded and display as a seed that never generated anything. */
  seed: string | null;
  index: number;
  /** Soft-deleted: kept with its clip and its seed, excluded from the video. */
  discarded?: boolean;
  prompt: string;
  prompt_template: string | null;
  duration_seconds: number;
  speed: number;
  start_image: string | null;
  /** Which validated (character, pose) configuration this segment ran, and any defaults the
   *  user overrode. The API has always returned it; this type simply never declared it, so
   *  the console could not read back what a segment was actually made of. */
  ltx_recipe?: LtxRecipeRef | null;
  auto_finalize: boolean;
  transition: string | null;
  trim_start_frames: number;
  trim_end_frames: number;
  reference_frames: string[] | null;
  negative_prompt: string | null;
  status: SegmentStatus;
  reprocess_type: string | null;
  worker_id: string | null;
  worker_name: string | null;
  video_preset_id: string | null;
  output_path: string | null;
  last_frame_path: string | null;
  hologram_flavor: string | null;
  hologram_depth_scale_m: number | null;
  hologram_video_path: string | null;
  hologram_manifest_path: string | null;
  hologram_poster_path: string | null;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  progress_log: string | null;
  estimated_run_time: number | null;
  /** Why a PENDING segment is going nowhere: the models it names are on no online worker
   *  (console#422). Computed per request from what workers report, so it clears by itself
   *  the moment a worker holding the file comes online. Null means nothing to say — either
   *  somebody can run it, or no worker has reported an inventory to judge against. */
  blocked_reason: string | null;
}

export interface HologramRequest {
  subject_height_m?: number;
  key_color?: string;
  flavor?: string; // "2d_matte" (default) | "2.5d_depth"
  depth_scale_m?: number; // 2.5d relief depth in meters
}

export interface HologramUvRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HologramManifest {
  tier: number;
  flavor?: string; // "2d_matte" | "2.5d_depth"
  layout: string;
  codec: string;
  fps: number;
  video_width: number;
  video_height: number;
  region_color_uv: HologramUvRect;
  region_alpha_uv: HologramUvRect;
  region_depth_uv?: HologramUvRect; // 2.5d_depth only
  depth_encoding?: string;
  depth_near_is?: string; // "bright"
  depth_scale_m?: number; // relief in meters
  guard_px: number;
  crop_rect: { x: number; y: number; w: number; h: number };
  subject_px_height: number;
  subject_height_m: number;
  premultiplied: boolean;
  alpha_encoding: string;
  /** The packed mp4 carries the source's audio track (console#475). Absent on artifacts
   *  built before the daemon recorded it — they are silent, which is what the player
   *  must assume. */
  has_audio?: boolean;
}

export interface WorkerSegmentResponse {
  id: string;
  job_id: string;
  job_name: string;
  index: number;
  prompt: string;
  status: string;
  duration_seconds: number;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
}

export interface VideoResponse {
  id: string;
  job_id: string;
  output_path: string | null;
  duration_seconds: number | null;
  status: string;
  error_message: string | null;
  tags: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface JobListResponse {
  items: JobResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface JobDetailResponse extends JobResponse {
  segments: SegmentResponse[];
  videos: VideoResponse[];
  segment_count: number;
  completed_segment_count: number;
  total_run_time: number;
  total_video_time: number;
}

export interface JobUpdate {
  name?: string;
  status?: string;
  tags?: string | null;
}

export type JobStatus =
  | "pending"
  | "processing"
  | "awaiting"
  | "failed"
  | "paused"
  | "finalizing"
  | "finalized"
  | "archived";

export type SegmentStatus =
  | "pending"
  | "claimed"
  | "processing"
  | "completed"
  | "failed";

export interface GpuStats {
  vram_used_mb: number;
  vram_total_mb: number;
  gpu_name: string;
  torch_vram_used_mb?: number;
  torch_vram_free_mb?: number;
}

export interface SdScriptsTrainingInfo {
  pid: number;
  output_name: string;
  current_epoch?: number;
  max_epochs?: number;
  current_step?: number;
  pct_complete?: number;
  current_loss?: number;
}

export interface SdScripts {
  sd_scripts_installed: boolean;
  sd_scripts_training: boolean;
  sd_scripts_training_info: SdScriptsTrainingInfo | null;
}

export interface A1111 {
  a1111_installed: boolean;
  a1111_running: boolean;
}

export interface WorkerResponse {
  /** Set only by workers running on RunPod. The reliable way to pair a worker with its pod —
   *  names diverge when a pod is launched from the template rather than the console. */
  runpod_pod_id?: string | null;
  id: string;
  friendly_name: string;
  hostname: string;
  ip_address: string;
  status: WorkerStatus;
  comfyui_running: boolean;
  gpu_stats: GpuStats | null;
  sd_scripts: SdScripts | null;
  a1111: A1111 | null;
  /** What this worker's LoRA directory held as of its LAST SYNC — a cached verdict, not a
   *  live check: verifying one LoRA means hashing 650 MB. null means never reported (or an
   *  older daemon), which is not the same as an empty inventory. See daemon#165. */
  loras: WorkerLoras | null;
  /** What code this worker is actually running (wanly-gpu-docker#72). TWO fields because
   *  there are two update channels that drift separately: the daemon is re-cloned from main
   *  at every container boot, while the image carries start.sh, the downloader and the
   *  engine and only changes on a pull + recreate. `docker restart` moves the first and not
   *  the second — the 3090 spent 37 hours in exactly that state while a pod ran current
   *  code, and the difference showed up only as a 422 that looked random.
   *
   *  null means the daemon does not report it (too old, or not running from the image),
   *  which is NOT the same as "unknown build". */
  daemon_commit: string | null;
  image_ref: string | null;
  /** wanly-api#269. Never null. The FIRST of `kinds`, render first whenever present. */
  kind: WorkerKind;
  /** Every kind at once (wanly-gpu-docker#83): one container per GPU is ["render", "trainer"].
   *  null from a row registered before the column existed — then it is [kind]. */
  kinds: WorkerKind[] | null;
  /** What it runs: ["ltx-engine"], ["joycaption", "qwen-edit"]. A list, because a services
   *  container runs several at once. null means never reported — which is every render
   *  daemon today, since none of them sends it yet — and is NOT the same as "runs nothing". */
  provides: string[] | null;
  drain_after_jobs: number | null;
  last_heartbeat: string;
  registered_at: string;
  updated_at: string;
}


/**
 * A worker's LoRA inventory, as of `synced_at`.
 *
 * The states carry INTENT, not just presence — which is the whole reason this is worth
 * rendering. Since the boot sync stopped eagerly fetching content LoRAs, an absent one is
 * NORMAL, and a page that paints it as a fault would be amber on every worker forever. At
 * that point nobody reads it, and `stale` — the state actually worth seeing — is lost.
 */
export interface WorkerLoras {
  synced_at: string | null;
  dir: string | null;
  items: WorkerLoraItem[];
}

export interface WorkerLoraItem {
  name: string;
  kind: string;
  /**
   * current       present, md5 matches the bucket ETag
   * deferred      absent BY DESIGN — a content LoRA, fetched on first use
   * unverifiable  present, but a multipart ETag means the check was size-only
   * stale         present and the content DIFFERS — renders the wrong thing, successfully
   * missing       should be here and is not
   */
  state: "current" | "deferred" | "unverifiable" | "stale" | "missing";
  note?: string;
}

/** `online` and `degraded` are the SERVICE vocabulary (wanly-api#269).
 *
 *  Reusing `online-idle` for a service was the cheap wrong answer: it already means both
 *  "waiting for work" and "cannot do work" on a render worker, and that ambiguity hid a dead
 *  ComfyUI for 33 minutes (wanly-gpu-docker#80). A service is never waiting for work.
 *
 *  `degraded` means some but not all of what a services box was asked to run is answering —
 *  a state a single green dot cannot express. */
export type WorkerStatus =
  | "online-idle"
  | "online-busy"
  | "online"
  | "degraded"
  | "offline"
  | "draining";

/** What a worker IS. `render` takes segments; `service` never can — the API's claim gate keys
 *  on this, so it is not a display label with a UI consequence, it is the reverse. Never null:
 *  the column is NOT NULL with a `render` default, so there is no "unclassified" branch. */
export type WorkerKind = "render" | "service" | "trainer";

export interface WorkerStatsItem {
  worker_name: string;
  segments_completed: number;
  avg_run_time: number;
  last_seen: string | null;
}

export interface PresetLoraSlot {
  lora_id: string;
  high_weight: number;
  low_weight: number;
}




/** A character-LoRA training run (wanly-api#274). Shaped on the segment lifecycle: the console
 *  creates it, a trainer claims it, and it reports back. */
export type TrainingStatus =
  | "pending"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TrainingJob {
  id: string;
  character: string;
  /** The token the captions used. NOT the filename — a LoRA is served over HTTP and lands in
   *  JSON and URLs, so `p@y` can be a trigger and cannot be a filename. */
  trigger: string;
  version: number;
  status: TrainingStatus;
  dataset_images: string[];
  config: Record<string, unknown>;
  worker_name: string | null;
  gpu_name: string | null;
  progress_log: string | null;
  /** Structured progress, which a render segment has no equivalent of. null until the trainer
   *  reports one; a queued job has no honest percentage. */
  step: number | null;
  total_steps: number | null;
  error_message: string | null;
  /** Every epoch is a candidate — loss does not rank them, so the choice is made by eye at a
   *  fixed seed and all of them are kept. */
  checkpoints: string[] | null;
  output_lora_path: string | null;
  /** [[step, avr_loss], ...] as the trainer reports it. */
  loss_log: [number, number][] | null;
  /** Every checkpoint the run wrote, uploaded or not. Only the final goes up by default. */
  epochs: TrainingEpoch[] | null;
  /** Labels asked for after the fact; the trainer uploads them on its next poll. */
  publish_requests: string[] | null;
  /** Free-form operator notes, written only by a human (wanly-console#484). The trainer's
   *  reports cannot reach it, so it does not fight the progress log for the field. */
  notes: string | null;
  /** The dataset's anchor image at creation -- the face this LoRA is of. */
  thumbnail_uri: string | null;
  created_at: string | null;
  claimed_at: string | null;
  completed_at: string | null;
}

export interface TrainingEpoch {
  /** `e01` .. `eNN`, or `final`. */
  label: string;
  step: number;
  loss: number | null;
}

/** A named, taggable set of images kept for training (wanly-api#277).
 *
 *  `images` is an ORDERED list of s3:// URIs, not a folder listing: it survives an image being
 *  moved, and it fixes the order the trainer stages them in, which the captions pair against. */
export interface Dataset {
  id: string;
  name: string;
  /** Comma-separated, same convention as ImageFile.tags. */
  tags: string | null;
  notes: string | null;
  images: string[];
  prefix: string | null;
  /** The one image every other one is scored against. Null until somebody picks one. */
  anchor_uri: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface DatasetScore {
  uri: string;
  /** Null means no face was detected — an absent score, not a low one. */
  cos: number | null;
  is_anchor: boolean;
}

export interface DatasetScores {
  anchor_uri: string;
  /** buffalo_l's same-person floor. A line to read against, not a delete rule. */
  cos_floor: number;
  scores: DatasetScore[];
}

export interface TrainingCreate {
  character: string;
  trigger: string;
  version: number;
  /** Give the images, or name a dataset and let the API resolve them. A dataset is the normal
   *  path — a set worth training is a set worth being able to re-open. */
  dataset_id?: string;
  dataset_images?: string[];
  caption?: string | null;
  /** Every image is captioned "<trigger>, <gender>". Explicit, because a free caption
   *  field was once filled with "man" alone and the trigger was never learned. */
  gender?: Gender;
  steps: number;
  /** The filename stem. Asked rather than derived — see src/lib/trainingJob.ts. */
  lora_name?: string;
  /** Which checkpoints to upload as they are written. Final only by default: a checkpoint
   *  takes ~18 minutes to leave the 3090 and most epochs go unused. */
  publish?: "final" | "all";
  /** ADDITIONAL training groups (wanly-api#102, #106). An identity group gives a
   *  character/trigger/gender and is captioned "<trigger>, <gender>"; a composition group
   *  has NO trigger and a free `caption` naming the people in its frames — the group that
   *  teaches the model both characters appear together. */
  identities?: {
    character?: string;
    trigger?: string;
    gender?: Gender;
    caption?: string;
    dataset_id?: string;
    dataset_images?: string[];
    num_repeats?: number;
  }[];
}

export interface WildcardResponse {
  id: string;
  name: string;
  options: string[];
  created_at: string;
  updated_at: string;
}

export interface WildcardCreate {
  name: string;
  options: string[];
}

export interface WildcardUpdate {
  name?: string;
  options?: string[];
}

export interface StatsResponse {
  jobs_by_status: Record<string, number>;
  segments_by_status: Record<string, number>;
  /** Rolling 24h window, not lifetime. */
  avg_segment_run_time_24h: number | null;
  /** Estimated seconds of work still queued across all active jobs. */
  total_queue_time: number;
  worker_stats: WorkerStatsItem[];
}


export interface TitleTagResponse {
  id: string;
  name: string;
  group: number;
  created_at: string;
  updated_at: string;
}

export interface TitleTagCreate {
  name: string;
  group: number;
}

export interface ImageJobInfo {
  id: string;
  name: string;
  created_at: string;
}

export interface ImageFolder {
  name: string;
  thumbnail: string | null;
  created_at: string | null;
}

/** The 409 from DELETE /images/folder: every image still referenced, with its holders. */
export interface FolderInUse {
  folder: string;
  imageCount: number;
  referencedCount: number;
  paths: Record<string, { jobIds: string[]; segmentIds: string[]; datasetIds: string[] }>;
}

export interface ImageFile {
  key: string;
  path: string;
  filename: string;
  size: number;
  last_modified: string;
  in_use: boolean;
  tags: string | null;
  /** JoyCaption's description of this frame, produced once and kept (console#414).
   *
   *  Null means never described, which is an ordinary state — not an error, and not the
   *  same as a description that came back empty (nothing stores one of those). */
  scene_description: string | null;
  scene_described_at: string | null;
}

/** An image's scene description, as GET/POST /images/scene return it. */
export interface ImageScene {
  path: string;
  scene_description: string | null;
  /** WHICH instruction produced it. A caption written under "terse" and one under "rich"
   *  are different artefacts. */
  scene_instruction: string | null;
  scene_described_at: string | null;
  /** Length is the thing being judged: the description sits beside a ~100-word arc. */
  words: number;
}

/** One tag and how many items carry it under the current filter. Images and jobs both. */
export interface TagCount {
  tag: string;
  count: number;
}

export interface ImageSearchResponse {
  items: ImageFile[];
  total: number;
  limit: number;
  offset: number;
}

export interface FramePreview {
  frame_index: number;
  data_url: string;
}

export interface FramePreviewResponse {
  total_frames: number;
  fps: number;
  frames: FramePreview[];
}

/** How verbose a <SCENE> description should be. See console#405. */
export type CaptionStyle = "terse" | "standard" | "rich" | "raw";

/**
 * Global app settings.
 *
 * The WAN 2.2 fields that used to live here — cfg_high/low, lightx2v_strength_high/low,
 * steps_total, high_noise_steps, flow_shift — are gone (console#390). The API stopped
 * returning them when WAN was retired, but this type kept declaring them, so TypeScript
 * believed they were numbers while at runtime they were undefined. Nothing errored: the
 * store did String(undefined) and stored the string "undefined".
 */
export interface AppSettingsResponse {
  negative_prompt: string;
  caption_style: CaptionStyle;
  /** Empty means "use the style". Non-empty overrides it. */
  caption_instruction: string;
  /** Read-only: what each style asks for, so the UI need not restate it. */
  caption_style_prompts?: Record<string, string>;
}

export interface FavoriteToggleRequest {
  item_type: "video" | "image" | "segment";
  item_ref: string;
}

export interface SegmentClip {
  id: string;
  job_id: string;
  job_name: string;
  index: number;
  output_path: string | null;
  thumbnail_path: string | null;
  width: number;
  height: number;
  fps: number;
  duration_seconds: number;
  favorite: boolean;
}

export interface SmashcutBody {
  name: string;
  segment_ids: string[];
  transition: "seamless" | "black";
  /** Per-clip playback speed, aligned 1:1 with segment_ids. <1 slow-motion, >1 fast-forward. */
  clip_speeds?: number[];
}

export interface FavoriteToggleResponse {
  favorited: boolean;
  item_ref: string;
}

export interface FavoriteListResponse {
  item_refs: string[];
}

export interface AppSettingsUpdate {
  negative_prompt?: string;
  caption_style?: CaptionStyle;
  /** "" clears a custom instruction and falls back to the style; undefined leaves it alone.
   *  Those are different intents and the API distinguishes them. */
  caption_instruction?: string;
}

/** Body for POST /jobs/{id}/reroll.
 *
 *  Carried a "re-roll until" rule — a metric and a threshold. The metrics it judged are gone
 *  (#151), so a rule would be permanently unevaluable. Rolling a take by hand is unaffected.
 */
export type RerollRequest = Record<string, never>;

export interface SegmentReprocessRequest {
}
