/**
 * Where an image's caption has got to, for ANY view that shows the image (console#564),
 * HALF BY HALF (console#590).
 *
 * Describe used to be a request held open for its whole turn in the API's caption queue, and
 * the only record that it was happening was the page that sent it. Navigate away and back and
 * the image looked idle while its caption was still in line. Now describe hands back a TICKET
 * at once, and the API's one queue endpoint (GET /images/caption-queue) lists every place in
 * line plus every recently finished ticket -- so one poll is enough to mark every image on
 * every page, and it survives navigation and refresh because it lives on the server.
 *
 * Since console#590 an image's caption is two halves with tickets of their own: the SCENE
 * (JoyCaption, seconds; what tagging makes) and the MOTION paragraph (minutes, on another
 * GPU; made only on an explicit "Describe motion" or a held job's need). Each has its own
 * status, chip, buttons and retry, so everything here is keyed by (image, half).
 *
 * Pure functions here; the poller and the React hooks are in stores/captionStore.ts.
 */
import type { CaptionQueueEntry, CaptionQueueStatus, CaptionTicket } from "../api/types";

export type CaptionState = "queued" | "running" | "done" | "failed";
export type CaptionHalfName = "scene" | "motion";
export const CAPTION_HALVES: readonly CaptionHalfName[] = ["scene", "motion"];

export interface ImageCaptionStatus {
  half: CaptionHalfName;
  state: CaptionState;
  /** 1 = next up while queued; 0 while running; null when finished. */
  position: number | null;
  depth: number;
  error: string | null;
  /** Failed because the box beside the captioner is rendering. */
  busy: boolean;
  ticketId: string | null;
  finishedAt: string | null;
  /** The held jobs this caption is for ("Motion requested by job …"). */
  requestedBy: { job_id: string; name: string | null }[];
}

/** Queue kinds whose caption lands on the image's record. A dataset caption (training text)
 *  and a Settings try (stores nothing) are in the same line but are not "this image's
 *  caption", so an image is not marked for them. */
export const WRITES_WORDS: ReadonlySet<string> = new Set(["describe", "hold"]);

/** The key a half's status is stored under. */
export const captionKey = (path: string, half: CaptionHalfName): string => `${half}:${path}`;

/** Which half a ticket makes. An API older than console#590 had "pair" tickets, which
 *  started with the scene. */
export function ticketHalf(t: Pick<CaptionTicket, "half" | "mode">): CaptionHalfName {
  if (t.half === "motion" || t.half === "scene") return t.half;
  return t.mode === "motion" ? "motion" : "scene";
}

/** Which half a queue entry is for: a ticket's lane IS its half. */
export const entryHalf = (e: Pick<CaptionQueueEntry, "lane">): CaptionHalfName =>
  e.lane === "motion" ? "motion" : "scene";

/** A ticket as the image's status for that half. Null for a ticket with nothing to say. */
export function fromTicket(t: CaptionTicket): ImageCaptionStatus | null {
  if (!t.status) return null;
  return {
    half: ticketHalf(t),
    state: t.status,
    position: t.position,
    depth: t.depth,
    error: t.error,
    busy: t.busy,
    ticketId: t.ticket_id,
    finishedAt: t.finished_at,
    requestedBy: t.requested_by ?? [],
  };
}

/**
 * Every image's caption status, per half, from one read of the queue. Keyed by captionKey.
 *
 * In line wins over finished: a half re-described after a failure shows the new place in
 * line, not the old failure. `pending` are tickets this page was handed but that the last
 * read predates -- without them a click would show nothing until the next poll.
 */
