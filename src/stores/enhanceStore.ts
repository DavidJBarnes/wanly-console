/**
 * The prompt enhancer's queue, from one poll of GET /images/enhance-prompt/queue (console#719).
 * The queue itself is the API's, so it survives navigation, refresh and a closed browser.
 */
import { useEffect } from "react";
import { create } from "zustand";

import { getEnhanceQueue } from "../api/client";
import type { EnhanceQueueStatus } from "../api/types";
import { newlyEnhanced } from "../lib/enhanceQueue";

const POLL_MS = 3000;

interface EnhanceStore {
  queue: EnhanceQueueStatus | null;
  /** The latest images seen to finish, and a counter so a view can react to each batch. */
  lastDone: string[];
  doneSeq: number;
  apply: (q: EnhanceQueueStatus) => void;
}

export const useEnhanceStore = create<EnhanceStore>((set, get) => ({
  queue: null,
  lastDone: [],
  doneSeq: 0,
  apply: (q) => {
    const done = newlyEnhanced(get().queue, q);
    set({
      queue: q,
      ...(done.length ? { lastDone: done, doneSeq: get().doneSeq + 1 } : {}),
    });
  },
}));

let watchers = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

async function tick() {
  timer = undefined;
  try {
    useEnhanceStore.getState().apply(await getEnhanceQueue());
  } catch {
    // An unreachable API is loud elsewhere on the page; the chip keeps its last state.
  }
  if (watchers > 0 && timer === undefined) timer = setTimeout(tick, POLL_MS);
}

/** Keep the poll running while the calling component is mounted. */
export function useEnhanceQueue(): EnhanceQueueStatus | null {
  useEffect(() => {
    watchers += 1;
    if (watchers === 1 && timer === undefined) void tick();
    return () => {
      watchers -= 1;
    };
  }, []);
  return useEnhanceStore((s) => s.queue);
}
