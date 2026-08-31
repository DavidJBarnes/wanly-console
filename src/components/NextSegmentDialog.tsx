import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Stack,
} from "@mui/material";
import { PlayArrow } from "@mui/icons-material";
import RecipeForm from "./RecipeForm";
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
