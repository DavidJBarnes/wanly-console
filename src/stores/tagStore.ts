import { create } from "zustand";
import { getTags, createTag, deleteTag, updateTagDescription } from "../api/client";
import { ACTION_GROUP, PERSON_GROUP } from "../lib/tagGroups";
import type { TitleTagResponse } from "../api/types";

interface TagState {
  /** Person tags (group 1). */
  titleTags1: TitleTagResponse[];
  /** Action tags (group 2) -- the ones with a description (wanly-api#486). */
  titleTags2: TitleTagResponse[];
  loading: boolean;
  error: string | null;
  fetchTags: () => Promise<void>;
  addTag: (name: string, group: number) => Promise<void>;
  removeTag: (id: string) => Promise<void>;
  setDescription: (id: string, description: string) => Promise<void>;
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
      const g1 = all.filter((t) => t.group === PERSON_GROUP).sort((a, b) => a.name.localeCompare(b.name));
      const g2 = all.filter((t) => t.group === ACTION_GROUP).sort((a, b) => a.name.localeCompare(b.name));
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
      const key = group === PERSON_GROUP ? "titleTags1" : "titleTags2";
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

  setDescription: async (id: string, description: string) => {
    const tag = await updateTagDescription(id, description);
    set({ titleTags2: get().titleTags2.map((t) => (t.id === id ? tag : t)) });
  },
}));
