/**
 * A write that waits for a pause in typing, and is FLUSHED rather than dropped when the
 * thing being edited goes away (console#435).
 *
 * The image tag box debounced its save by 500ms and cancelled the pending timer whenever the
 * lightbox changed image — which includes closing it. Tag an image, close the modal inside
 * half a second, and the tags were never written. Nothing reported it, because from the
 * page's point of view nothing had failed; the write simply never happened. The description
 * that hangs off that write succeeding never happened either.
 *
 * THERE IS DELIBERATELY NO cancel(). Discarding a pending edit is the bug this exists to
 * prevent, so the operation is not offered. An edit that has been made either lands now or
 * lands in `delayMs`; it never evaporates.
 */
export interface DeferredWrite<T> {
  /** Replace whatever was waiting and restart the clock. */
  schedule(value: T): void;
  /** Write what is waiting, now. Does nothing if nothing is. */
  flush(): void;
  /** What is waiting, for a caller that needs to reason about it. */
  pending(): T | null;
}

export function createDeferredWrite<T>(
  delayMs: number,
  write: (value: T) => void,
): DeferredWrite<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting: T | null = null;

  const flush = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (waiting === null) return;
    // Cleared BEFORE the write, so a write that itself schedules another one — or throws —
    // cannot leave the same value queued twice.
    const value = waiting;
    waiting = null;
    write(value);
  };

  return {
    schedule(value: T) {
      waiting = value;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
    pending: () => waiting,
  };
}
