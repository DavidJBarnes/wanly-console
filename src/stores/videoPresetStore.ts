import { create } from "zustand";
import { getVideoPresets } from "../api/client";
import type { VideoSettingsPreset } from "../api/types";

interface VideoPresetState {
  presets: VideoSettingsPreset[];
  loading: boolean;
  error: string | null;
  fetchPresets: () => Promise<void>;
}

export const useVideoPresetStore = create<VideoPresetState>((set) => ({
  presets: [],
  loading: false,
  error: null,

  fetchPresets: async () => {
    set({ loading: true, error: null });
    try {
      const presets = await getVideoPresets();
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
