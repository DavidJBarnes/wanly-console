import { create } from "zustand";
import { getJobs } from "../api/client";
import type { JobResponse } from "../api/types";

interface JobState {
  jobs: JobResponse[];
  loading: boolean;
  error: string | null;
  fetchJobs: () => Promise<void>;
}

export const useJobStore = create<JobState>((set) => ({
  jobs: [],
  loading: false,
  error: null,

  fetchJobs: async () => {
    set({ loading: true, error: null });
    try {
      const res = await getJobs({ limit: 200 });
      set({ jobs: res.items, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Failed to fetch jobs",
      });
    }
  },
}));
