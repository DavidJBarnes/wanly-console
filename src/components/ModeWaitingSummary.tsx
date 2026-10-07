import { useEffect, useState } from "react";
import { Alert, Box, Link, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router";

import { getWorkerModes } from "../api/client";
import type { WorkerModesSummary } from "../api/types";
import { describeScene, summaryParts } from "../lib/workerModes";

/**
 * What is waiting on which mode, in one line at the top of the Workers page (console#589).
 *
 * "render: 4 segments · motion: 12 captions · edit: 2 edits · train: 1 run". With two boxes and
 * four modes, "why isn't my motion caption moving?" otherwise means opening jobs one by one.
 * A mode nobody is in says so beside its count -- "no GPU in motion mode; switch one to motion
 * on the Workers page" -- and that line is a warning, because it is the one thing on the page
 * that only a person can fix. Scene captions run on their own service, never a mode, and are
 * labelled separately.
 */
export default function ModeWaitingSummary({ pollMs = 10000 }: { pollMs?: number }) {
  const [summary, setSummary] = useState<WorkerModesSummary | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => getWorkerModes()
      .then((s) => { if (alive) setSummary(s); })
      .catch(() => { /* an older API, or a blip: show nothing rather than an error */ });
    void load();
    const t = setInterval(load, pollMs);
    return () => { alive = false; clearInterval(t); };
  }, [pollMs]);

  if (!summary) return null;
  const parts = summaryParts(summary.waiting);
  const scene = describeScene(summary.scene);
  const stuck = parts.filter((p) => p.reason);
  if (parts.length === 0 && !scene) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Nothing waiting on any mode.
      </Typography>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="body2" color="text.secondary" component="div"
                  sx={{ display: "flex", flexWrap: "wrap", columnGap: 1 }}>
        {parts.map((p, i) => (
          <span key={p.mode}>
            {i > 0 && "· "}
            <Link component={RouterLink} to={p.to} underline="hover"
                  color={p.reason ? "warning.main" : "inherit"}>
              {p.text}
            </Link>
          </span>
        ))}
        {scene && <span>{parts.length > 0 && "· "}{scene}</span>}
      </Typography>
      {stuck.map((p) => (
        <Alert key={p.mode} severity="warning" sx={{ mt: 1, py: 0 }}>
          {p.text}: {p.reason}
        </Alert>
      ))}
    </Box>
  );
}
