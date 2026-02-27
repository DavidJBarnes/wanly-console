import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  defaultLightx2vHigh: string;
  defaultLightx2vLow: string;
  setDefaultLightx2vHigh: (value: string) => void;
  setDefaultLightx2vLow: (value: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      defaultLightx2vHigh: "2.0",
      defaultLightx2vLow: "1.0",
      setDefaultLightx2vHigh: (value) => set({ defaultLightx2vHigh: value }),
      setDefaultLightx2vLow: (value) => set({ defaultLightx2vLow: value }),
    }),
    { name: "wanly-settings" },
  ),
);
