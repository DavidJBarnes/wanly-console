import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Stack,
} from "@mui/material";
import { Movie } from "@mui/icons-material";
import RecipeForm from "./RecipeForm";
import type { SegmentResponse } from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";

/**
 * New Job, as an LTX recipe render.
 *
 * The same <RecipeForm /> Next Segment uses, in its compact variant —
 * one component, two places. The old CreateJobDialog is built around WAN 2.2:
 * high/low LoRA weights, video presets carrying lightx2v and cfg, a motion-speed
 * knob. None of that exists in LTX, and rebuilding an LTX version of that form
 * would mean inventing choices that do not exist. Across the validated recipes
 * only the character LoRA and the prompt ever varied.
 *
 * The old dialog stays for now: JobDetail's clone and ImageRepo's
 * create-from-image both still use it, and they are WAN-shaped flows that retire
 * with WAN rather than being ported.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** An image already in S3 — "Use as Starting Image" from the Image Repo. */
  initialStartingImageUri?: string | null;
  /** Clone: the segment whose settings this new job starts from (console#374).
   *
   *  Carries the character, pose, prompt and character-LoRA strengths that segment ran with.
   *  The base model, content LoRAs and compression are NOT here — they live on the pose, so
   *  picking the same pose brings them along. */
  initialFrom?: SegmentResponse | null;
  /** Tags from the source image, carried onto the job. */
  initialTags?: string | null;
}

export default function CreateLtxJobDialog({
  open, onClose, onCreated, initialStartingImageUri, initialTags, initialFrom,
}: Props) {
  const isMobile = useIsMobile();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={isMobile}>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <Movie fontSize="small" />
          <span>New render</span>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Pick a character, a pose and a start frame. Everything else comes from the recipe.
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <RecipeForm
          variant="dialog"
          initialFrom={initialFrom}
          initialStartingImageUri={initialStartingImageUri}
          initialTags={initialTags}
          onCreated={() => {
            onCreated();
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
