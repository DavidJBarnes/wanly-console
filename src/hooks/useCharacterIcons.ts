import { useEffect, useState } from "react";
import { listRecipes } from "../api/ltx";
import { getFileUrl } from "../api/client";
import { characterIconUri } from "../lib/characterIcon";

/** name (lower-cased) -> the character's icon URL, for showing a face beside a name wherever
 *  a tag or label happens to be a character (the Videos page tags). One /recipes read per
 *  mount; a character with no image at all is left out, so callers show the plain name. */
export function useCharacterIcons(): Map<string, string> {
  const [icons, setIcons] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    listRecipes().then((b) => {
      if (!live) return;
      const m = new Map<string, string>();
      for (const c of b.characters) {
        const uri = characterIconUri(c);
        if (uri) m.set(c.name.toLowerCase(), getFileUrl(uri));
      }
      setIcons(m);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return icons;
}
