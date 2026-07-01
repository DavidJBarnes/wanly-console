import { create } from "zustand";
import { getAppSettings, updateAppSettings } from "../api/client";
import type { AppSettingsUpdate } from "../api/types";

interface SettingsState {
  negativePrompt: string;
  loaded: boolean;
  fetchSettings: () => Promise<void>;
  saveSettings: (updates: AppSettingsUpdate) => Promise<void>;
  setNegativePrompt: (value: string) => void;
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  negativePrompt: "",
  loaded: false,
  fetchSettings: async () => {
    try {
      const s = await getAppSettings();
      set({ negativePrompt: s.negative_prompt, loaded: true });
    } catch {
      // Use defaults if API is unreachable
      set({ loaded: true });
    }
  },
  saveSettings: async (updates) => {
    const s = await updateAppSettings(updates);
    set({ negativePrompt: s.negative_prompt });
  },
  setNegativePrompt: (value) => set({ negativePrompt: value }),
}));
