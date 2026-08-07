import { create } from "zustand";
import { getVideoPresets } from "../api/client";
import type { VideoSettingsPreset } from "../api/types";

interface VideoPresetState {
  /** Active presets — the list every picker offers. Archiving is only meaningful if it
   *  takes a preset out of here. */
  presets: VideoSettingsPreset[];
  /** Every preset including archived ones, for resolving a preset BY ID. A job holds the id of
   *  whatever preset it ran with; if that preset was later archived and we looked it up in
   *  `presets`, the job would silently render its raw sampler values instead of the preset's —
   *  which is exactly the history that archiving (rather than deleting) exists to keep. */
  allPresets: VideoSettingsPreset[];
  loading: boolean;
  error: string | null;
  fetchPresets: () => Promise<void>;
  /** Fold a single already-persisted preset back into both lists.
   *
   *  Mutating one preset used to be followed by fetchPresets(), which flips `loading` and makes
   *  the library swap its whole grid for a spinner — every card unmounts and remounts, which
   *  reads as a full page postback for what is a one-field change. The PATCH response already
   *  contains the updated preset, so there is nothing to go back to the server for. */
  applyPreset: (updated: VideoSettingsPreset) => void;
}

export const useVideoPresetStore = create<VideoPresetState>((set) => ({
  presets: [],
  allPresets: [],
  loading: false,
  error: null,

  fetchPresets: async () => {
    set({ loading: true, error: null });
    try {
      // One fetch, two views. Asking for everything and splitting here keeps the two concerns
      // from racing each other through a single shared store.
      const all = await getVideoPresets(true);
      all.sort((a, b) => a.name.localeCompare(b.name));
      set({
        allPresets: all,
        presets: all.filter((p) => !p.archived),
        loading: false,
      });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Failed to fetch presets",
      });
    }
  },

  applyPreset: (updated) =>
    set((state) => {
      // Replace in place so the existing sort order is preserved without re-sorting, and so
      // React sees the same keys for every other card and leaves them mounted.
      const allPresets = state.allPresets.map((p) => (p.id === updated.id ? updated : p));
      return { allPresets, presets: allPresets.filter((p) => !p.archived) };
    }),
}));
