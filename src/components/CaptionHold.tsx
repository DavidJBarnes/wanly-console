import { Alert, Box, Button, Chip, CircularProgress, Tooltip } from "@mui/material";
import type { JobResponse, SegmentResponse } from "../api/types";

/**
 * A segment held until its start image's captions exist (console#562).
 *
 * The API creates a segment `awaiting_caption` when its prompt has a <SCENE>/<MOTION> with no
 * saved words yet, and never hands it to a worker until they are saved -- then it renders with
 * exactly those words. Submitting no longer waits for a caption, so this is where the wait
 * shows up instead: on the job and the segment, with what it is waiting on.
 *
 * `caption_failed` is the loud half. The caption failed or timed out and the API will not
 * drop the missing half on its own, so the person picks: Retry caption, or Render without
 * (whatever IS saved is still used; only the missing half goes).
 */
interface PanelProps {
  seg: SegmentResponse;
  busy: boolean;
  onRetry: () => void;
  onRenderWithout: () => void;
}

export function CaptionHoldPanel({ seg, busy, onRetry, onRenderWithout }: PanelProps) {
  if (seg.status === "awaiting_caption") {
    return (
      <Alert severity="info" icon={<CircularProgress size={16} />} sx={{ mb: 1 }}>
        Waiting for caption… it renders once the start image's words are saved.
        {seg.caption_wait && (
          <Box component="span" sx={{ display: "block", fontSize: 12, opacity: 0.85 }}>
            {seg.caption_wait}
          </Box>
        )}
      </Alert>
    );
  }
  if (seg.status === "caption_failed") {
    return (
      <Alert severity="error" sx={{ mb: 1 }}>
        {seg.error_message ?? "The caption for this segment's start image failed."}
        <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
          <Button size="small" variant="contained" onClick={onRetry} disabled={busy}>
            Retry caption
          </Button>
          <Tooltip title="Render now. Any caption half that is saved is still used; only the missing one is left out.">
            <span>
              <Button size="small" variant="outlined" color="inherit"
                      onClick={onRenderWithout} disabled={busy}>
                Render without
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Alert>
    );
  }
  return null;
}

/** The job-level flag: its status stays "pending" (it is queued), so this says why it waits. */
export function CaptionHoldChip({ hold }: { hold: JobResponse["caption_hold"] }) {
  if (hold === "awaiting_caption") {
    return (
      <Tooltip title="Held until its start image's scene and motion captions are saved">
        <Chip size="small" color="info" variant="outlined" label="Waiting for caption…" />
      </Tooltip>
    );
  }
  if (hold === "caption_failed") {
    return (
      <Tooltip title="The caption failed. Open the job to retry it or render without it.">
        <Chip size="small" color="error" variant="outlined" label="Caption failed" />
      </Tooltip>
    );
  }
  return null;
}
