import { useCallback, useEffect, useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, IconButton, LinearProgress, Stack, Tooltip,
  Typography,
} from "@mui/material";

import { CheckCircle, Delete, Download } from "@mui/icons-material";

import { cancelTrainingJob, deleteTrainingJob, getFileUrl, listTrainingJobs } from "../api/client";
import { createCharacter, listRecipes, updateCharacter } from "../api/ltx";
import type { Character } from "../api/ltx";
import StatusChip from "../components/StatusChip";
import { POLL_INTERVAL_FAST } from "../constants";
import {
  byTrainingInterest, checkpointInUse, checkpointLabel, loraStem, trainingPct, trainingSummary,
} from "../lib/trainingJob";
import type { TrainingJob } from "../api/types";

/**
 * Character-LoRA training runs (#454).
 *
 * Polls with the house pattern — useEffect + setInterval, errors swallowed into a string, and
 * existing data never blanked on a failed fetch, because a momentary API blip should not empty
 * a page someone is watching a 50-minute job on.
 *
 * It also knows the characters, because the point of a finished run is to pick, by eye, which
 * of its checkpoints the character renders with — and until now that meant leaving this page,
 * finding the character under LoRA Recipes, and retyping a filename from memory.
 */
export default function Training() {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [error, setError] = useState("");

  const fetchJobs = useCallback(async () => {
    try {
      setJobs((await listTrainingJobs()).sort(byTrainingInterest));
      setError("");
    } catch {
      setError("could not reach the API");
    }
  }, []);

  const fetchCharacters = useCallback(async () => {
    try {
      setCharacters((await listRecipes()).characters);
    } catch {
      // The runs still show without it; only the "in use" mark and the Use button go quiet.
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    fetchCharacters();
    const interval = setInterval(fetchJobs, POLL_INTERVAL_FAST);
    return () => clearInterval(interval);
  }, [fetchJobs, fetchCharacters]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, mb: 3 }}>
        <Typography variant="h4">Training</Typography>
        <Typography variant="body2" color="text.secondary">
          {jobs.length} run{jobs.length === 1 ? "" : "s"}
        </Typography>
      </Box>

      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

      {jobs.length === 0 && !error && (
        <Typography variant="body2" color="text.secondary">
          No training runs yet. Open a dataset and choose “Train”, or select images in the
          Image Repo and choose “Train LoRA”.
        </Typography>
      )}

      <Stack spacing={2}>
        {jobs.map((job) => (
          <TrainingRow
            key={job.id}
            job={job}
            characters={characters}
            onChanged={() => { fetchJobs(); fetchCharacters(); }}
          />
        ))}
      </Stack>
    </Box>
  );
}

function TrainingRow({
  job, characters, onChanged,
}: { job: TrainingJob; characters: Character[]; onChanged: () => void }) {
  const pct = trainingPct(job);
  const live = job.status === "running" || job.status === "claimed" || job.status === "pending";
  const inUse = checkpointInUse(job, characters);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  /** Point the character at this checkpoint. Creates the character if the run is its first. */
  const use = async (uri: string) => {
    setBusy(true);
    setMsg("");
    try {
      const existing = characters.find((c) => c.name === job.character);
      const stem = loraStem(uri);
      if (existing) {
        await updateCharacter(existing.id, { char_lora: stem, trigger: job.trigger });
      } else {
        await createCharacter({ name: job.character, char_lora: stem, trigger: job.trigger });
      }
      setMsg(`${job.character} now renders with ${stem}`);
      onChanged();
    } catch {
      setMsg("could not update the character");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
          <Typography variant="h6">
            {job.character} <Typography component="span" color="text.secondary">v{job.version}</Typography>
          </Typography>
          <StatusChip status={job.status} />
          <Chip size="small" variant="outlined" label={`${job.dataset_images.length} images`} />
          {job.gpu_name && <Chip size="small" variant="outlined" label={job.gpu_name} />}
          <Box sx={{ flexGrow: 1 }} />
          {live ? (
            <Button
              size="small"
              color="error"
              onClick={async () => { await cancelTrainingJob(job.id); onChanged(); }}
            >
              Cancel
            </Button>
          ) : (
            <Tooltip title="Remove this run from the list. Its LoRAs stay in the library.">
              <IconButton
                size="small"
                color="error"
                onClick={async () => {
                  if (!confirm(`Delete the ${job.character} v${job.version} run?`)) return;
                  await deleteTrainingJob(job.id);
                  onChanged();
                }}
              >
                <Delete fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {/* Determinate only when the trainer has actually reported a step. A queued job has no
            honest percentage, and a bar sitting at 0% reads as started-and-stuck. */}
        {pct !== null ? (
          <Box sx={{ mb: 1 }}>
            <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 1 }} />
          </Box>
        ) : job.status === "running" ? (
          <Box sx={{ mb: 1 }}>
            <LinearProgress sx={{ height: 8, borderRadius: 1 }} />
          </Box>
        ) : null}

        <Typography
          variant="body2"
          color="text.secondary"
          // A failure's last output is a stack trace. Keep it readable, and keep it from
          // turning the row into a page.
          sx={job.status === "failed"
            ? { whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12, maxHeight: 200,
                overflow: "auto" }
            : undefined}
        >
          {trainingSummary(job)}
        </Typography>

        {job.checkpoints?.length ? (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="subtitle2">
              Checkpoints ({job.checkpoints.length})
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Loss does not rank these — pick by eye at a fixed seed, one checkpoint per arm,
              same start image. “Use” points {job.character} at that one; the character renders
              with it from then on.
            </Typography>
            <Stack spacing={0.5}>
              {job.checkpoints.map((uri) => {
                const current = uri === inUse;
                return (
                  <Box key={uri} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography sx={{ width: 56, fontFamily: "monospace" }}>
                      {checkpointLabel(uri)}
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<Download fontSize="small" />}
                      // getFileUrl goes through the API's /files proxy, which 307s to a
                      // presigned URL — so the browser never needs S3 credentials.
                      href={getFileUrl(uri)}
                      download
                    >
                      Download
                    </Button>
                    <Button
                      size="small"
                      variant={current ? "contained" : "outlined"}
                      color={current ? "success" : "primary"}
                      startIcon={current ? <CheckCircle fontSize="small" /> : undefined}
                      disabled={busy || current}
                      onClick={() => use(uri)}
                    >
                      {current ? "In use" : "Use"}
                    </Button>
                    <Typography variant="caption" color="text.secondary">
                      {loraStem(uri)}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
            {msg && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                {msg}
              </Typography>
            )}
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
}
