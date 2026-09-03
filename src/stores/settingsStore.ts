import { create } from "zustand";
import { getAppSettings, updateAppSettings } from "../api/client";
import type { AppSettingsUpdate, CaptionStyle } from "../api/types";

/**
 * Global app settings.
 *
 * This store used to carry seven WAN 2.2 fields — lightx2v_strength_high/low, cfg_high/low,
 * steps_total, high_noise_steps, flow_shift — that the API stopped returning when WAN was
 * retired. Nothing failed: `String(undefined)` is the string "undefined", so the store held
 * plausible-looking values that were never real, and TypeScript could not catch it because
 * the response type still declared the fields. Removed (console#390).
 */
interface SettingsState {
  negativePrompt: string;
  /** How verbose <SCENE> descriptions are (console#405). */
  captionStyle: CaptionStyle;
  /** Non-empty overrides the style entirely. */
  captionInstruction: string;
  /** What each style actually asks the captioner for, so the UI can show it. */
  captionStylePrompts: Record<string, string>;
  loaded: boolean;
  fetchSettings: () => Promise<void>;
  saveSettings: (updates: AppSettingsUpdate) => Promise<void>;
  setNegativePrompt: (value: string) => void;
  setCaptionStyle: (value: CaptionStyle) => void;
  setCaptionInstruction: (value: string) => void;
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  negativePrompt: "",
  captionStyle: "standard",
  captionInstruction: "",
  captionStylePrompts: {},
  loaded: false,
  fetchSettings: async () => {
    try {
      const s = await getAppSettings();
      set({
        negativePrompt: s.negative_prompt,
        captionStyle: s.caption_style,
        captionInstruction: s.caption_instruction,
        captionStylePrompts: s.caption_style_prompts ?? {},
        loaded: true,
      });
    } catch {
      // Defaults stand if the API is unreachable. `loaded` still flips so the page renders
      // its form rather than spinning forever on a request that will not arrive.
      set({ loaded: true });
    }
  },
  saveSettings: async (updates) => {
    const s = await updateAppSettings(updates);
    set({
      negativePrompt: s.negative_prompt,
      captionStyle: s.caption_style,
      captionInstruction: s.caption_instruction,
      captionStylePrompts: s.caption_style_prompts ?? {},
    });
  },
  setNegativePrompt: (value) => set({ negativePrompt: value }),
  setCaptionStyle: (value) => set({ captionStyle: value }),
  setCaptionInstruction: (value) => set({ captionInstruction: value }),
}));
