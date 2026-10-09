/**
 * Derived images grouped with their source on a dataset's page (wanly-api#445).
 *
 * Crops, upscales, edits and duplicates used to sit among 100+ images with nothing tying them
 * to their originals; choosing between a photo and its crop meant finding both by eye. The API
 * records `derived[uri] = {from, how}`; these pure helpers turn that into groups.
 *
 * A GROUP is led by its ROOT: follow `from` while the source is still in the set, so a crop of
 * an edit lands with the photo the edit was made of. A derived image whose source LEFT the set
 * leads its own group (and says where it came from). The anchor always comes first.
 */
import type { DatasetDerived, DerivedHow } from "../api/types";

export type Role = "original" | DerivedHow;

export interface GroupMember { uri: string; role: Role }
export interface ImageGroup { head: string; members: GroupMember[] }

export const ROLE_LABEL: Record<Role, string> = {
  original: "original", crop: "crop", upscale: "upscale", edit: "edit",
  fix_crop: "fix crop", duplicate: "duplicate",
};

type Derived = Record<string, DatasetDerived> | null | undefined;

/** The image a derived one belongs under: its furthest ancestor still in the set. */
export function rootOf(uri: string, derived: Derived, inSet: Set<string>): string {
  let cur = uri;
  const seen = new Set<string>([cur]);
  for (;;) {
    const from = derived?.[cur]?.from;
    if (!from || !inSet.has(from) || seen.has(from)) return cur;
    seen.add(from);
    cur = from;
  }
}

/** The source a derived image was made from, when that source is no longer in the set. */
export function removedSource(uri: string, derived: Derived, inSet: Set<string>): string | null {
  const from = derived?.[uri]?.from;
  return from && !inSet.has(from) ? from : null;
}

/**
 * Groups in the order given (the page's order: the set's own, or worst first), each placed
 * where its earliest member falls. Every image is in exactly one group; a lone image is a
 * group of one. The head is the root; its role is "original" unless it was itself derived
 * from something that left the set.
 */
export function groupDerived(ordered: string[], derived: Derived): ImageGroup[] {
  const inSet = new Set(ordered);
  const byRoot = new Map<string, ImageGroup>();
  const out: ImageGroup[] = [];
  for (const uri of ordered) {
    const root = rootOf(uri, derived, inSet);
    let g = byRoot.get(root);
    if (!g) {
      g = { head: root, members: [] };
      byRoot.set(root, g);
      out.push(g);
    }
    if (uri !== root) g.members.push({ uri, role: derived?.[uri]?.how ?? "original" });
  }
  for (const g of out) {
    const headHow = derived?.[g.head]?.how;
    g.members.unshift({ uri: g.head, role: headHow ?? "original" });
  }
  return out;
}

/** The anchor's group first (and, ungrouped, the anchor first). An anchor not in the set is
 *  no anchor at all. */
export function anchorFirst<T>(items: T[], anchor: string | null | undefined,
                               has: (item: T, uri: string) => boolean): T[] {
  if (!anchor) return items;
  const i = items.findIndex((it) => has(it, anchor));
  if (i <= 0) return items;
  return [items[i], ...items.slice(0, i), ...items.slice(i + 1)];
}

/** The set's images after "keep only this" on one member of a group: the group's other
 *  members leave; nothing else changes. Files are never deleted (wanly-api#421). */
export function keepOnly(images: string[], group: ImageGroup, keep: string): string[] {
  const drop = new Set(group.members.map((m) => m.uri).filter((u) => u !== keep));
  return images.filter((u) => !drop.has(u));
}
