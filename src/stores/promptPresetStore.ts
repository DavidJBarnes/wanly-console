import { create } from "zustand";
import { getPromptPresets } from "../api/client";
import type { PromptPreset } from "../api/types";

interface PromptPresetState {
  presets: PromptPreset[];
  loading: boolean;
  error: string | null;
  fetchPresets: () => Promise<void>;
}

export const usePromptPresetStore = create<PromptPresetState>((set) => ({
  presets: [],
  loading: false,
  error: null,

  fetchPresets: async () => {
    set({ loading: true, error: null });
    try {
      const presets = await getPromptPresets();
      presets.sort((a, b) => a.name.localeCompare(b.name));
      set({ presets, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Failed to fetch presets",
      });
    }
  },
}));
