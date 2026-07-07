import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  TextField,
  CircularProgress,
} from "@mui/material";

import { createFinalCut } from "../api/client";
import type { FinalCutCreate } from "../api/types";

interface FinalCutDialogProps {
  open: boolean;
  jobId: string;
  onClose: () => void;
  onCreated: () => void;
}

// Final Cut: face-swap the character onto this job's finalized video via FaceFusion, as a linked
// child job. Runs on the normal queue. Reference face defaults to the source job's start image.
export default function FinalCutDialog({ open, jobId, onClose, onCreated }: FinalCutDialogProps) {
  const [faceIndex, setFaceIndex] = useState(0);
  const [distance, setDistance] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const body: FinalCutCreate = {
        face_index: faceIndex,
        distance: distance.trim() === "" ? null : Number(distance),
      };
      await createFinalCut(jobId, body);
      onCreated();
      onClose();
    } catch (e) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Failed to start Final Cut");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Final Cut</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Face-swap the character onto this job&apos;s finalized video via FaceFusion. Queued like any
          job — you can run this multiple times.
        </Typography>

        <TextField
          fullWidth
          size="small"
          type="number"
          label="Face to swap"
          value={faceIndex}
          onChange={(e) => setFaceIndex(Math.max(0, parseInt(e.target.value || "0", 10)))}
          helperText="Which face in a multi-person clip (0 = first, left-to-right)."
          inputProps={{ min: 0 }}
          sx={{ mb: 2 }}
        />

        <TextField
          fullWidth
          size="small"
          type="number"
          label="Match distance (advanced, optional)"
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
          helperText="Blank = auto. Higher holds through head-turns; lower isolates one person (0.0–1.5)."
          inputProps={{ min: 0, max: 1.5, step: 0.05 }}
          sx={{ mb: 1.5 }}
        />

        <Typography variant="caption" color="text.secondary">
          Reference face: the job&apos;s start image.
        </Typography>
        {error && (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting}
          startIcon={submitting ? <CircularProgress size={16} /> : undefined}
        >
          {submitting ? "Starting…" : "Start Final Cut"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
