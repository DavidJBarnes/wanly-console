import { useEffect, useState } from "react";
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Stack, TextField, Typography,
} from "@mui/material";

import { createTrainingJob } from "../api/client";
import {
  canTrain, defaultLoraName, loraFilename, nameNeedsSanitising,
} from "../lib/trainingJob";

/**
 * Queue a character-LoRA training run from the images selected in the repo (#454).
 *
 * The rules it enforces are in src/lib/trainingJob.ts, because vite's test config is node-env
 * and pure-logic only — anything with a right answer has to live outside a component to be
 * covered at all.
 */
export default function TrainLoraDialog({
  open, imageKeys, onClose, onQueued,
}: {
  open: boolean;
  /** s3:// URIs of the selected images, in selection order. */
  imageKeys: string[];
  onClose: () => void;
  onQueued: (id: string) => void;
}) {
  const [character, setCharacter] = useState("");
  const [trigger, setTrigger] = useState("");
  const [loraName, setLoraName] = useState("");
  const [version, setVersion] = useState(1);
  const [caption, setCaption] = useState("");
  const [steps, setSteps] = useState(1200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The trigger and the filename both follow the character until the user says otherwise.
  // Kept as one effect rather than derived at render so a deliberate edit is not overwritten
  // on the next keystroke.
  useEffect(() => {
    setTrigger((t) => (t === "" ? character : t));
    setLoraName((n) => (n === "" ? defaultLoraName(character) : n));
  }, [character]);

  const eligible = canTrain(imageKeys);
  const epochs = Math.max(1, Math.floor(steps / Math.max(1, imageKeys.length * 10)));

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const job = await createTrainingJob({
        character, trigger, version, steps,
        lora_name: loraName || defaultLoraName(character),
        caption: caption || null,
        dataset_images: imageKeys,
      });
      onQueued(job.id);
      onClose();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "could not queue the job");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Train a character LoRA</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {!eligible.ok && <Alert severity="error">{eligible.reason}</Alert>}
          {eligible.warning && <Alert severity="warning">{eligible.warning}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}

          <Typography variant="body2" color="text.secondary">
            {imageKeys.length} selected image{imageKeys.length === 1 ? "" : "s"}.
          </Typography>

          <TextField
            label="Character"
            value={character}
            onChange={(e) => setCharacter(e.target.value)}
            helperText="The character this LoRA is of. Retraining an existing one repoints it."
            autoFocus
            fullWidth
          />
          <TextField
            label="Trigger"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            helperText="What the captions say and a prompt types. May differ from the name."
            fullWidth
          />
          <TextField
            label="LoRA filename"
            value={loraName}
            onChange={(e) => setLoraName(e.target.value)}
            helperText={
              nameNeedsSanitising(character)
                ? `A LoRA is served over HTTP, so the filename cannot hold every character the ` +
                  `name can. Installs as ${loraFilename(loraName || "lora", version)}`
                : `Installs as ${loraFilename(loraName || "lora", version)}`
            }
            fullWidth
          />

          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              label="Version"
              type="number"
              value={version}
              onChange={(e) => setVersion(Math.max(1, parseInt(e.target.value) || 1))}
              sx={{ width: 120 }}
            />
            <TextField
              label="Steps"
              type="number"
              value={steps}
              onChange={(e) => setSteps(parseInt(e.target.value) || 1200)}
              helperText={`~${epochs} epochs over ${imageKeys.length} images`}
              sx={{ flex: 1 }}
            />
          </Box>

          <TextField
            label="Caption (optional)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={`${trigger || "trigger"}, woman`}
            helperText={
              "Applied to every image. Captions bind whatever they do not name — one caption " +
              "over close-ups makes the trigger carry close-up framing as part of its identity."
            }
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!eligible.ok || busy || !character.trim() || !trigger.trim()}
          onClick={submit}
        >
          {busy ? "Queueing…" : "Queue training"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
