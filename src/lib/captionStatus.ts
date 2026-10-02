/**
 * Where an image's caption has got to, for ANY view that shows the image (console#564).
 *
 * Describe used to be a request held open for its whole turn in the API's caption queue, and
 * the only record that it was happening was the page that sent it. Navigate away and back and
 * the image looked idle while its caption was still in line. Now describe hands back a TICKET
 * at once, and the API's one queue endpoint (GET /images/caption-queue) lists every place in
 * line plus every recently finished ticket -- so one poll is enough to mark every image on
 * every page, and it survives navigation and refresh because it lives on the server.
 *
 * Pure functions here; the poller and the React hooks are in stores/captionStore.ts.
 */
import type { CaptionQueueStatus, CaptionTicket } from "../api/types";

export type CaptionState = "queued" | "running" | "done" | "failed";

export interface ImageCaptionStatus {
  state: CaptionState;
  /** 1 = next up while queued; 0 while running; null when finished. */
  position: number | null;
  depth: number;
  error: string | null;
  /** Failed because the box beside the captioner is rendering. */
  busy: boolean;
  /** Done, but the motion half failed. */
  motionError: string | null;
  ticketId: string | null;
  finishedAt: string | null;
}

/** Queue kinds whose caption lands on the image's record. A dataset caption (training text)
 *  and a Settings try (stores nothing) are in the same line but are not "this image's
 *  caption", so an image is not marked for them. */
export const WRITES_WORDS: ReadonlySet<string> = new Set(["describe", "hold"]);

/** A ticket as the image's status. Null for a ticket with nothing to say. */
export function fromTicket(t: CaptionTicket): ImageCaptionStatus | null {
  if (!t.status) return null;
  return {
    state: t.status,
    position: t.position,
    depth: t.depth,
    error: t.error,
    busy: t.busy,
    motionError: t.motion_error,
    ticketId: t.ticket_id,
    finishedAt: t.finished_at,
  };
}

/**
 * Every image's caption status from one read of the queue.
 *
 * In line wins over finished: an image re-described after a failure shows the new place in
 * line, not the old failure. `pending` are tickets this page was handed but that the last
 * read predates -- without them a click would show nothing until the next poll.
 */
export function statusesFromQueue(
  q: CaptionQueueStatus | null,
  pending: Iterable<CaptionTicket> = [],
): Map<string, ImageCaptionStatus> {
  const out = new Map<string, ImageCaptionStatus>();
  const depth = q?.depth ?? 0;
  for (const e of q?.entries ?? []) {
    if (!WRITES_WORDS.has(e.kind) || out.has(e.path)) continue;
    out.set(e.path, {
      state: e.status, position: e.position, depth, error: null, busy: false,
      motionError: null, ticketId: e.ticket_id, finishedAt: null,
    });
  }
  for (const t of q?.recent ?? []) {
    if (out.has(t.path)) continue;
    const s = fromTicket(t);
    if (s) out.set(t.path, s);
  }
  for (const t of pending) {
    const current = out.get(t.path);
    if (current && (current.state === "queued" || current.state === "running")) continue;
    const s = fromTicket(t);
    if (s) out.set(t.path, s);
  }
  return out;
}

/** Same status, field for field -- so an unchanged image keeps its object and its views do
 *  not re-render on every poll. */
export function sameStatus(a: ImageCaptionStatus | undefined, b: ImageCaptionStatus): boolean {
  return !!a && a.state === b.state && a.position === b.position && a.depth === b.depth
    && a.error === b.error && a.busy === b.busy && a.motionError === b.motionError
    && a.ticketId === b.ticketId && a.finishedAt === b.finishedAt;
}

/**
 * The images whose caption FINISHED between two reads -- the moment a view should fetch the
 * saved words and fill them in. A finish nobody saw start (the first read after a page load)
 * is not one: the page loaded the words already.
 */
export function newlyDone(
  prev: Map<string, ImageCaptionStatus>,
  next: Map<string, ImageCaptionStatus>,
): string[] {
  const out: string[] = [];
  for (const [path, s] of next) {
    if (s.state !== "done") continue;
    const before = prev.get(path);
    if (!before) continue;
    if (before.state !== "done" || before.finishedAt !== s.finishedAt) out.push(path);
  }
  return out;
}

/** The words on the badge: "In caption queue (#3)", "Captioning…", "Failed: retry". */
export function captionLabel(s: ImageCaptionStatus | null | undefined): string | null {
  if (!s) return null;
  switch (s.state) {
    case "queued":
      return s.position ? `In caption queue (#${s.position})` : "In caption queue";
    case "running":
      return "Captioning…";
    case "failed":
      return "Failed: retry";
    default:
      return null;
  }
}

/** Is a caption of this image on its way? */
export const captionPending = (s: ImageCaptionStatus | null | undefined): boolean =>
  s?.state === "queued" || s?.state === "running";
