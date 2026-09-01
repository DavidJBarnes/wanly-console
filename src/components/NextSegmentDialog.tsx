import { useEffect, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Stack,
} from "@mui/material";
import { PlayArrow } from "@mui/icons-material";
import RecipeForm from "./RecipeForm";
import { getJob } from "../api/client";
import { pickPreviousSegment } from "../lib/previousSegment";
import type { SegmentResponse } from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";

/**
 * Add a continuation segment to a job.
 *
 * The same <RecipeForm /> as everywhere else, in continuation mode — because under LTX a
 * continuation IS a recipe render: a character, a pose, and a start frame that happens to be
 * the previous segment's last frame.
 *
 * The old version of this was 822 lines of LoRA pickers, video-preset pickers and WAN sampler
 * fields. None of that exists in LTX, and rebuilding it would have meant re-creating the form
 * that was just deleted.
 *
 * Nothing new was needed on the API side: POST /jobs/{id}/segments already appends, the claim
 * endpoint already resolves a null start image from the previous segment's last_frame_path,
 * every LTX render already uploads its last frame, and stitch_video already assembles them.
 * Only the form had gone.
 */
interface Props {
  open: boolean;
  jobId: string;
  onClose: () => void;
  onAdded: () => void;
}

export default function NextSegmentDialog({ open, jobId, onClose, onAdded }: Props) {
  const isMobile = useIsMobile();

  // The segment this one continues from, so the form opens on the chain's existing choices
  // rather than on defaults. Fetched per open rather than held, because a segment can have
  // been added or re-rolled since the job was last loaded.
  //
  // Discarded takes are skipped: a re-rolled segment leaves its old take behind, and
  // continuing from the take that was thrown away is exactly wrong.
  const [previous, setPrevious] = useState<SegmentResponse | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    getJob(jobId)
      .then((job) => {
        if (!live) return;
        setPrevious(pickPreviousSegment(job.segments));
      })
      // A failure here costs the prefill, not the dialog: the form still opens on defaults,
      // which is exactly what it did before this existed.
      .catch(() => setPrevious(null));
    return () => {
      live = false;
    };
  }, [open, jobId]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={isMobile}>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <PlayArrow fontSize="small" />
          <span>Next segment</span>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Continues from the last frame of the previous segment. Pick the pose it moves into.
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <RecipeForm
          variant="dialog"
          continueJobId={jobId}
          initialFrom={previous}
          onCreated={() => {
            onAdded();
            onClose();
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
