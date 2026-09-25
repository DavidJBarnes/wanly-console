import { useEffect, useRef, useState } from "react";

import { getImageScene } from "../api/client";

/**
 * Where the images being described sit in the captioner's queue.
 *
 * WHY POLL AT ALL. The POST that asks for a description does not come back until that
 * image's caption is DONE, so its queue fields are always null by the time you can read
 * them — they describe a queue the image has already left. The only way to know a position
 * while it still matters is to ask separately, which is what GET /images/scene answers.
 *
 * WHY IT MATTERS. ollama runs one caption at a time, so a batch is a line: at ~25s a call
 * and two calls an image, the seventh image is five minutes out. A spinner says the same
 * thing at ten seconds and at five minutes, and a spinner that has said it for five minutes
 * is indistinguishable from a hang — which is how a batch that is working fine gets
 * abandoned. "3rd of 7" is the difference between waiting and giving up.
 *
 * ASK ABOUT WHAT IS ON SCREEN, NOT ABOUT THE BATCH. Position is per-image, but depth is a
 * property of the captioner, so a single read answers both. Passing every in-flight path
 * would put one request per image on a busy API every tick to learn one shared number --
 * the same shape that caused the problem this is reporting on.
 */
export interface QueueInfo {
  /** 0 = being captioned now, 1 = next up. Null when this path is not in the queue. */
  position: number | null;
  /** Everything unfinished, including the one in progress. */
  depth: number;
}

//: Slow on purpose. The wait is dominated by ~25s captions, so a faster poll buys no
//: accuracy and costs a request every time.
const POLL_MS = 3000;

export function useCaptionQueue(paths: string[]): Map<string, QueueInfo> {
  const [info, setInfo] = useState<Map<string, QueueInfo>>(new Map());
  // The list identity changes every render; its CONTENTS are what should restart polling.
  const key = paths.slice().sort().join("|");
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    if (!key) {
      setInfo(new Map());
      return;
    }
    const wanted = key.split("|");

    const tick = async () => {
      const next = new Map<string, QueueInfo>();
      // Sequential rather than Promise.all, for the rare case a caller does pass more than
      // one: a status read must not itself become a burst against the thing it is reporting
      // on.
      for (const path of wanted) {
        try {
          const s = await getImageScene(path);
          next.set(path, { position: s.queue_position, depth: s.queue_depth });
        } catch {
          // A failed status read is not worth surfacing: the describe itself reports its
          // own failure, and a queue chip that flickers into an error is noise.
        }
      }
      if (live.current) setInfo(next);
    };

    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      live.current = false;
      clearInterval(t);
    };
  }, [key]);

  return info;
}

/** "3rd of 7", or null when there is nothing worth saying. */
export function describeQueuePlace(info: QueueInfo | undefined): string | null {
  if (!info || info.depth <= 1) return null;      // alone in the queue says nothing useful
  if (info.position === null) return `${info.depth} in the caption queue`;
  if (info.position === 0) return `captioning now — ${info.depth - 1} waiting`;
  return `${ordinal(info.position + 1)} of ${info.depth}`;
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
