import { useEffect, useState } from "react";
import { Chip, CircularProgress, Tooltip } from "@mui/material";

import { getCaptionQueue } from "../api/client";
import type { CaptionQueueStatus } from "../api/types";

/**
 * How the captioner's queue looks, wherever you are on the page.
 *
 * WHY A GLOBAL ONE. The per-image position only exists inside the modal of an image you are
 * already describing, which is no answer to "how is the queue looking?" -- you had to open
 * an image that happened to be in it to find out.
 *
 * ollama captions one at a time, so a batch is a line: at ~25s a call and two calls an
 * image, the seventh image is five minutes out. Without a number that is indistinguishable
 * from nothing happening.
 *
 * ONE POLL, NOT ONE PER IMAGE. Depth belongs to the captioner, not to any image, so
 * GET /images/caption-queue needs no path -- no database and no captioner call behind it
 * either, because the queue lives in the API process.
 *
 * SILENT WHEN IDLE. A chip reading "0 queued" on every page all day is furniture; the
 * useful signal is that there IS a queue.
 */

//: The wait is dominated by ~25s captions, so a faster poll buys no accuracy and costs a
//: request every time.
const POLL_MS = 4000;

export default function CaptionQueueChip() {
  const [q, setQ] = useState<CaptionQueueStatus | null>(null);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const next = await getCaptionQueue();
        if (live) setQ(next);
      } catch {
        // An unreachable API is already loud elsewhere on the page; a queue chip that
        // flickers into an error adds noise to a problem you can already see.
        if (live) setQ(null);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  if (!q || q.depth === 0) return null;

  const name = q.running ? q.running.split("/").pop() : null;

  return (
    <Tooltip
      title={
        name
          ? `Captioning ${name}${q.waiting ? ` — ${q.waiting} waiting behind it` : ""}`
          : `${q.depth} in the caption queue`
      }
    >
      <Chip
        size="small"
        icon={<CircularProgress size={12} sx={{ ml: 0.75 }} />}
        // The count people act on is what is LEFT, so depth (which includes the one being
        // captioned now) rather than the waiting count alone -- "6 waiting" while a seventh
        // is mid-caption understates the wait by a whole caption.
        label={`Captioning ${q.depth}`}
        variant="outlined"
        sx={{ fontWeight: 600 }}
      />
    </Tooltip>
  );
}
