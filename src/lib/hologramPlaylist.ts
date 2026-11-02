// The shuffled AR playlist (console#713). Kept out of HologramPlayer.tsx for the same reason as
// arFollow: this is the logic worth testing, and testing it should not need a headset.

import type { ArSettings } from "./arFollow";

/** A clip shorter than this plays again before the playlist moves on: a three second clip that
 *  appears and vanishes reads as a glitch, not as something you watched. */
export const MIN_CLIP_SECONDS = 15;

/** localStorage key for what a playlist carries from clip to clip. */
export const SHUFFLE_SETTINGS_KEY = "ar-settings:shuffle";

export interface Playlist<T> {
  clips: T[];
  index: number;
}

export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Move by one clip. Running off the end deals a fresh shuffle, so a long session is not the same
 *  loop over and over, without letting the clip that just played come straight back. Going back
 *  from the start wraps to the last clip and leaves the order alone. */
export function stepPlaylist<T>(
  playlist: Playlist<T>,
  delta: 1 | -1,
  random: () => number = Math.random,
): Playlist<T> {
  const { clips, index } = playlist;
  if (clips.length < 2) return playlist;
  if (delta === -1) return { clips, index: index === 0 ? clips.length - 1 : index - 1 };
  if (index < clips.length - 1) return { clips, index: index + 1 };
  const last = clips[index];
  const next = shuffled(clips, random);
  if (next[0] === last) {
    const swap = 1 + Math.floor(random() * (next.length - 1));
    [next[0], next[swap]] = [next[swap], next[0]];
  }
  return { clips: next, index: 0 };
}

export interface FaceButtons {
  /** A on the right controller, X on the left: xr-standard button 4. */
  next: boolean;
  /** B on the right controller, Y on the left: xr-standard button 5. */
  prev: boolean;
}

/** Which way a controller asks to move this frame. The loop runs at display rate, so a button is
 *  held for many frames: only the press counts, or one tap would skip half the playlist. */
export function pressedDelta(before: FaceButtons, now: FaceButtons): 1 | -1 | null {
  if (now.next && !before.next) return 1;
  if (now.prev && !before.prev) return -1;
  return null;
}

/** The settings a clip opens with. Lock mode and follow settings belong to the session and carry
 *  across clips; edges belong to the clip, because the right matte cut depends on its flavor. */
export function clipSettings(
  base: ArSettings,
  shared: Partial<ArSettings>,
  clip: Partial<ArSettings>,
): ArSettings {
  return {
    ...base,
    ...shared,
    edgeMin: clip.edgeMin ?? base.edgeMin,
    edgeMax: clip.edgeMax ?? base.edgeMax,
  };
}

/** Everything a playlist carries between clips: the settings minus the per-clip edges. */
export function sharedSettings(settings: ArSettings): Partial<ArSettings> {
  const shared: Partial<ArSettings> = { ...settings };
  delete shared.edgeMin;
  delete shared.edgeMax;
  return shared;
}

export function shuffleUrl(q: string, tags: string | null, favoritesOnly: boolean): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (tags) params.set("tags", tags);
  if (favoritesOnly) params.set("fav", "1");
  const query = params.toString();
  return `/holo/shuffle${query ? `?${query}` : ""}`;
}
