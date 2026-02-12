export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface SegmentCreate {
  prompt: string;
  duration_seconds?: number;
  start_image?: string | null;
  loras?: LoraConfig[] | null;
  faceswap_enabled?: boolean;
  faceswap_method?: string | null;
  faceswap_source_type?: string | null;
  faceswap_image?: string | null;
  faceswap_faces_order?: string | null;
  faceswap_faces_index?: string | null;
  auto_finalize?: boolean;
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
  first_segment: SegmentCreate;
}

export interface JobResponse {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  seed: number;
  starting_image: string | null;
  status: JobStatus;
  created_at: string;
  updated_at: string;
}

export interface SegmentResponse {
  id: string;
  job_id: string;
  index: number;
  prompt: string;
  duration_seconds: number;
  start_image: string | null;
  loras: LoraConfig[] | null;
  faceswap_enabled: boolean;
  faceswap_method: string | null;
  faceswap_source_type: string | null;
  faceswap_image: string | null;
  faceswap_faces_order: string | null;
  faceswap_faces_index: string | null;
  auto_finalize: boolean;
  status: SegmentStatus;
  worker_id: string | null;
  worker_name: string | null;
  output_path: string | null;
  last_frame_path: string | null;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  progress_log: string | null;
}

export interface VideoResponse {
  id: string;
  job_id: string;
  output_path: string | null;
  duration_seconds: number | null;
  status: string;
  created_at: string;
  completed_at: string | null;
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
}

export type JobStatus =
  | "pending"
  | "processing"
  | "awaiting"
  | "failed"
  | "paused"
  | "finalizing"
  | "finalized";

export type SegmentStatus =
  | "pending"
  | "claimed"
  | "processing"
  | "completed"
  | "failed";

export interface WorkerResponse {
  id: string;
  friendly_name: string;
  hostname: string;
  ip_address: string;
  status: WorkerStatus;
  comfyui_running: boolean;
  last_heartbeat: string;
  registered_at: string;
  updated_at: string;
}

export type WorkerStatus = "online-idle" | "online-busy" | "offline";

export interface WorkerStatsItem {
  worker_name: string;
  segments_completed: number;
  avg_run_time: number;
  last_seen: string | null;
}

export interface StatsResponse {
  jobs_by_status: Record<string, number>;
  segments_by_status: Record<string, number>;
  avg_segment_run_time: number | null;
  total_segments_completed: number;
  total_video_time: number;
  worker_stats: WorkerStatsItem[];
}
