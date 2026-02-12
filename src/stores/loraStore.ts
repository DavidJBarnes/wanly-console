import { create } from "zustand";
import { getLoras } from "../api/client";
import type { LoraListItem } from "../api/types";

interface LoraState {
  loras: LoraListItem[];
  loading: boolean;
  error: string | null;
  fetchLoras: () => Promise<void>;
}

export const useLoraStore = create<LoraState>((set) => ({
  loras: [],
  loading: false,
  error: null,

  fetchLoras: async () => {
    set({ loading: true, error: null });
    try {
      const loras = await getLoras();
      set({ loras, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Failed to fetch LoRAs",
      });
    }
  },
}));