export function statusesFromQueue(
  q: CaptionQueueStatus | null,
  pending: Iterable<CaptionTicket> = [],
): Map<string, ImageCaptionStatus> {
  const out = new Map<string, ImageCaptionStatus>();
  const lanes = new Map((q?.lanes ?? []).map((l) => [l.name, l.depth]));
  const pendingList = [...pending];
  const byId = new Map(pendingList.map((t) => [t.ticket_id, t]));
  for (const e of q?.entries ?? []) {
    if (!WRITES_WORDS.has(e.kind)) continue;
    const half = entryHalf(e);
    const key = captionKey(e.path, half);
    if (out.has(key)) continue;
    const known = e.ticket_id ? byId.get(e.ticket_id) : undefined;
    out.set(key, {
      half, state: e.status, position: e.position, depth: lanes.get(half) ?? q?.depth ?? 0,
      error: null, busy: false, ticketId: e.ticket_id, finishedAt: null,
      requestedBy: e.requested_by ?? known?.requested_by ?? [],
    });
  }
  for (const t of q?.recent ?? []) {
    const s = fromTicket(t);
    if (!s) continue;
    const key = captionKey(t.path, s.half);
    if (!out.has(key)) out.set(key, s);
  }
  for (const t of pendingList) {
    const s = fromTicket(t);
    if (!s) continue;
    const key = captionKey(t.path, s.half);
    const current = out.get(key);
    if (current && (current.state === "queued" || current.state === "running")) continue;
    out.set(key, s);
  }
  return out;
}

/** Same status, field for field -- so an unchanged image keeps its object and its views do
 *  not re-render on every poll. */
export function sameStatus(a: ImageCaptionStatus | undefined, b: ImageCaptionStatus): boolean {
  return !!a && a.half === b.half && a.state === b.state && a.position === b.position
    && a.depth === b.depth && a.error === b.error && a.busy === b.busy
    && a.ticketId === b.ticketId && a.finishedAt === b.finishedAt
    && a.requestedBy.length === b.requestedBy.length
    && a.requestedBy.every((r, i) => r.job_id === b.requestedBy[i].job_id);
}

/** The image a status key belongs to. */
const pathOfKey = (key: string): string => key.slice(key.indexOf(":") + 1);

/**
 * The images a caption half FINISHED for between two reads -- the moment a view should fetch
 * the saved words and fill them in. Each image once, whichever half. A finish nobody saw
 * start (the first read after a page load) is not one: the page loaded the words already.
 */
export function newlyDone(
  prev: Map<string, ImageCaptionStatus>,
  next: Map<string, ImageCaptionStatus>,
): string[] {
  const out: string[] = [];
  for (const [key, s] of next) {
    if (s.state !== "done") continue;
    const before = prev.get(key);
    if (!before) continue;
    if (before.state !== "done" || before.finishedAt !== s.finishedAt) {
      const path = pathOfKey(key);
      if (!out.includes(path)) out.push(path);
    }
  }
  return out;
}

const HALF_LABEL: Record<CaptionHalfName, string> = { scene: "Scene", motion: "Motion" };

/** "Scene: In queue (#3)", "Motion: Captioning…", "Scene: Failed: retry". */
export function captionLabel(s: ImageCaptionStatus | null | undefined): string | null {
  if (!s) return null;
  const half = HALF_LABEL[s.half];
  switch (s.state) {
    case "queued":
      return s.position ? `${half}: In queue (#${s.position})` : `${half}: In queue`;
    case "running":
      return `${half}: Captioning…`;
    case "failed":
      return `${half}: Failed: retry`;
    default:
      return null;
  }
}

/** The pill's tooltip: where it is, that leaving the page loses nothing, and who asked. The
 *  pill is the ONE indicator of a caption in progress (console#590), so the reassurance that
 *  used to be a line of its own lives here. */
export function captionTooltip(s: ImageCaptionStatus): string {
  const lane = s.half === "motion" ? "motion caption queue" : "scene caption queue";
  let where = "";
  if (s.state === "running") where = `This image's ${s.half} is being captioned now.`;
  else if (s.state === "queued") where = `Waiting its turn -- ${s.depth} in the ${lane}.`;
  else if (s.state === "failed") {
    where = `The ${s.half} caption failed: ${s.error ?? "no reason given"}. Click to retry.`;
  }
  const carries = captionPending(s) ? " It carries on if you close this or leave the page." : "";
  return [where + carries, requestedByNote(s)].filter(Boolean).join(" ");
}

