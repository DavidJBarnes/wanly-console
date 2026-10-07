/**
 * The caption hold, console side (console#562).
 *
 * A job never renders until the captions its prompt needs are saved for its start image; the
 * API holds the segment (`awaiting_caption`) until they are, then fills them in verbatim. So
 * the New Job dialog does not have to wait for a caption before it submits, and must not
 * start a SECOND caption of an image that is already being captioned -- by the image modal,
 * by another job's hold -- because the second would overwrite the first with different words.
 */
import type { ImageScene } from "../api/types";

/** Held on its caption: waiting, or failed and waiting on a person. Never claimed. */
export const isCaptionHeld = (status: string): boolean =>
  status === "awaiting_caption" || status === "caption_failed";

/**
 * Is a caption of this image queued or running right now, from anywhere?
 *
 * GET /images/scene reports the image's place in the API's one caption queue. Anything
 * non-null means somebody already asked, so the dialog joins that caption -- it waits for
 * the words to be saved -- instead of asking again.
 */
export function captionInFlight(scene: Pick<ImageScene, "queue_status">): boolean {
  return scene.queue_status != null;
}

/** "Captioning…" / "In caption queue (#3)": where a caption the dialog is joining has got
 *  to. The same words as every other caption badge (lib/captionStatus, console#564). */
export function joinNote(
  scene: Pick<ImageScene, "queue_status" | "queue_position">,
): string {
  if (scene.queue_status === "running") return "Captioning…";
  const n = scene.queue_position ?? 0;
  return n > 0 ? `In caption queue (#${n})` : "In caption queue";
}

/** "needs the scene and motion" -- what a held job is waiting for (console#587). */
export function needsNote(needs: readonly string[] | null | undefined): string | null {
  if (!needs || needs.length === 0) return null;
  return `needs the ${needs.join(" and ")}`;
}

/**
 * One line for a caption-held job or segment: where its image's caption is, and what it is
 * waiting for. "In caption queue (#3) · needs the scene and motion".
 */
export function holdPlace(d: {
  queue_status?: string | null; queue_position?: number | null;
  needs?: readonly string[] | null; note?: string | null;
}): string {
  let where: string;
  if (d.queue_status === "running") where = "Captioning…";
  else if (d.queue_status === "queued") {
    where = d.queue_position ? `In caption queue (#${d.queue_position})` : "In caption queue";
  } else if (d.queue_status === "waiting") {
    where = d.note ? `Waiting: ${d.note}` : "Waiting for the captioner";
  } else where = "Waiting for caption…";
  const needs = needsNote(d.needs);
  return needs ? `${where} · ${needs}` : where;
}

/**
 * The JobQueue's summary line (console#587), or null when nothing is held.
 * "3 jobs waiting for captions (2 images) · caption queue 12 deep · 1 caption failed"
 */
export function holdSummary(s: {
  jobs_waiting: number; jobs_failed: number; queue_depth: number;
  images: readonly unknown[];
} | null | undefined): string | null {
  if (!s || (s.jobs_waiting === 0 && s.jobs_failed === 0)) return null;
  const parts: string[] = [];
  if (s.jobs_waiting > 0) {
    const images = s.images.length;
    parts.push(`${s.jobs_waiting} job${s.jobs_waiting === 1 ? "" : "s"} waiting for captions`
      + (images > 0 ? ` (${images} image${images === 1 ? "" : "s"})` : ""));
  }
  parts.push(s.queue_depth > 0 ? `caption queue ${s.queue_depth} deep` : "caption queue empty");
  if (s.jobs_failed > 0) {
    parts.push(`${s.jobs_failed} job${s.jobs_failed === 1 ? "" : "s"} with a failed caption`);
  }
  return parts.join(" · ");
}

/**
 * "No GPU in motion mode" when a hold's note says no box is in the mode its caption needs
 * (wanly-api#392), else null. The chip on the job row says this instead of "Waiting for
 * caption…", because it is the one wait a person has to end by switching a box.
 */
export function modeWaitLabel(note: string | null | undefined): string | null {
  const m = /no GPU in (\w+) mode/i.exec(note ?? "");
  return m ? `No GPU in ${m[1].toLowerCase()} mode` : null;
}
