import { useEffect, useState } from "react";
import { Alert, AlertTitle } from "@mui/material";
import { getQueueHealth, type QueueHealth } from "../api/client";
import { POLL_INTERVAL_SLOW } from "../constants";

/**
 * Says so when there is work and nobody to do it.
 *
 * The 3090's host rebooted and its container had restart=no, so the worker never came back. It
 * was found thirteen hours later by hand, with four segments queued the whole time. The database
 * knew: a stale heartbeat, a worker marked offline, segments pending. Nothing combined them, and
 * an offline worker looked the same whether the queue was empty or not.
 *
 * Deliberately silent unless BOTH halves hold. A banner that appears whenever a queue has depth,
 * or whenever a worker is off, would be present most of the time and stop being read.
 */
export default function StalledQueueBanner() {
  const [health, setHealth] = useState<QueueHealth | null>(null);

  useEffect(() => {
    const check = () => getQueueHealth().then(setHealth).catch(() => setHealth(null));
    check();
    const t = setInterval(check, POLL_INTERVAL_SLOW);
    return () => clearInterval(t);
  }, []);

  if (!health?.stalled) return null;

  return (
    <Alert severity="error" sx={{ mb: 2 }}>
      <AlertTitle>Nothing is running</AlertTitle>
      {health.summary}
      {health.last_worker_seen &&
        ` — last worker seen ${timeAgo(health.last_worker_seen)}.`}
      {" Start a worker, or launch a RunPod pod, or this queue will sit."}
    </Alert>
  );
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
