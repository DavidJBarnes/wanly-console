import { useCallback, useEffect, useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, LinearProgress, Stack, Typography,
} from "@mui/material";

import { cancelTrainingJob, listTrainingJobs } from "../api/client";
import StatusChip from "../components/StatusChip";
import { POLL_INTERVAL_FAST } from "../constants";
import { byTrainingInterest, trainingPct, trainingSummary } from "../lib/trainingJob";
import type { TrainingJob } from "../api/types";

/**
 * Character-LoRA training runs (#454).
 *
 * Polls with the house pattern — useEffect + setInterval, errors swallowed into a string, and
 * existing data never blanked on a failed fetch, because a momentary API blip should not empty
 * a page someone is watching a 50-minute job on.
 */
export default function Training() {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [error, setError] = useState("");

  const fetchJobs = useCallback(async () => {
    try {
      setJobs((await listTrainingJobs()).sort(byTrainingInterest));
      setError("");
    } catch {
      setError("could not reach the API");
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, POLL_INTERVAL_FAST);
    return () => clearInterval(interval);
  }, [fetchJobs]);

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
          No training runs yet. Select images in the Image Repo and choose “Train LoRA”.
        </Typography>
      )}

      <Stack spacing={2}>
        {jobs.map((job) => (
          <TrainingRow key={job.id} job={job} onChanged={fetchJobs} />
        ))}
      </Stack>
    </Box>
  );
}

function TrainingRow({ job, onChanged }: { job: TrainingJob; onChanged: () => void }) {
  const pct = trainingPct(job);
  const live = job.status === "running" || job.status === "claimed" || job.status === "pending";

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
          {live && (
            <Button
              size="small"
              color="error"
              onClick={async () => { await cancelTrainingJob(job.id); onChanged(); }}
            >
              Cancel
            </Button>
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

        <Typography variant="body2" color="text.secondary">
          {trainingSummary(job)}
        </Typography>

        {job.status === "completed" && job.checkpoints?.length ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            Loss does not rank these — pick by eye at a fixed seed, one checkpoint per arm.
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}
