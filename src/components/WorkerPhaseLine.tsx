import { Box, LinearProgress, Typography } from "@mui/material";
import type { WorkerResponse } from "../api/types";
import { lastPhaseNote, phaseStatus } from "../lib/workerPhase";

/**
 * The worker's own sentence for what it is doing (wanly-gpu-daemon#189) -- "Downloading
 * Payton_v2_final (358 / 650 MB, 0.4 MB/s, ETA 12m 10s), 1 file left" -- with a bar when it
 * carries byte progress. Renders nothing for a ready worker or one that reports no phase.
 */
export default function WorkerPhaseLine({ worker }: { worker: WorkerResponse }) {
  const st = phaseStatus(worker);
  if (st) {
    return (
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="body2" sx={{ color: st.color, wordBreak: "break-word" }}>
          {st.detail}
        </Typography>
        {st.pct !== null && (
          <LinearProgress variant="determinate" value={st.pct} sx={{ mt: 0.5, height: 4, borderRadius: 2 }} />
        )}
      </Box>
    );
  }
  const note = lastPhaseNote(worker);
  if (note) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
        {note}
      </Typography>
    );
  }
  return null;
}
