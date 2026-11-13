/** Keyboard shortcuts for the Videos players (console#765). */
export type PlayerAction = "next" | "prev" | "fullscreen";

interface KeyLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  target?: EventTarget | null;
}

/**
 * N / PageDown = next clip, P / PageUp = previous, F = fullscreen.
 *
 * Not the arrow keys: a focused <video> already uses them to seek, so one press would seek
 * AND skip. Nothing while typing in a field, and nothing with a modifier held (Ctrl+F is find).
 */
export function playerAction(e: KeyLike): PlayerAction | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName ?? ""))) {
    return null;
  }
  switch (e.key) {
    case "n": case "N": case "PageDown": return "next";
    case "p": case "P": case "PageUp": return "prev";
    case "f": case "F": return "fullscreen";
    default: return null;
  }
}
