import axios from "axios";
import type {
  TokenResponse,
  JobResponse,
  JobListResponse,
  JobDetailResponse,
  JobUpdate,
  SegmentCreate,
  SegmentResponse,
  FramePreviewResponse,
  WorkerResponse,
  LoraListItem,
  LoraResponse,
  LoraCreate,
  LoraUpdate,
  StatsResponse,
  WorkerSegmentResponse,
  PromptPreset,
  PromptPresetCreate,
  PromptPresetUpdate,
  WildcardResponse,
  WildcardCreate,
  WildcardUpdate,
  FaceswapPreset,
  TitleTagResponse,
  TitleTagCreate,
  ImageFolder,
  ImageFile,
  AppSettingsResponse,
  AppSettingsUpdate,
} from "./types";
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

export async function deleteSegment(segmentId: string): Promise<void> {
  await api.delete(`/segments/${segmentId}`);
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

// --- Prompt Presets ---

export async function getPromptPresets(): Promise<PromptPreset[]> {
  const { data } = await api.get<PromptPreset[]>("/prompt-presets");
  return data;
}

export async function createPromptPreset(body: PromptPresetCreate): Promise<PromptPreset> {
  const { data } = await api.post<PromptPreset>("/prompt-presets", body);
  return data;
}

export async function updatePromptPreset(
  id: string,
  body: PromptPresetUpdate,
): Promise<PromptPreset> {
  const { data } = await api.patch<PromptPreset>(`/prompt-presets/${id}`, body);
  return data;
}

export async function deletePromptPreset(id: string): Promise<void> {
  await api.delete(`/prompt-presets/${id}`);
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

export async function deleteImage(path: string): Promise<void> {
  await api.delete("/images", { params: { path } });
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
