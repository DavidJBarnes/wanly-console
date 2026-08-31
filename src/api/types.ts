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
export interface LtxRecipeRef {
  /** The pose name. Poses are character-agnostic; the character is recorded beside it. */
  recipe: string;
  character: string;
  /** The trigger word that filled the pose's placeholder, recorded so the render can be
   *  reproduced without depending on the character row still existing or still having it. */
  trigger?: string;
  char_lora: string;
  char_s1: number;
  char_s2: number;
  frames: number;
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
  loras?: LoraConfig[] | null;
  faceswap_enabled?: boolean;
  faceswap_method?: string | null;
  faceswap_source_type?: string | null;
  faceswap_image?: string | null;
  faceswap_faces_order?: string | null;
  faceswap_faces_index?: string | null;
  faceswap_model?: string | null;
  faceswap_pixel_boost?: string | null;
  seed_faceswap?: boolean;
  negative_prompt?: string | null;
  auto_finalize?: boolean;
  transition?: string | null;
  video_preset_id?: string | null;
}

export interface LoraConfig {
  lora_id?: string;
  high_file?: string;
  low_file?: string;
  high_s3_uri?: string;
  low_s3_uri?: string;
  high_weight: number;
  low_weight: number;
}

export interface LoraListItem {
  id: string;
  name: string;
  trigger_words: string | null;
  preview_image: string | null;
  high_file: string | null;
  low_file: string | null;
  default_high_weight: number;
  default_low_weight: number;
  default_prompt: string | null;
}

export interface LoraResponse {
  id: string;
  name: string;
  description: string | null;
  trigger_words: string | null;
  default_prompt: string | null;
  source_url: string | null;
  preview_image: string | null;
  high_file: string | null;
  high_s3_uri: string | null;
  low_file: string | null;
  low_s3_uri: string | null;
  default_high_weight: number;
  default_low_weight: number;
  created_at: string;
  updated_at: string;
}

export interface LoraCreate {
  name: string;
  description?: string | null;
  trigger_words?: string | null;
  default_prompt?: string | null;
  source_url?: string | null;
  high_url?: string | null;
  low_url?: string | null;
  default_high_weight?: number;
  default_low_weight?: number;
}

export interface LoraUpdate {
  name?: string;
  description?: string | null;
  trigger_words?: string | null;
  default_prompt?: string | null;
  source_url?: string | null;
  default_high_weight?: number;
  default_low_weight?: number;
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

export interface JobLoraSummary {
  lora_id?: string | null;
  name?: string | null;
  high_file?: string | null;
  low_file?: string | null;
  high_weight?: number | null;
  low_weight?: number | null;
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
  config_starred: boolean;
  status: JobStatus;
  segment_count: number;
  completed_segment_count: number;
  estimated_run_time: number | null;
  faceswap_enabled: boolean;
  loras: JobLoraSummary[];
  tags: string | null;
  created_at: string;
  updated_at: string;
}

export interface SegmentResponse {
  id: string;
  job_id: string;
  /** The seed this segment generated with, or null when it derives one from the job
   *  (job.seed + index) — a segment that never asked for a particular seed.
   *
   *  A STRING: seeds are 64-bit and 95% of jobs have one above 2**53, so as a JSON number it
   *  would arrive rounded and display as a seed that never generated anything. */
  seed: string | null;
  index: number;
  /** Human observation. The metrics cannot rank quality — expression rewards the mouth-gape
   *  artifact it should penalise — so what a person saw is primary evidence, not a footnote. */
  notes?: string | null;
  rating?: number | null;
  /** Comma-separated, from the server's controlled vocabulary. */
  observation_tags?: string | null;
  /** Soft-deleted: kept for its feedback, excluded from the video. */
  discarded?: boolean;
  prompt: string;
  prompt_template: string | null;
  duration_seconds: number;
  speed: number;
  start_image: string | null;
  loras: LoraConfig[] | null;
  faceswap_enabled: boolean;
  faceswap_method: string | null;
  faceswap_source_type: string | null;
  faceswap_image: string | null;
  faceswap_faces_order: string | null;
  faceswap_faces_index: string | null;
  faceswap_model: string | null;
  faceswap_pixel_boost: string | null;
  seed_faceswap: boolean;
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
  config_starred?: boolean;
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
  drain_after_jobs: number | null;
  last_heartbeat: string;
  registered_at: string;
  updated_at: string;
}

export type WorkerStatus = "online-idle" | "online-busy" | "offline" | "draining";

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

export interface VideoSettingsPreset {
  id: string;
  name: string;
  lightx2v_strength_high: number | null;
  lightx2v_strength_low: number | null;
  cfg_high: number | null;
  cfg_low: number | null;
  steps_total: number | null;
  high_noise_steps: number | null;
  flow_shift: number | null;
  sampler_name: string | null;
  scheduler: string | null;
  loras: PresetLoraSlot[] | null;
  prompt: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Hidden from the picker but still resolvable by id, so historical jobs keep
   *  their config. Presets accumulate fast during experiments. */
  archived?: boolean;
}

export interface VideoSettingsPresetCreate {
  name: string;
  lightx2v_strength_high?: number | null;
  lightx2v_strength_low?: number | null;
  cfg_high?: number | null;
  cfg_low?: number | null;
  steps_total?: number | null;
  high_noise_steps?: number | null;
  flow_shift?: number | null;
  sampler_name?: string | null;
  scheduler?: string | null;
  loras?: PresetLoraSlot[] | null;
  prompt?: string | null;
  notes?: string | null;
}

export type VideoSettingsPresetUpdate = Partial<VideoSettingsPresetCreate>;

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

export interface FaceswapPreset {
  key: string;
  name: string;
  url: string;
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

export interface ImageFile {
  key: string;
  path: string;
  filename: string;
  size: number;
  last_modified: string;
  in_use: boolean;
  tags: string | null;
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

export interface AppSettingsResponse {
  cfg_high: number;
  cfg_low: number;
  lightx2v_strength_high: number;
  lightx2v_strength_low: number;
  steps_total: number;
  high_noise_steps: number;
  flow_shift: number;
  negative_prompt: string;
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
  cfg_high?: number;
  cfg_low?: number;
  lightx2v_strength_high?: number;
  lightx2v_strength_low?: number;
  steps_total?: number;
  high_noise_steps?: number;
  flow_shift?: number;
  negative_prompt?: string;
}

/** Body for POST /jobs/{id}/reroll.
 *
 *  Carried a "re-roll until" rule — a metric and a threshold. The metrics it judged are gone
 *  (#151), so a rule would be permanently unevaluable. Rolling a take by hand is unaffected.
 */
export type RerollRequest = Record<string, never>;

export interface SegmentReprocessRequest {
  faceswap_enabled: boolean;
  faceswap_method?: string | null;
  faceswap_source_type?: string | null;
  faceswap_image?: string | null;
  faceswap_faces_order?: string | null;
  faceswap_faces_index?: string | null;
  faceswap_model?: string | null;
  faceswap_pixel_boost?: string | null;
}
