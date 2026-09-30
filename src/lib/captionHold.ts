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

/** "captioning now" / "3rd in line": where a caption the dialog is joining has got to. */
export function joinNote(
  scene: Pick<ImageScene, "queue_status" | "queue_position">,
): string {
  if (scene.queue_status === "running") return "captioning now";
  const n = scene.queue_position ?? 0;
  return n > 0 ? `${ordinal(n)} in the caption queue` : "queued for captioning";
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
