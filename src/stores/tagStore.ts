import { create } from "zustand";

interface TagState {
  titleTags1: string[];
  titleTags2: string[];
  addTag1: (tag: string) => void;
  removeTag1: (tag: string) => void;
  addTag2: (tag: string) => void;
  removeTag2: (tag: string) => void;
}

function loadTags(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export const useTagStore = create<TagState>((set, get) => ({
  titleTags1: loadTags("titleTags1"),
  titleTags2: loadTags("titleTags2"),

  addTag1: (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    const current = get().titleTags1;
    if (current.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return;
    const updated = [...current, trimmed];
    localStorage.setItem("titleTags1", JSON.stringify(updated));
    set({ titleTags1: updated });
  },

  removeTag1: (tag: string) => {
    const updated = get().titleTags1.filter((t) => t !== tag);
    localStorage.setItem("titleTags1", JSON.stringify(updated));
    set({ titleTags1: updated });
  },

  addTag2: (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    const current = get().titleTags2;
    if (current.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return;
    const updated = [...current, trimmed];
    localStorage.setItem("titleTags2", JSON.stringify(updated));
    set({ titleTags2: updated });
  },

  removeTag2: (tag: string) => {
    const updated = get().titleTags2.filter((t) => t !== tag);
    localStorage.setItem("titleTags2", JSON.stringify(updated));
    set({ titleTags2: updated });
  },
}));
