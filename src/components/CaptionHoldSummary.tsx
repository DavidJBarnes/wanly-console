import { useEffect, useState } from "react";
import { Alert } from "@mui/material";

import { getCaptionHolds } from "../api/client";
import type { CaptionHoldSummary as Summary } from "../api/types";
import { POLL_INTERVAL_SLOW } from "../constants";
import { holdSummary } from "../lib/captionHold";

/**
 * "5 jobs waiting for captions (3 images) · caption queue 28 deep" (console#587).
 *
 * A queue full of "Waiting for caption…" chips said nothing about whether anything was
 * moving. This says how many jobs are held, how deep the caption queue is, and -- when the
 * captioner is refusing (the 3090 in render mode with every job held on a caption) -- why.
 * Silent when nothing is held.
 */
export default function CaptionHoldSummary() {
  const [s, setS] = useState<Summary | null>(null);

  useEffect(() => {
    let live = true;
    const check = () =>
      getCaptionHolds()
        .then((next) => { if (live) setS(next); })
        // An older API has no such endpoint; say nothing rather than an error.
        .catch(() => { if (live) setS(null); });
    check();
    const t = setInterval(check, POLL_INTERVAL_SLOW);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const line = holdSummary(s);
  if (!s || !line) return null;
  const refused = s.images.find((i) => i.queue_status === "waiting" && i.note);
  const running = s.running ? s.running.split("/").pop() : null;
  return (
    <Alert severity={s.jobs_failed > 0 ? "warning" : "info"} sx={{ mb: 2 }}>
      {line}
      {running ? ` · captioning ${running}` : ""}
      {refused && (
        <span style={{ display: "block", fontSize: 12, opacity: 0.85 }}>
          {refused.note}
        </span>
      )}
    </Alert>
  );
}
