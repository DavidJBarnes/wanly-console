// Character face loops (console#742): status wording, polling and file paths, kept pure so they
// test without a browser.
import type { FaceLoop } from "../api/types";

export type LoopFile = "loop.mp4" | "poster.jpg" | "face.json" | "face.bin" | "hair.mp4" | "hair.bin";

/** s3:// path of one of a ready loop's files, or null if it is not prepared yet. */
export function loopFile(loop: Pick<FaceLoop, "asset_prefix">, file: LoopFile): string | null {
  return loop.asset_prefix ? `${loop.asset_prefix.replace(/\/+$/, "")}/${file}` : null;
}

/**
 * Cache-busting version for a loop's file URLs. The files are served "immutable" for a day, and
 * re-preparing a loop rewrites them at the SAME paths — so without this the headset kept the old
 * face.json/hair.mp4 and Full head silently fell back to Face + hair (console#755). updated_at
 * moves on every preparation.
 */
export function loopVersion(loop: Pick<FaceLoop, "updated_at">): string | undefined {
  return loop.updated_at ?? undefined;
}

/** What the card says, in plain words. */
export function loopStatusLabel(loop: Pick<FaceLoop, "status" | "render_status">): string {
  switch (loop.status) {
    case "ready":
      return "Ready";
    case "processing":
      return "Preparing the loop…";
    case "failed":
      return "Failed";
    case "rendering":
      if (loop.render_status === "failed") return "Render failed";
      if (loop.render_status === "pending") return "Queued for rendering";
      return "Rendering…";
    default:
      return loop.status;
  }
}

/** Keep refreshing while anything is still on its way. */
export function needsPolling(loops: readonly Pick<FaceLoop, "status" | "render_status">[]): boolean {
  return loops.some((l) => l.status === "processing" || (l.status === "rendering" && l.render_status !== "failed"));
}

/** Above this, so much hair runs off the top that Full head has to stretch the edge (console#757). */
export const CROWN_CLIP_PCT = 15;

/** "3.2 mm movement · face 650 px" — the numbers that predicted how still a loop sits — plus
 * "crown cut off" when the source shot has no room above the hair. */
export function loopStatsLabel(loop: Pick<FaceLoop, "stats">): string {
  const s = loop.stats;
  if (!s) return "";
  return [
    s.expression_travel_mm != null ? `${s.expression_travel_mm} mm movement` : null,
    s.face_px != null ? `face ${s.face_px} px` : null,
    (s.crown_clip_pct ?? 0) > CROWN_CLIP_PCT ? "crown cut off" : null,
  ].filter(Boolean).join(" · ");
}

/** "Kelly-2026 — Calm smile + blinks", the AR picker's entry. */
export function loopPickerLabel(loop: Pick<FaceLoop, "character" | "label">): string {
  return `${loop.character ?? "?"} — ${loop.label}`;
}

/** Why a photo is or is not a good start photo, in a few words. */
export function photoHint(p: { suitable: boolean; face_px: number; mouth_closed: boolean; eyes_open: boolean; yaw: number; pitch: number }): string {
  const issues = [
    !p.mouth_closed ? "mouth open" : null,
    !p.eyes_open ? "eyes closed" : null,
    Math.abs(p.yaw) >= 12 ? "head turned" : null,
    Math.abs(p.pitch) >= 18 ? "head tilted" : null,
  ].filter(Boolean);
  return `face ${p.face_px} px${issues.length ? ` · ${issues.join(", ")}` : ""}`;
}
