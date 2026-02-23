import { create } from "zustand";
import { getTags, createTag, deleteTag } from "../api/client";
import type { TitleTagResponse } from "../api/types";

interface TagState {
  titleTags1: TitleTagResponse[];
  titleTags2: TitleTagResponse[];
  loading: boolean;
  error: string | null;
  fetchTags: () => Promise<void>;
  addTag: (name: string, group: number) => Promise<void>;
  removeTag: (id: string) => Promise<void>;
}

export const useTagStore = create<TagState>((set, get) => ({
  titleTags1: [],
  titleTags2: [],
  loading: false,
  error: null,

  fetchTags: async () => {
    set({ loading: true, error: null });
    try {
      const all = await getTags();
      const g1 = all.filter((t) => t.group === 1).sort((a, b) => a.name.localeCompare(b.name));
      const g2 = all.filter((t) => t.group === 2).sort((a, b) => a.name.localeCompare(b.name));
      set({ titleTags1: g1, titleTags2: g2, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Failed to fetch tags",
      });
    }
  },

  addTag: async (name: string, group: number) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const tag = await createTag({ name: trimmed, group });
      const key = group === 1 ? "titleTags1" : "titleTags2";
      const current = get()[key];
      const updated = [...current, tag].sort((a, b) => a.name.localeCompare(b.name));
      set({ [key]: updated } as Pick<TagState, typeof key>);
    } catch {
      // duplicate or network error — re-fetch to stay in sync
      await get().fetchTags();
    }
  },

  removeTag: async (id: string) => {
    // Optimistically remove from whichever group contains it
    const { titleTags1, titleTags2 } = get();
    set({
      titleTags1: titleTags1.filter((t) => t.id !== id),
      titleTags2: titleTags2.filter((t) => t.id !== id),
    });
    try {
      await deleteTag(id);
    } catch {
      // Revert on failure
      await get().fetchTags();
    }
  },
}));
