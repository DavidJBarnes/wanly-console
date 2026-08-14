import axios from "axios";
import type {
  TokenResponse,
  JobResponse,
  JobListResponse,
  JobDetailResponse,
  JobUpdate,
  SegmentCreate,
  SegmentResponse,
  HologramRequest,
  SegmentReprocessRequest,
  FramePreviewResponse,
  WorkerResponse,
  LoraListItem,
  LoraResponse,
  LoraCreate,
  LoraUpdate,
  StatsResponse,
  WorkerSegmentResponse,
  VideoSettingsPreset,
  VideoSettingsPresetCreate,
  VideoSettingsPresetUpdate,
  WildcardResponse,
  WildcardCreate,
  WildcardUpdate,
  FaceswapPreset,
  TitleTagResponse,
  TitleTagCreate,
  ImageFolder,
  ImageFile,
  ImageJobInfo,
  ImageSearchResponse,
  ImageTagCount,
  FavoriteToggleRequest,
  SegmentClip,
  SmashcutBody,
  FavoriteToggleResponse,
  FavoriteListResponse,
  AppSettingsResponse,
  AppSettingsUpdate,
} from "./types";
import { REPEAT_ARRAY_PARAMS } from "../lib/repeatArrayParams";
import { LOCAL_STORAGE_TOKEN_KEY } from "../constants";

const API_URL = import.meta.env.VITE_API_URL || "/api";

const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
      window.location.href = "/login";
    }
    return Promise.reject(err);
  },
);

export async function login(
  username: string,
  password: string,
): Promise<TokenResponse> {
  const { data } = await api.post<TokenResponse>("/login", {
    username,
    password,
  });
  return data;
}

export async function getJobs(params?: {
  limit?: number;
  offset?: number;
  status?: string;
  sort?: string;
  name?: string;
  q?: string;
  starred?: boolean;
}): Promise<JobListResponse> {
  const { data } = await api.get<JobListResponse>("/jobs", { params });
  return data;
}

export async function reorderJobs(jobIds: string[]): Promise<JobResponse[]> {
  const { data } = await api.put<JobResponse[]>("/jobs/reorder", {
    job_ids: jobIds,
  });
  return data;
}

export async function getJob(id: string): Promise<JobDetailResponse> {
  const { data } = await api.get<JobDetailResponse>(`/jobs/${id}`);
  return data;
}