/** "Motion requested by job Beach walk" (console#590): a caption nobody clicked for says who
 *  asked. Null when a person asked. */
export function requestedByNote(
  s: Pick<ImageCaptionStatus, "half" | "requestedBy"> | null | undefined,
): string | null {
  if (!s || s.requestedBy.length === 0) return null;
  const names = s.requestedBy.map((r) => r.name || r.job_id.slice(0, 8));
  const jobs = names.length === 1
    ? `job ${names[0]}`
    : `jobs ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${HALF_LABEL[s.half]} requested by ${jobs}`;
}

/** Is a caption of this half on its way? */
export const captionPending = (s: ImageCaptionStatus | null | undefined): boolean =>
  s?.state === "queued" || s?.state === "running";

/**
 * Should the image say "Redo motion to re-ground on the new scene"? (console#590)
 *
 * Motion is grounded on the saved scene, and redoing the scene leaves the saved paragraph
 * alone -- so a motion paragraph OLDER than its scene was written about a different scene.
 * Both halves of a pair-era describe carry the same time, so those never trigger it.
 */
export function motionNeedsRegrounding(img: {
  scene_description?: string | null; scene_described_at?: string | null;
  motion_description?: string | null; motion_described_at?: string | null;
}): boolean {
  if (!(img.scene_description ?? "").trim() || !(img.motion_description ?? "").trim()) {
    return false;
  }
  if (!img.scene_described_at || !img.motion_described_at) return false;
  return Date.parse(img.scene_described_at) > Date.parse(img.motion_described_at);
}

export const REGROUND_HINT = "Redo motion to re-ground on the new scene";

/** One half's button: what it says, and whether it can be pressed. */
export interface HalfAction {
  half: CaptionHalfName;
  label: string;
  disabled: boolean;
  /** Why it is disabled, for the tooltip. */
  why: string | null;
}

/**
 * The per-half buttons: "Describe" / "Redo scene", "Describe motion" / "Redo motion".
 *
 * While a half is in flight its button is DISABLED, not relabelled -- the status pill is the
 * one indicator of a caption in progress (console#590). Motion is grounded on the saved
 * scene, so "Describe motion" waits for a scene to exist (or to be on its way).
 */
export function halfActions(args: {
  scene: string | null | undefined;
  motion: string | null | undefined;
  sceneStatus?: ImageCaptionStatus | null;
  motionStatus?: ImageCaptionStatus | null;
}): HalfAction[] {
  const hasScene = !!(args.scene ?? "").trim();
  const hasMotion = !!(args.motion ?? "").trim();
  const scenePending = captionPending(args.sceneStatus);
  const motionPending = captionPending(args.motionStatus);
  const noScene = !hasScene && !scenePending;
  return [
    {
      half: "scene",
      label: hasScene ? "Redo scene" : "Describe",
      disabled: scenePending,
      why: scenePending ? "The scene is already being captioned" : null,
    },
    {
      half: "motion",
      label: hasMotion ? "Redo motion" : "Describe motion",
      disabled: motionPending || noScene,
      why: motionPending
        ? "The motion is already being captioned"
        : noScene ? "Describe the scene first -- the motion is grounded on it" : null,
    },
  ];
}

/**
 * Which halves of an image are in flight, from GET /images/scene (console#590). An API older
 * than the split reports one queue place for the whole caption: both halves, then.
 */
export function halvesInFlight(scene: {
  queue_status?: string | null;
  scene_caption?: Pick<CaptionTicket, "status"> | null;
  motion_caption?: Pick<CaptionTicket, "status"> | null;
}): Record<CaptionHalfName, boolean> {
  const live = (t?: Pick<CaptionTicket, "status"> | null) =>
    t?.status === "queued" || t?.status === "running";
  if (scene.scene_caption === undefined && scene.motion_caption === undefined) {
    const any = scene.queue_status != null;
    return { scene: any, motion: any };
  }
  return { scene: live(scene.scene_caption), motion: live(scene.motion_caption) };
}
