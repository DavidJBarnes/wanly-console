import { create } from "zustand";
import { getAppSettings, updateAppSettings } from "../api/client";
import type {
  AppSettingsResponse, AppSettingsUpdate, CaptionStyle, QueuePosition,
} from "../api/types";
import { draftAfterStyleChange, effectiveText } from "../lib/captionPrompts";

/**
 * Global app settings.
 *
 * This store used to carry seven WAN 2.2 fields — lightx2v_strength_high/low, cfg_high/low,
 * steps_total, high_noise_steps, flow_shift — that the API stopped returning when WAN was
 * retired. Nothing failed: `String(undefined)` is the string "undefined", so the store held
 * plausible-looking values that were never real, and TypeScript could not catch it because
 * the response type still declared the fields. Removed (console#390).
 *
 * The same trap runs the other way when ADDING a field: declare it in the store before the
 * API returns it and fetchSettings quietly stores undefined. Declare such a field as
 * required on AppSettingsResponse only once wanly-api returns it unconditionally (defaults in
 * routes/app_settings.py::_DEFAULTS). The motion-caption fields went the same way as WAN's
 * when the motion half was removed (wanly-api#481).
 *
 * THE PROMPT EDITOR (console#555) holds a DRAFT, pre-filled with the effective text (the saved
 * override, or the default it stands in for), beside the saved override itself. Kept here
 * rather than in the page because both are seeded from the same response: seeding page state
 * from the store would need an effect, and the draft must be re-seeded after every save.
 */
interface SettingsState {
  negativePrompt: string;
  /** How verbose <SCENE> descriptions are (console#405). */
  captionStyle: CaptionStyle;
  /** The style as SAVED; the one above follows the dropdown before Save. The Try panel
   *  needs both to know whether the page differs from what is saved. */
  savedCaptionStyle: CaptionStyle;
  /** The SAVED caption override; "" means the style's prompt. */
  captionInstruction: string;
  /** The caption editor's text: the effective prompt, or the user's unsaved edit of it. */
  captionDraft: string;
  /** The default text of every caption style, from the API. */
  captionStylePrompts: Record<string, string>;
  promptMaxLength: number;
  /** Where a newly queued segment lands (wanly-api#471). Saved the moment it is switched. */
  segmentQueuePosition: QueuePosition;
  loaded: boolean;
  fetchSettings: () => Promise<void>;
  saveSettings: (updates: AppSettingsUpdate) => Promise<void>;
  setNegativePrompt: (value: string) => void;
  setCaptionStyle: (value: CaptionStyle) => void;
  setCaptionDraft: (value: string) => void;
  saveQueuePosition: (value: QueuePosition) => Promise<void>;
}

/** Everything a settings response determines, drafts included. */
function fromResponse(s: AppSettingsResponse): Partial<SettingsState> {
  const captionStylePrompts = s.caption_style_prompts ?? {};
  return {
    negativePrompt: s.negative_prompt,
    captionStyle: s.caption_style,
    savedCaptionStyle: s.caption_style,
    captionInstruction: s.caption_instruction,
    captionDraft: effectiveText(s.caption_instruction, captionStylePrompts[s.caption_style] ?? ""),
    captionStylePrompts,
    promptMaxLength: s.prompt_max_length,
    segmentQueuePosition: s.segment_queue_position,
  };
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  negativePrompt: "",
  captionStyle: "standard",
  savedCaptionStyle: "standard",
  captionInstruction: "",
  captionDraft: "",
  captionStylePrompts: {},
  promptMaxLength: 4000,
  segmentQueuePosition: "top",
  loaded: false,
  fetchSettings: async () => {
    try {
      const s = await getAppSettings();
      set({ ...fromResponse(s), loaded: true });
    } catch {
      // Defaults stand if the API is unreachable. `loaded` still flips so the page renders
      // its form rather than spinning forever on a request that will not arrive.
      set({ loaded: true });
    }
  },
  saveSettings: async (updates) => {
    const s = await updateAppSettings(updates);
    set(fromResponse(s));
  },
  setNegativePrompt: (value) => set({ negativePrompt: value }),
  // An untouched caption draft follows the style, so choosing "rich" shows what rich asks for.
  setCaptionStyle: (value) => set((st) => ({
    captionStyle: value,
    captionDraft: draftAfterStyleChange(
      st.captionDraft,
      st.captionStylePrompts[st.captionStyle] ?? "",
      st.captionStylePrompts[value] ?? "",
    ),
  })),
  setCaptionDraft: (value) => set({ captionDraft: value }),
  // Takes only the queue field from the response: a switch saves on its own, and taking the
  // whole response would throw away unsaved edits in the prompt editor on the same page.
  saveQueuePosition: async (value) => {
    const s = await updateAppSettings({ segment_queue_position: value });
    set({ segmentQueuePosition: s.segment_queue_position });
  },
}));
