import { useEffect } from "react";
import { create } from "zustand";

import { getFileUrl } from "../api/client";
import { listRecipes } from "../api/ltx";
import { characterIconUri } from "../lib/characterIcon";

/** A read this recent is reused rather than repeated. Every badge on a page mounts the hook
 *  (console#684), so without this a page of chips would be a page of /recipes reads; with it,
 *  navigating still picks up an icon changed on the Characters page a moment ago. */
const FRESH_MS = 30_000;

interface CharacterIconStore {
  icons: Map<string, string>;
  loadedAt: number;
  loading: boolean;
  refresh: () => void;
}

const useCharacterIconStore = create<CharacterIconStore>((set, get) => ({
  icons: new Map(),
  loadedAt: 0,
  loading: false,
  refresh: () => {
    const { loading, loadedAt } = get();
    if (loading || Date.now() - loadedAt < FRESH_MS) return;
    set({ loading: true });
    listRecipes().then((b) => {
      const m = new Map<string, string>();
      for (const c of b.characters) {
        const uri = characterIconUri(c);
        if (uri) m.set(c.name.toLowerCase(), getFileUrl(uri));
      }
      set({ icons: m, loadedAt: Date.now(), loading: false });
    }).catch(() => set({ loading: false }));
  },
}));

/** name (lower-cased) -> the character's icon URL, for showing a face beside a name wherever
 *  a tag or label happens to be a character (TagChip, the Training history). One shared map
 *  for the whole app, refreshed at most every FRESH_MS; a character with no image at all is
 *  left out, so callers show the plain name. Look names up with iconForName. */
export function useCharacterIcons(): Map<string, string> {
  const icons = useCharacterIconStore((s) => s.icons);
  const refresh = useCharacterIconStore((s) => s.refresh);
  useEffect(() => { refresh(); }, [refresh]);
  return icons;
}