export async function createJob(formData: FormData): Promise<JobResponse> {
  const { data } = await api.post<JobResponse>("/jobs", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function checkStartingImageExists(
  sha256: string,
): Promise<{ exists: boolean; uri: string | null }> {
  const { data } = await api.get<{ exists: boolean; uri: string | null }>(
    "/jobs/starting-image-exists",
    { params: { sha256 } },
  );
  return data;
}

export async function updateJob(
  id: string,
  body: JobUpdate,
): Promise<JobResponse> {
  const { data } = await api.patch<JobResponse>(`/jobs/${id}`, body);
  return data;
}

export async function deleteJob(id: string): Promise<void> {
  await api.delete(`/jobs/${id}`);
}

export async function reopenJob(id: string): Promise<JobDetailResponse> {
  const { data } = await api.post<JobDetailResponse>(`/jobs/${id}/reopen`);
  return data;
}

export async function addSegment(
  jobId: string,
  body: SegmentCreate,
): Promise<SegmentResponse> {
  const { data } = await api.post<SegmentResponse>(
    `/jobs/${jobId}/segments`,
    body,
  );
  return data;
}

export async function retrySegment(
  segmentId: string,
): Promise<SegmentResponse> {
  const { data } = await api.post<SegmentResponse>(
    `/segments/${segmentId}/retry`,
  );
  return data;
}

export async function cancelSegment(
  segmentId: string,
): Promise<SegmentResponse> {
  const { data } = await api.post<SegmentResponse>(
    `/segments/${segmentId}/cancel`,
  );
  return data;
}

export async function updateSegmentTransition(
  segmentId: string,
  transition: string | null,
): Promise<SegmentResponse> {
  const { data } = await api.patch<SegmentResponse>(
    `/segments/${segmentId}/transition`,
    { transition },
  );
  return data;
}

export async function updateSegmentTrim(
  segmentId: string,
  trimStart: number,
  trimEnd: number,
): Promise<SegmentResponse> {
  const { data } = await api.patch<SegmentResponse>(
    `/segments/${segmentId}/trim`,
    { trim_start_frames: trimStart, trim_end_frames: trimEnd },
  );
  return data;
}

export async function getSegmentFrames(
  segmentId: string,
  position: "start" | "end",
  count: number = 5,
  trim: number = 0,
): Promise<FramePreviewResponse> {
  const { data } = await api.get<FramePreviewResponse>(
    `/segments/${segmentId}/frames`,
    { params: { position, count, trim } },
  );
  return data;
}

export async function reprocessSegment(
  segmentId: string,
  body: SegmentReprocessRequest,
  faceswapFile?: File,
): Promise<SegmentResponse> {
  const formData = new FormData();
  formData.append("data", JSON.stringify(body));
  if (faceswapFile) {
    formData.append("faceswap_image", faceswapFile);
  }
  const { data } = await api.post<SegmentResponse>(
    `/segments/${segmentId}/reprocess`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data;
}

export async function deleteSegment(segmentId: string): Promise<void> {
  await api.delete(`/segments/${segmentId}`);
}

export async function makeHologram(
  jobId: string,
  body: HologramRequest,
): Promise<SegmentResponse> {
  const { data } = await api.post<SegmentResponse>(`/jobs/${jobId}/hologram`, body);
  return data;
}

export async function getHologram(segmentId: string): Promise<{
  flavor: string;
  video_path: string;
  manifest_path: string;
  poster_path: string;
  version: string | null; // carrier completed_at — cache-buster for the fixed-key artifacts
}> {
  const { data } = await api.get(`/segments/${segmentId}/hologram`);
  return data;
}

export async function getWorkerSegments(workerId: string): Promise<WorkerSegmentResponse[]> {
  const { data } = await api.get<WorkerSegmentResponse[]>("/segments", {
    params: { worker_id: workerId },
  });
  return data;
}

export function getFileUrl(s3Path: string, version?: string): string {
  const token = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  let url = `${API_URL}/files?path=${encodeURIComponent(s3Path)}`;
  if (token) url += `&token=${encodeURIComponent(token)}`;
  if (version) url += `&v=${encodeURIComponent(version)}`;
  return url;
}

// Returns bytes directly (no S3 redirect) so fetch() + canvas works across origins.
export function getImageDownloadUrl(s3Path: string): string {
  const token = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  let url = `${API_URL}/images/download?path=${encodeURIComponent(s3Path)}`;
  if (token) url += `&token=${encodeURIComponent(token)}`;
  return url;
}

export async function getStats(): Promise<StatsResponse> {
  const { data } = await api.get<StatsResponse>("/stats");
  return data;
}

// --- LoRAs ---

export async function getLoras(): Promise<LoraListItem[]> {
  const { data } = await api.get<LoraListItem[]>("/loras");
  return data;
}

export async function getLora(id: string): Promise<LoraResponse> {
  const { data } = await api.get<LoraResponse>(`/loras/${id}`);
  return data;
}

export async function createLora(body: LoraCreate): Promise<LoraResponse> {
  const { data } = await api.post<LoraResponse>("/loras", body);
  return data;
}

export async function createLoraUpload(
  formData: FormData,
): Promise<LoraResponse> {
  const { data } = await api.post<LoraResponse>("/loras/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function updateLora(
  id: string,
  body: LoraUpdate,
): Promise<LoraResponse> {
  const { data } = await api.patch<LoraResponse>(`/loras/${id}`, body);
  return data;
}

export async function deleteLora(id: string): Promise<void> {
  await api.delete(`/loras/${id}`);
}

export async function getVideoPresets(includeArchived = false): Promise<VideoSettingsPreset[]> {
  const { data } = await api.get<VideoSettingsPreset[]>("/video-presets", {
    params: includeArchived ? { include_archived: true } : undefined,
  });
  return data;
}

/** Archiving hides a preset from the picker without breaking the jobs that used it —
 *  they resolve it by id, which still works. Deleting would lose that record. */
export async function setVideoPresetArchived(
  id: string,
  archived: boolean,
): Promise<VideoSettingsPreset> {
  const { data } = await api.patch<VideoSettingsPreset>(`/video-presets/${id}`, { archived });
  return data;
}

export async function createVideoPreset(body: VideoSettingsPresetCreate): Promise<VideoSettingsPreset> {
  const { data } = await api.post<VideoSettingsPreset>("/video-presets", body);
  return data;
}

export async function updateVideoPreset(
  id: string,
  body: VideoSettingsPresetUpdate,
): Promise<VideoSettingsPreset> {
  const { data } = await api.patch<VideoSettingsPreset>(`/video-presets/${id}`, body);
  return data;
}

export async function deleteVideoPreset(id: string): Promise<void> {
  await api.delete(`/video-presets/${id}`);
}

export async function updateSegmentVideoPreset(
  segmentId: string,
  videoPresetId: string | null,
): Promise<SegmentResponse> {
  const { data } = await api.patch<SegmentResponse>(`/segments/${segmentId}/video-preset`, {
    video_preset_id: videoPresetId,
  });
  return data;
}

// --- Wildcards ---

export async function getWildcards(): Promise<WildcardResponse[]> {
  const { data } = await api.get<WildcardResponse[]>("/wildcards");
  return data;
}

export async function createWildcard(body: WildcardCreate): Promise<WildcardResponse> {
  const { data } = await api.post<WildcardResponse>("/wildcards", body);
  return data;
}

export async function updateWildcard(
  id: string,
  body: WildcardUpdate,
): Promise<WildcardResponse> {
  const { data } = await api.patch<WildcardResponse>(`/wildcards/${id}`, body);
  return data;
}

export async function deleteWildcard(id: string): Promise<void> {
  await api.delete(`/wildcards/${id}`);
}

// --- Title Tags ---

export async function getTags(group?: number): Promise<TitleTagResponse[]> {
  const { data } = await api.get<TitleTagResponse[]>("/tags", {
    params: group !== undefined ? { group } : undefined,
  });
  return data;
}

export async function createTag(body: TitleTagCreate): Promise<TitleTagResponse> {
  const { data } = await api.post<TitleTagResponse>("/tags", body);
  return data;
}

export async function deleteTag(id: string): Promise<void> {
  await api.delete(`/tags/${id}`);
}

// --- Images ---

export async function getImageFolders(): Promise<ImageFolder[]> {
  const { data } = await api.get<ImageFolder[]>("/images/folders");
  return data;
}

export async function getImageFolder(date: string): Promise<ImageFile[]> {
  const { data } = await api.get<ImageFile[]>(`/images/folder/${date}`);
  return data;
}

export async function getFavoriteImages(): Promise<ImageFile[]> {
  const { data } = await api.get<ImageFile[]>("/images/favorites");
  return data;
}

export async function getUntaggedImages(): Promise<ImageFile[]> {
  const { data } = await api.get<ImageFile[]>("/images/untagged");
  return data;
}

/** Delete an image. Refused with 409 when a job or segment still references it; pass
 *  force to delete anyway and accept the dangling reference. */
export async function deleteImage(path: string, force = false): Promise<void> {
  await api.delete("/images", { params: force ? { path, force: true } : { path } });
}

export async function createImageFolder(name: string): Promise<{ name: string }> {
  const { data } = await api.post<{ name: string }>("/images/folders", { name });
  return data;
}

export async function moveImages(keys: string[], targetFolder: string): Promise<{ moved: number }> {
  const { data } = await api.post<{ moved: number }>("/images/move", {
    keys,
    target_folder: targetFolder,
  });
  return data;
}

export async function getImageJobs(path: string): Promise<ImageJobInfo[]> {
  const { data } = await api.get<ImageJobInfo[]>("/images/jobs", {
    params: { path },
  });
  return data;
}

export async function updateImageTags(path: string, tags: string | null): Promise<void> {
  await api.patch("/images/tags", { tags: tags || null }, { params: { path } });
}

export async function searchImages(params: {
  q?: string;
  tags?: string[];
  exclude?: string[];
  limit?: number;
  offset?: number;
}): Promise<ImageSearchResponse> {
  const { data } = await api.get<ImageSearchResponse>("/images/search", {
    params,
    ...REPEAT_ARRAY_PARAMS,
  });
  return data;
}

/** Every tag in use with how many images carry it UNDER THE GIVEN FILTER — so the pills can show
 *  what exists inside the current result set rather than offering dead ends. */
export async function getImageTagCounts(params: {
  q?: string;
  tags?: string[];
  exclude?: string[];
}): Promise<ImageTagCount[]> {
  const { data } = await api.get<{ items: ImageTagCount[] }>("/images/tag-counts", {
    params,
    ...REPEAT_ARRAY_PARAMS,
  });
  return data.items;
}

export async function uploadImage(file: File, folder: string): Promise<{ path: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("folder", folder);
  const { data } = await api.post<{ path: string }>("/images/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// --- App Settings ---

export async function getAppSettings(): Promise<AppSettingsResponse> {
  const { data } = await api.get<AppSettingsResponse>("/settings");
  return data;
}

export async function updateAppSettings(body: AppSettingsUpdate): Promise<AppSettingsResponse> {
  const { data } = await api.put<AppSettingsResponse>("/settings", body);
  return data;
}

// --- Faceswap Presets ---

export async function getFaceswapPresets(): Promise<FaceswapPreset[]> {
  const { data } = await api.get<FaceswapPreset[]>("/faceswap/presets");
  return data;
}

// --- Workers ---

export async function getWorkers(): Promise<WorkerResponse[]> {
  const { data } = await api.get<WorkerResponse[]>("/workers");
  return data;
}

export async function getWorker(id: string): Promise<WorkerResponse> {
  const { data } = await api.get<WorkerResponse>(`/workers/${id}`);
  return data;
}

export async function deleteWorker(id: string): Promise<void> {
  await api.delete(`/workers/${id}`);
}

export interface RunPodAvailability {
  gpu_type_id: string;
  datacenter_id: string;
  available: boolean;
  price_per_hr: number | null;
  stock: string | null;
  cloud_type?: string | null;
}

/** One selectable GPU with its live price and stock.
 *
 *  `available` means RunPod quotes a price for this GPU here — NOT that a pod can be placed on
 *  it. Measured 2026-08-08: community 4090 read available/"Low" for an hour while every create
 *  failed with "this machine does not have the resources", because the hosts existed but were
 *  all partially committed. So a false here is a reliable no; a true is not a yes. */
export interface RunPodGpuOption {
  gpu_type_id: string;
  is_default: boolean;
  available: boolean;
  price_per_hr: number | null;
  stock: string | null;
  error?: string | null;
}

export async function getRunPodGpuOptions(): Promise<RunPodGpuOption[]> {
  const { data } = await api.get<RunPodGpuOption[]>("/runpod/gpu-options");
  return data;
}

export interface RunPodWorker {
  id: string;
  name: string | null;
  /** What we ASKED RunPod for. Not evidence that anything is running — see runtime_ready. */
  status: string | null;
  cost_per_hr: number | null;
  gpu_type_id: string | null;
  created_at?: string | null;
  /** False means the pod is rented and billing but has no container. */
  runtime_ready?: boolean;
  /** Zero on a RUNNING pod means the host never attached a GPU. Fatal and immediate. */
  gpu_count?: number;
}

/** Is the configured GPU purchasable right now? Point-in-time — availability genuinely flaps,
 *  so a launch can still fail after this returns available. */
export interface SegmentRuntimeGroup {
  gpu_name: string;
  width: number;
  height: number;
  clip_seconds: number;
  samples: number;
  avg_seconds: number;
  median_seconds: number;
  min_seconds: number;
  max_seconds: number;
}

/** Run times grouped by GPU AND job shape. Never by GPU alone — the same card runs 480p/3s in
 *  ~330s and 720x1056/5s in ~1780s, so a combined figure describes nothing. */
export async function getSegmentRuntimes(minSamples = 1): Promise<SegmentRuntimeGroup[]> {
  const { data } = await api.get<SegmentRuntimeGroup[]>("/stats/segment-runtimes", {
    params: { min_samples: minSamples },
  });
  return data;
}

export async function getRunPodAvailability(gpuTypeId?: string): Promise<RunPodAvailability> {
  const { data } = await api.get<RunPodAvailability>("/runpod/availability", {
    params: gpuTypeId ? { gpu_type_id: gpuTypeId } : undefined,
  });
  return data;
}

/** Pods RunPod knows about — including ones that have not registered as workers yet.
 *  The gap between "pod RUNNING" and "worker registered" is the boot: model staging, ComfyUI
 *  start, node checks. Without this the Workers page shows nothing during that window. */
export interface GpuReservation {
  id: string;
  name: string;
  status: string;
  expires_at: string;
  drain_after_jobs: number | null;
  gpu_type_id: string | null;
  pod_id: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
}

/** Reservations still waiting. Terminal ones are not returned — the point of the list is
 *  "what is still going to spend money". */
export async function getReservations(): Promise<GpuReservation[]> {
  const { data } = await api.get<GpuReservation[]>("/runpod/reservations");
  return data;
}

export async function createReservation(
  name: string,
  minutes: number,
  drainAfterJobs?: number,
  gpuTypeId?: string,
): Promise<GpuReservation> {
  const { data } = await api.post<GpuReservation>("/runpod/reservations", {
    name,
    minutes,
    drain_after_jobs: drainAfterJobs ?? null,
    gpu_type_id: gpuTypeId ?? null,
  });
  return data;
}

export async function cancelReservation(id: string): Promise<void> {
  await api.delete(`/runpod/reservations/${id}`);
}

/** Terminate a pod outright. Destructive and immediate — it does not wait for in-flight work.
 *  Draining is the graceful path; this exists for a pod that cannot do work at all. */
export async function terminateRunPodWorker(podId: string): Promise<void> {
  await api.delete(`/runpod/workers/${podId}`);
}

export async function getRunPodWorkers(): Promise<RunPodWorker[]> {
  const { data } = await api.get<RunPodWorker[]>("/runpod/workers");
  return data;
}

export async function launchRunPodWorker(
  name: string,
  gpuTypeId?: string,
): Promise<RunPodWorker> {
  const { data } = await api.post<RunPodWorker>("/runpod/workers", {
    name,
    gpu_type_id: gpuTypeId ?? null,
  });
  return data;
}

export async function drainWorker(id: string, afterJobs?: number): Promise<void> {
  const body = afterJobs && afterJobs > 0 ? { after_jobs: afterJobs } : undefined;
  await api.post(`/workers/${id}/drain`, body);
}

export async function cancelDrain(id: string): Promise<void> {
  await api.delete(`/workers/${id}/drain`);
}

export async function renameWorker(id: string, friendlyName: string): Promise<WorkerResponse> {
  const { data } = await api.patch<WorkerResponse>(`/workers/${id}/friendly_name`, {
    friendly_name: friendlyName,
  });
  return data;
}

export async function uploadFile(
  file: File,
  jobId?: string,
): Promise<{ path: string }> {
  const formData = new FormData();
  formData.append("file", file);
  if (jobId) formData.append("job_id", jobId);
  const { data } = await api.post<{ path: string }>("/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// --- Favorites ---

export async function toggleFavorite(body: FavoriteToggleRequest): Promise<FavoriteToggleResponse> {
  const { data } = await api.post<FavoriteToggleResponse>("/favorites/toggle", body);
  return data;
}

export async function getFavorites(itemType?: "video" | "image" | "segment"): Promise<FavoriteListResponse> {
  const { data } = await api.get<FavoriteListResponse>("/favorites", {
    params: itemType ? { item_type: itemType } : undefined,
  });
  return data;
}

export async function getSegmentClips(params?: {
  favorites_only?: boolean;
  width?: number;
  height?: number;
  limit?: number;
  offset?: number;
}): Promise<SegmentClip[]> {
  const { data } = await api.get<SegmentClip[]>("/segments/clips", { params });
  return data;
}

export async function createSmashcut(body: SmashcutBody): Promise<{ id: string; job_id: string }> {
  const { data } = await api.post<{ id: string; job_id: string }>("/smashcut", body);
  return data;
}


/** The controlled observation vocabulary, served rather than hardcoded here.
 *
 *  One source of truth so a tag written by the UI is the same string later analysis groups on.
 *  That grouping is the entire value — "mouth-void" and "mouth void" are two labels. */
export async function getObservationTags(): Promise<string[]> {
  const { data } = await api.get<string[]>("/segments/observation-tags");
  return data;
}

export interface SegmentAnnotation {
  notes?: string | null;
  rating?: number | null;
  observation_tags?: string[];
}

/** Record what a human saw. Writes nothing generation reads. */
export async function annotateSegment(
  segmentId: string,
  body: SegmentAnnotation,
): Promise<SegmentResponse> {
  const { data } = await api.patch<SegmentResponse>(`/segments/${segmentId}/annotation`, body);
  return data;
}


/** Queued work versus workers able to take it.
 *
 *  `stalled` requires BOTH halves — queued work with a busy worker is a queue doing its job, and
 *  no workers with an empty queue is a quiet night. The 3090 was down for thirteen hours with
 *  four segments waiting and nothing said so; every fact was recorded and nothing combined them. */
export interface QueueHealth {
  pending_segments: number;
  live_workers: number;
  stalled: boolean;
  last_worker_seen: string | null;
  summary: string;
}

export async function getQueueHealth(): Promise<QueueHealth> {
  const { data } = await api.get<QueueHealth>("/queue-health");
  return data;
}


/** Take a segment out of the video, keeping its rating, tags and notes.
 *
 *  Not a delete: the row survives, and so does the clip. A bad segment is frequently the most
 *  informative one, so discarding the observation to get it out of the cut is backwards. The
 *  discarded row keeps its index, so a regenerated segment takes the same position. */
export async function discardSegment(segmentId: string): Promise<SegmentResponse> {
  const { data } = await api.post<SegmentResponse>(`/segments/${segmentId}/discard`);
  return data;
}
