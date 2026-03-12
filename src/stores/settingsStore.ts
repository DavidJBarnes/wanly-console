import { create } from "zustand";
import { getAppSettings, updateAppSettings } from "../api/client";
import type { AppSettingsUpdate } from "../api/types";

interface SettingsState {
  defaultLightx2vHigh: string;
  defaultLightx2vLow: string;
  defaultCfgHigh: string;
  defaultCfgLow: string;
  loaded: boolean;
  fetchSettings: () => Promise<void>;
  saveSettings: (updates: AppSettingsUpdate) => Promise<void>;
  setDefaultLightx2vHigh: (value: string) => void;
  setDefaultLightx2vLow: (value: string) => void;
  setDefaultCfgHigh: (value: string) => void;
  setDefaultCfgLow: (value: string) => void;
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  defaultLightx2vHigh: "2.0",
  defaultLightx2vLow: "1.0",
  defaultCfgHigh: "1",
  defaultCfgLow: "1",
  loaded: false,
  fetchSettings: async () => {
    try {
      const s = await getAppSettings();
      set({
        defaultLightx2vHigh: String(s.lightx2v_strength_high),
        defaultLightx2vLow: String(s.lightx2v_strength_low),
        defaultCfgHigh: String(s.cfg_high),
        defaultCfgLow: String(s.cfg_low),
        loaded: true,
      });
    } catch {
      // Use defaults if API is unreachable
      set({ loaded: true });
    }
  },
  saveSettings: async (updates) => {
    const s = await updateAppSettings(updates);
    set({
      defaultLightx2vHigh: String(s.lightx2v_strength_high),
      defaultLightx2vLow: String(s.lightx2v_strength_low),
      defaultCfgHigh: String(s.cfg_high),
      defaultCfgLow: String(s.cfg_low),
    });
  },
  setDefaultLightx2vHigh: (value) => set({ defaultLightx2vHigh: value }),
  setDefaultLightx2vLow: (value) => set({ defaultLightx2vLow: value }),
  setDefaultCfgHigh: (value) => set({ defaultCfgHigh: value }),
  setDefaultCfgLow: (value) => set({ defaultCfgLow: value }),
}));
