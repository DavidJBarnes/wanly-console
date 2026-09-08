import { useCallback, useEffect, useState } from "react";
import {
  Alert, Avatar, Box, Button, Card, CardContent, Chip, IconButton, LinearProgress, Stack,
  Tooltip, Typography,
} from "@mui/material";

import { CheckCircle, CloudUpload, Delete, Download } from "@mui/icons-material";

import {
  cancelTrainingJob, deleteTrainingJob, getFileUrl, listTrainingJobs, publishTrainingEpoch,
} from "../api/client";
import { createCharacter, listRecipes, updateCharacter } from "../api/ltx";
import type { Character } from "../api/ltx";
import StatusChip from "../components/StatusChip";
import { POLL_INTERVAL_FAST } from "../constants";
import {
  checkpointInUse, epochRows, groupByCharacter, loraStem, lossPath, trainingPct,
  trainingSummary,
} from "../lib/trainingJob";
import LossChart from "../components/LossChart";
import type { TrainingJob } from "../api/types";

/**
 * Character-LoRA training runs (#454).
 *
 * Polls with the house pattern — useEffect + setInterval, errors swallowed into a string, and
 * existing data never blanked on a failed fetch, because a momentary API blip should not empty
 * a page someone is watching a 50-minute job on.
 *
 * A LIST OF CHARACTERS, each with its versions -- not a run history (#464). A version is one
 * training run; a retried version shows its current attempt above the failed one, and a
 * finished one shows its checkpoints with a Use button, because the point of a finished run
 * is to pick, by eye, which checkpoint the character renders with.
 */
export default function Training() {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [error, setError] = useState("");

  const fetchJobs = useCallback(async () => {
    try {
      setJobs(await listTrainingJobs());
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

  const groups = groupByCharacter(jobs);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, mb: 3 }}>
        <Typography variant="h4">LoRA Training</Typography>
        <Typography variant="body2" color="text.secondary">
          {groups.length} character{groups.length === 1 ? "" : "s"}
        </Typography>
      </Box>

      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

      {jobs.length === 0 && !error && (
        <Typography variant="body2" color="text.secondary">
          No training runs yet. Open a dataset and choose “Train”, or select images in the
          Image Repo and choose “Train LoRA”.
        </Typography>
      )}

      <Stack spacing={3}>
        {groups.map((g) => {
          const face = characters.find((c) => c.name === g.character)?.image_uri
            ?? g.runs.find((r) => r.thumbnail_uri)?.thumbnail_uri;
          return (
          <Box key={g.character}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
              {/* The dataset's anchor: the face this LoRA is of. */}
              <Avatar
                src={face ? getFileUrl(face) : undefined}
                variant="rounded"
                sx={{ width: 56, height: 56 }}
              >
                {g.character.slice(0, 1).toUpperCase()}
              </Avatar>
              <Typography variant="h5">{g.character}</Typography>
            </Box>
            <Stack spacing={1.5}>
              {g.runs.map((job) => (
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
        })}
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
  /** The API's reason for refusing to delete this run with its files, while it stands. */
  const [refusal, setRefusal] = useState("");

  const remove = async (purge: boolean) => {
    setRefusal("");
    try {
      await deleteTrainingJob(job.id, purge);
      onChanged();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setRefusal(typeof d === "string" ? d : "could not delete it");
    }
  };

  /** Point the character at this checkpoint. Creates the character if the run is its first. */
  const use = async (uri: string) => {
    setBusy(true);
    setMsg("");
    try {
      const existing = characters.find((c) => c.name === job.character);
      const stem = loraStem(uri);
      const face = job.thumbnail_uri ? { image_uri: job.thumbnail_uri } : {};
      if (existing) {
        await updateCharacter(existing.id, { char_lora: stem, trigger: job.trigger, ...face });
      } else {
        await createCharacter({ name: job.character, char_lora: stem, trigger: job.trigger, ...face });
      }
      setMsg(`${job.character} now renders with ${stem}`);
      onChanged();
    } catch {
      setMsg("could not update the character");
    } finally {
      setBusy(false);
    }
  };

  const publish = async (label: string) => {
    setBusy(true);
    setMsg("");
    try {
      await publishTrainingEpoch(job.id, label);
      setMsg(`${label} will upload on the trainer's next poll — about 18 minutes once it starts`);
      onChanged();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setMsg(typeof d === "string" ? d : "could not request it");
    } finally {
      setBusy(false);
    }
  };

  const rows = epochRows(job);
  const curve = lossPath(job.loss_log, 320, 72);

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
          <Typography variant="h6">v{job.version}</Typography>
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
            <Tooltip title="Delete this version and its LoRA files">
              <IconButton
                size="small"
                color="error"
                onClick={() => {
                  const n = job.checkpoints?.length ?? 0;
                  if (!confirm(`Delete ${job.character} v${job.version}`
                               + (n ? ` and its ${n} LoRA file${n === 1 ? "" : "s"}?` : "?"))) return;
                  remove(true);
                }}
              >
                <Delete fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {/* WHERE IT CAN BE SEEN. The API's refusal used to land in the small caption under
            the checkpoint list, and "delete did not work" was the report. */}
        {refusal && (
          <Alert
            severity="warning"
            sx={{ mb: 1 }}
            onClose={() => setRefusal("")}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  if (!confirm(`Delete the ${job.character} v${job.version} run and KEEP its LoRA files in the library?`)) return;
                  remove(false);
                }}
              >
                Delete, keep the files
              </Button>
            }
          >
            {refusal}
          </Alert>
        )}

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

        {curve.points.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <LossChart
              curve={curve}
              width={320}
              height={72}
              lastStep={job.loss_log?.[job.loss_log.length - 1]?.[0] ?? null}
            />
          </Box>
        )}

        {msg && rows.length === 0 && (
          <Typography variant="caption" color="error.main" sx={{ display: "block", mt: 1 }}>
            {msg}
          </Typography>
        )}

        {rows.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="subtitle2">
              Checkpoints ({rows.length})
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Loss does not rank these — pick by eye at a fixed seed, same start image. “Use”
              points {job.character} at one. An epoch that stayed on the trainer can be
              uploaded from here.
            </Typography>
            <Stack spacing={0.5}>
              {rows.map((row) => {
                const current = row.uri !== null && row.uri === inUse;
                return (
                  <Box key={row.label} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                    <Typography sx={{ width: 48, fontFamily: "monospace" }}>{row.label}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ width: 150 }}>
                      {row.step !== null ? `step ${row.step}` : ""}
                      {row.loss !== null ? ` · loss ${row.loss.toFixed(3)}` : ""}
                    </Typography>
                    {row.uri ? (
                      <>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<Download fontSize="small" />}
                          // getFileUrl goes through the API's /files proxy, which 307s to a
                          // presigned URL — so the browser never needs S3 credentials.
                          href={getFileUrl(row.uri)}
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
                          onClick={() => use(row.uri as string)}
                        >
                          {current ? "In use" : "Use"}
                        </Button>
                        <Typography variant="caption" color="text.secondary">
                          {loraStem(row.uri)}
                        </Typography>
                      </>
                    ) : row.requested ? (
                      <Chip size="small" variant="outlined" label="uploading soon" />
                    ) : (
                      <Button
                        size="small"
                        variant="text"
                        startIcon={<CloudUpload fontSize="small" />}
                        disabled={busy || live}
                        onClick={() => publish(row.label)}
                      >
                        Upload
                      </Button>
                    )}
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
        )}
      </CardContent>
    </Card>
  );
}
