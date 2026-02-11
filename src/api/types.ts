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
  high_file: string;
  low_file: string;
  high_weight: number;
  low_weight: number;
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
  output_path: string | null;
  last_frame_path: string | null;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  error_message: string | null;
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
