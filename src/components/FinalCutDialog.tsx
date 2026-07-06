import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  CircularProgress,
} from "@mui/material";

import { useLoraStore } from "../stores/loraStore";
import { createFinalCut } from "../api/client";
import type { FinalCutCreate } from "../api/types";

interface FinalCutDialogProps {
  open: boolean;
  jobId: string;
  defaultPrompt?: string;
  onClose: () => void;
  onCreated: () => void;
}

// Final Cut: re-render a job's finalized video through Wan Animate (identity-locked) as a linked
// child job. Runs on the normal queue. Reference defaults to the source job's start image.
export default function FinalCutDialog({ open, jobId, defaultPrompt, onClose, onCreated }: FinalCutDialogProps) {
  const { loras, fetchLoras } = useLoraStore();
  const [mode, setMode] = useState<"move" | "mix">("mix");
  const [preset, setPreset] = useState<"fast" | "highres">("fast");
  const [loraId, setLoraId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchLoras();
      setPrompt(defaultPrompt ?? "");
    }
  }, [open, defaultPrompt, fetchLoras]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const lora = loras.find((l) => l.id === loraId);
      const body: FinalCutCreate = {
        mode,
        preset,
        loras: lora
          ? [{ lora_id: lora.id, high_weight: lora.default_high_weight, low_weight: lora.default_low_weight }]
          : null,
        prompt: prompt.trim() || null,
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
          Re-render this job&apos;s finalized video through Wan Animate (identity-locked). Queued like any
          job — you can run this multiple times.
        </Typography>

        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Mode
        </Typography>
        <ToggleButtonGroup
          exclusive
          fullWidth
          value={mode}
          onChange={(_, v) => v && setMode(v)}
          size="small"
          sx={{ mb: 2 }}
        >
          <ToggleButton value="mix">Mix — keep scene</ToggleButton>
          <ToggleButton value="move">Move — new scene</ToggleButton>
        </ToggleButtonGroup>

        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Quality
        </Typography>
        <ToggleButtonGroup
          exclusive
          fullWidth
          value={preset}
          onChange={(_, v) => v && setPreset(v)}
          size="small"
          sx={{ mb: 2 }}
        >
          <ToggleButton value="fast">Fast</ToggleButton>
          <ToggleButton value="highres">High-res</ToggleButton>
        </ToggleButtonGroup>

        <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
          <InputLabel id="fc-lora-label">Character LoRA (optional)</InputLabel>
          <Select
            labelId="fc-lora-label"
            label="Character LoRA (optional)"
            value={loraId}
            onChange={(e) => setLoraId(e.target.value)}
          >
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
            {loras.map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {mode === "move" && (
          <TextField
            fullWidth
            multiline
            minRows={2}
            size="small"
            label="Scene prompt (move mode)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            helperText="Shapes the new scene move generates — prefilled from the source job; edit to change it."
            sx={{ mb: 1.5 }}
          />
        )}

        <Typography variant="caption" color="text.secondary">
          Reference: the job&apos;s start image.
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
