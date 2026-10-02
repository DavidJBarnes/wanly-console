/**
 * Every image's caption status, from ONE poll of GET /images/caption-queue (console#564).
 *
 * The poll runs while anything on screen is watching -- the toolbar's queue chip always is --
 * and every view (the image modal, the Image Repo grid, Datasets, the New Job dialog) reads
 * from here rather than asking per image. Because the state is the API's, it survives
 * navigation and refresh: leave the page with a caption in line and come back, and the image
 * still says "In caption queue (#4)".
 */
import { useEffect } from "react";
import { create } from "zustand";

import { getCaptionQueue } from "../api/client";
import type { CaptionQueueStatus, CaptionTicket } from "../api/types";
import {
  type ImageCaptionStatus, newlyDone, sameStatus, statusesFromQueue,
} from "../lib/captionStatus";

//: The wait is dominated by minute-long captions; faster buys no accuracy.
const POLL_MS = 3000;

interface CaptionStore {
  queue: CaptionQueueStatus | null;
  statuses: Map<string, ImageCaptionStatus>;
  /** Tickets handed to this page that the last read predates, by path. */
  pending: Map<string, CaptionTicket>;
  /** Bumped per image each time its caption is seen to finish; views refetch on change. */
  doneSeq: number;
  lastDone: string[];
  loaded: boolean;
  apply: (q: CaptionQueueStatus | null, readStartedAt: number) => void;
  noteTicket: (t: CaptionTicket) => void;
}

const notedAt = new Map<string, number>();

export const useCaptionStore = create<CaptionStore>((set, get) => ({
  queue: null,
  statuses: new Map(),
  pending: new Map(),
  doneSeq: 0,
  lastDone: [],
  loaded: false,

  apply: (q, readStartedAt) => {
    const { statuses: prev, pending, loaded, doneSeq } = get();
    // A ticket noted before this read started is in it (or finished and in `recent`).
    const stillPending = new Map(
      [...pending].filter(([path]) => (notedAt.get(path) ?? 0) > readStartedAt));
    const fresh = statusesFromQueue(q, stillPending.values());
    const next = new Map<string, ImageCaptionStatus>();
    for (const [path, s] of fresh) {
      const before = prev.get(path);
      next.set(path, before && sameStatus(before, s) ? before : s);
    }
    const done = loaded ? newlyDone(prev, next) : [];
    set({
      queue: q,
      statuses: next,
      pending: stillPending,
      loaded: true,
      ...(done.length ? { doneSeq: doneSeq + 1, lastDone: done } : {}),
    });
  },

  noteTicket: (t) => {
    if (!t.status) return;
    notedAt.set(t.path, Date.now());
    const pending = new Map(get().pending).set(t.path, t);
    const statuses = statusesFromQueue(get().queue, pending.values());
    set({ pending, statuses: mergeKeeping(get().statuses, statuses) });
  },
}));

function mergeKeeping(
  prev: Map<string, ImageCaptionStatus>, next: Map<string, ImageCaptionStatus>,
): Map<string, ImageCaptionStatus> {
  const out = new Map<string, ImageCaptionStatus>();
  for (const [path, s] of next) {
    const before = prev.get(path);
    out.set(path, before && sameStatus(before, s) ? before : s);
  }
  return out;
}

// --- the one poller, reference-counted ---------------------------------------------------------

let watchers = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let reading = false;

async function tick() {
  timer = undefined;
  if (reading) return;
  reading = true;
  const started = Date.now();
  try {
    const q = await getCaptionQueue();
    useCaptionStore.getState().apply(q, started);
  } catch {
    // An unreachable API is loud elsewhere on the page; badges keep their last state.
  } finally {
    reading = false;
  }
  if (watchers > 0 && timer === undefined) timer = setTimeout(tick, POLL_MS);
}

/** Ask for one read now (after a describe, say), without waiting for the next tick. */
export function refreshCaptionStatus(): void {
  if (reading) return;
  if (timer !== undefined) clearTimeout(timer);
  void tick();
}

function watch(): () => void {
  watchers += 1;
  if (watchers === 1 && timer === undefined && !reading) void tick();
  return () => {
    watchers -= 1;
  };
}

/** Keep the poll running while the calling component is mounted. */
export function useCaptionPoll(): void {
  useEffect(() => watch(), []);
}

/** One image's caption status, or undefined when there is nothing to say. */
export function useCaptionStatus(path: string | null | undefined): ImageCaptionStatus | undefined {
  useCaptionPoll();
  return useCaptionStore((s) => (path ? s.statuses.get(path) : undefined));
}

/** The captioner's whole queue, for the toolbar chip. */
export function useCaptionQueueSnapshot(): CaptionQueueStatus | null {
  useCaptionPoll();
  return useCaptionStore((s) => s.queue);
}

/**
 * Call `onDone(paths)` whenever captions finish -- the moment to fetch the saved words and
 * put them where the image is shown. `onDone` may change identity freely.
 */
export function useCaptionDone(onDone: (paths: string[]) => void): void {
  useCaptionPoll();
  useEffect(() => useCaptionStore.subscribe((s, prev) => {
    if (s.doneSeq !== prev.doneSeq) onDone(s.lastDone);
  }), [onDone]);
}

export const noteCaptionTicket = (t: CaptionTicket) => useCaptionStore.getState().noteTicket(t);
