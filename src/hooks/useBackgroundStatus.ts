import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The progress of a server-side background run on one dataset — captioning, or rendering a
 * regularization pool (wanly-console#537).
 *
 * WHY ASK ON MOUNT. Both runs outlive the page: captioning 40 images is minutes, a 150-clip
 * pool is GPU-hours. A card that only knew about the run it started itself would show a
 * finished-looking set while the server was still writing into it, and invite a second
 * start. One read on mount answers "is something already running here".
 *
 * WHY STOP POLLING. A card per dataset, each polling forever, is a request per card every
 * tick against an API that is mostly idle. It polls only while the last answer said
 * `running`, and `kick()` restarts it after a POST starts a run.
 *
 * `onFinished` fires on the running -> not-running edge, so the page can re-read the set and
 * show what the run wrote.
 */

//: Same cadence as the caption store (stores/captionStore): each caption is seconds, each render minutes, so a
//: faster poll buys nothing.
const POLL_MS = 3000;

export function useBackgroundStatus<T extends { running: boolean }>(
  load: () => Promise<T>,
  onFinished: () => void,
  /** False asks nothing at all — for a card the run cannot apply to. */
  enabled = true,
): { status: T | null; kick: () => void } {
  const [status, setStatus] = useState<T | null>(null);
  // Bumped by kick(): each value is one polling session.
  const [session, setSession] = useState(0);
  // The callers pass inline closures; holding the latest in refs keeps the effect from
  // restarting (and re-reading) on every render.
  const loadRef = useRef(load);
  const finishedRef = useRef(onFinished);
  useEffect(() => {
    loadRef.current = load;
    finishedRef.current = onFinished;
  });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // After a kick a run was just started, so a first answer of "not running" means it is
    // already done (a set with nothing to caption) — that is a finish too.
    let wasRunning = session > 0;
    const stop = () => clearInterval(timer);
    const tick = async () => {
      try {
        const s = await loadRef.current();
        if (!live) return;
        setStatus(s);
        if (wasRunning && !s.running) finishedRef.current();
        wasRunning = s.running;
        if (!s.running) stop();
      } catch {
        // An older API without the route, or a blip: say nothing and stop, rather than
        // hammering a 404 every three seconds per card.
        stop();
      }
    };
    // The interval exists before the first tick runs, so a tick that stops it always has
    // one to stop.
    const timer = setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      live = false;
      stop();
    };
  }, [session, enabled]);

  const kick = useCallback(() => setSession((n) => n + 1), []);

  return { status, kick };
}
