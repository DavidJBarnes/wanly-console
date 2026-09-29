import { create } from "zustand";
import { getAppSettings, updateAppSettings } from "../api/client";
import type {
  AppSettingsResponse, AppSettingsUpdate, CaptionStyle, MotionStyle,
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
 * API returns it and fetchSettings quietly stores undefined. The motion fields below are
 * safe only because wanly-api returns them unconditionally (defaults in
 * routes/app_settings.py::_DEFAULTS), and AppSettingsResponse declares them as required,
 * not optional — so a response missing them is a compile error here, which is the point.
 *
 * THE PROMPT EDITORS (console#555) hold a DRAFT, pre-filled with the effective text (the saved
 * override, or the default it stands in for), beside the saved override itself. Kept here
 * rather than in the page because both are seeded from the same response: seeding page state
 * from the store would need an effect, and the draft must be re-seeded after every save.
 */
interface SettingsState {
  negativePrompt: string;
  /** How verbose <SCENE> descriptions are (console#405). */
  captionStyle: CaptionStyle;
  /** The styles as SAVED; the two above follow the dropdowns before Save. The Try panel
   *  needs both to know whether the page differs from what is saved. */
  savedCaptionStyle: CaptionStyle;
  savedMotionStyle: MotionStyle;
  /** The SAVED caption override; "" means the style's prompt. */
  captionInstruction: string;
  /** The caption editor's text: the effective prompt, or the user's unsaved edit of it. */
  captionDraft: string;
  /** The default text of every caption style, from the API. */
  captionStylePrompts: Record<string, string>;
  /** The capture style of the motion half (#326). */
  motionStyle: MotionStyle;
  /** The SAVED motion template; "" means motionTemplateDefault. */
  motionInstruction: string;
  /** The motion editor's text. */
  motionDraft: string;
  motionStylePrompts: Record<string, string>;
  motionTemplateDefault: string;
  motionPlaceholders: Record<string, string>;
  promptMaxLength: number;
  loaded: boolean;
  fetchSettings: () => Promise<void>;
  saveSettings: (updates: AppSettingsUpdate) => Promise<void>;
  setNegativePrompt: (value: string) => void;
  setCaptionStyle: (value: CaptionStyle) => void;
  setCaptionDraft: (value: string) => void;
  setMotionStyle: (value: MotionStyle) => void;
  setMotionDraft: (value: string) => void;
}

/** Everything a settings response determines, drafts included. */
function fromResponse(s: AppSettingsResponse): Partial<SettingsState> {
  const captionStylePrompts = s.caption_style_prompts ?? {};
  return {
    negativePrompt: s.negative_prompt,
    captionStyle: s.caption_style,
    savedCaptionStyle: s.caption_style,
    savedMotionStyle: s.motion_style,
    captionInstruction: s.caption_instruction,
    captionDraft: effectiveText(s.caption_instruction, captionStylePrompts[s.caption_style] ?? ""),
    captionStylePrompts,
    motionStyle: s.motion_style,
    motionInstruction: s.motion_instruction,
    motionDraft: effectiveText(s.motion_instruction, s.motion_template_default),
    motionStylePrompts: s.motion_style_prompts ?? {},
    motionTemplateDefault: s.motion_template_default,
    motionPlaceholders: s.motion_placeholders,
    promptMaxLength: s.prompt_max_length,
  };
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  negativePrompt: "",
  captionStyle: "standard",
  savedCaptionStyle: "standard",
  savedMotionStyle: "handheld",
  captionInstruction: "",
  captionDraft: "",
  captionStylePrompts: {},
  motionStyle: "handheld",
  motionInstruction: "",
  motionDraft: "",
  motionStylePrompts: {},
  motionTemplateDefault: "",
  motionPlaceholders: {},
  promptMaxLength: 4000,
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
  setMotionStyle: (value) => set({ motionStyle: value }),
  setMotionDraft: (value) => set({ motionDraft: value }),
}));
