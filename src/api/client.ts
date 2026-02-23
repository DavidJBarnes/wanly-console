import axios from "axios";
import type {
  TokenResponse,
  JobResponse,
  JobListResponse,
  JobDetailResponse,
  JobUpdate,
  SegmentCreate,
  SegmentResponse,
  WorkerResponse,
  LoraListItem,
  LoraResponse,
  LoraCreate,
  LoraUpdate,
  StatsResponse,
  WorkerSegmentResponse,
  WildcardResponse,
  WildcardCreate,
  WildcardUpdate,
  FaceswapPreset,
  TitleTagResponse,
  TitleTagCreate,
} from "./types";

const API_URL = import.meta.env.VITE_API_URL || "/api";
const REGISTRY_URL = import.meta.env.VITE_REGISTRY_URL || "/registry";

const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
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
  let url = `${API_URL}/files?path=${encodeURIComponent(s3Path)}`;
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

// --- Faceswap Presets ---

export async function getFaceswapPresets(): Promise<FaceswapPreset[]> {
  const { data } = await api.get<FaceswapPreset[]>("/faceswap/presets");
  return data;
}

// --- Registry (workers) ---

const registry = axios.create({
  baseURL: REGISTRY_URL,
});

export async function getWorkers(): Promise<WorkerResponse[]> {
  const { data } = await registry.get<WorkerResponse[]>("/workers");
  return data;
}

export async function getWorker(id: string): Promise<WorkerResponse> {
  const { data } = await registry.get<WorkerResponse>(`/workers/${id}`);
  return data;
}

export async function deleteWorker(id: string): Promise<void> {
  await registry.delete(`/workers/${id}`);
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
