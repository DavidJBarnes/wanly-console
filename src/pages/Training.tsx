import { useCallback, useEffect, useRef, useState } from "react";
import { characterIconUri } from "../lib/characterIcon";
import { useSearchParams } from "react-router";
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Avatar, Box, Button, Card,
  CardContent, Chip, IconButton, LinearProgress, Stack, TextField, Tooltip, Typography,
} from "@mui/material";

import {
  CheckCircle, CloudUpload, ContentCopy, Delete, DeleteForever, Download, EditNote, ExpandMore, ModelTraining,
  Refresh,
} from "@mui/icons-material";

import {
  cancelTrainingJob, deleteTrainingCheckpoint, deleteTrainingJob, getFileUrl, listTrainingJobs,
  publishTrainingEpoch,
  retryTrainingJob, updateTrainingNotes,
} from "../api/client";
import { createCharacter, listRecipes, updateCharacter } from "../api/ltx";
import type { Character } from "../api/ltx";
import StatusChip from "../components/StatusChip";
import { POLL_INTERVAL_FAST } from "../constants";
import {
  checkpointInUse, epochRows, runTriggerPhrase, runTriggers, scpCommand, groupByCharacter, isSdxlJob, loraStem, lossPath, runTimeDetail, runTimeLabel,
  trainingPct, trainingSummary, queueEtas, etaLabel, type RunEta,
} from "../lib/trainingJob";
import LossChart from "../components/LossChart";
import TrainLoraDialog from "../components/TrainLoraDialog";
import TrainedOnDialog from "../components/TrainedOnDialog";
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
  // When `jobs` was fetched: the ETAs are computed against it (console#602), and taking the
  // clock here rather than during render keeps render pure.
  const [fetchedAt, setFetchedAt] = useState(0);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [error, setError] = useState("");
  // The Train dialog without a dataset: pick who to train and it finds their sets (#537).
  const [trainOpen, setTrainOpen] = useState(false);
  // A segment's recipe popover links here as /training?character=<name> (#452). Convenient,
  // not load-bearing: an unknown or renamed character simply no-ops, because the blob holds
  // a name, not an id.
  const [searchParams] = useSearchParams();
  const askedCharacter = searchParams.get("character");
  const matchedRef = useRef<HTMLDivElement | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      setJobs(await listTrainingJobs());
      setFetchedAt(Date.now());
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
  const etas = queueEtas(jobs, fetchedAt);

  // Scroll to the character the segment popover came for, once the runs that could contain
  // it have loaded. Harmless if it never matches.
  useEffect(() => {
    if (askedCharacter && matchedRef.current) {
      matchedRef.current.scrollIntoView({ block: "start" });
    }
  }, [askedCharacter, groups.length]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, mb: 3 }}>
        <Typography variant="h4">LoRA Training</Typography>
        <Typography variant="body2" color="text.secondary">
          {groups.length} character{groups.length === 1 ? "" : "s"}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" startIcon={<ModelTraining />} onClick={() => setTrainOpen(true)}>
          Train
        </Button>
      </Box>
      {trainOpen && (
        <TrainLoraDialog
          onClose={() => setTrainOpen(false)}
          onQueued={() => { setTrainOpen(false); fetchJobs(); }}
        />
      )}

      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

      {jobs.length === 0 && !error && (
        <Typography variant="body2" color="text.secondary">
          No training runs yet. Choose “Train” above, or open a dataset and choose “Train”
          there.
        </Typography>
      )}

      <Stack spacing={3}>
        {groups.map((g) => {
          // The character's icon (console#616), the same one every picker shows.
          const face = characterIconUri(characters.find((c) => c.name === g.character))
            ?? g.runs.find((r) => r.thumbnail_uri)?.thumbnail_uri;
          const askedHere = !!askedCharacter && g.character === askedCharacter;
          return (
          <Box
            key={g.character}
            ref={askedHere ? matchedRef : undefined}
            // scrollIntoView can only stop at the container's top; the fixed TopBar would
            // cover the name. The margin is the room it needs.
            sx={askedHere ? { scrollMarginTop: 80 } : undefined}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
              {/* The dataset's anchor: the face this LoRA is of. */}
              <Avatar
                src={face ? getFileUrl(face) : undefined}
                variant="rounded"
                // The one who arrived from a segment popover: the name takes the accent and
                // the face gets a ring, so scrolling lands somewhere visibly specific.
                sx={{ width: 56, height: 56, ...(askedHere && { border: 2, borderColor: "primary.main" }) }}
              >
                {g.character.slice(0, 1).toUpperCase()}
              </Avatar>
              <Typography variant="h5" color={askedHere ? "primary" : undefined}>{g.character}</Typography>
            </Box>
            <Stack spacing={1.5}>
              {g.runs.map((job) => (
                <TrainingRow
                  key={job.id}
                  job={job}
                  eta={etas.get(job.id)}
                  characters={characters}
                  onChanged={() => { fetchJobs(); fetchCharacters(); }}
                  onJob={(updated) => setJobs((js) => js.map((j) => (j.id === updated.id ? updated : j)))}
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
  job, eta, characters, onChanged, onJob,
}: {
  job: TrainingJob; eta?: RunEta; characters: Character[]; onChanged: () => void;
  /** The API's copy of this run after a change made here, ahead of the next poll. */
  onJob: (job: TrainingJob) => void;
}) {
  const pct = trainingPct(job);
  const live = job.status === "running" || job.status === "claimed" || job.status === "pending";
  const when = runTimeLabel(job);
  const inUse = checkpointInUse(job, characters);
  // A start-image LoRA (console#600): the LTX engine cannot load it, so it is never "used".
  const sdxl = isSdxlJob(job);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  /** The trigger chip says "copied" for a moment: the row's message line is inside the
   *  checkpoints accordion, which is usually collapsed. */
  const [triggerCopied, setTriggerCopied] = useState(false);
  const [trainedOnOpen, setTrainedOnOpen] = useState(false);
  /** The API's reason for refusing to delete this run with its files, while it stands. */
  const [refusal, setRefusal] = useState("");
  /** Likewise for a refused checkpoint delete (console#627): a character renders with it, a
   *  queued render names it. */
  const [checkpointErr, setCheckpointErr] = useState("");
  /** Likewise for a refused retry (a live twin of the same version, a dataset that fell
   *  below the minimum since the run died). */
  const [retryErr, setRetryErr] = useState("");
  /** null = the note is not being edited. Held HERE rather than read off `job` because the
   *  page polls and a poll replaces the job object -- a textarea reading props would be
   *  clobbered mid-typing by the next refresh of the same run. */
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);

  const saveNotes = async () => {
    if (notesDraft === null) return;
    setSavingNotes(true);
    setMsg("");
    try {
      // A whitespace-only draft is a deliberate clear, not a save to ignore.
      await updateTrainingNotes(job.id, notesDraft.trim() === "" ? null : notesDraft);
      setNotesDraft(null);
      onChanged();
    } catch {
      setMsg("could not save the note");
    } finally {
      setSavingNotes(false);
    }
  };

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

  /** Re-queue a failed run in place. It trains exactly its own snapshot (wanly-api#423) —
   *  the images and captions it recorded — never what the dataset holds now. */
  const retry = async () => {
    setRetryErr("");
    try {
      await retryTrainingJob(job.id);
      onChanged();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setRetryErr(typeof d === "string" ? d : "could not retry it");
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

  /** Copy an scp that pulls this checkpoint off the trainer box -- onto 3090b for A1111. */
  const copyScp = async (label: string) => {
    setMsg("");
    try {
      await navigator.clipboard.writeText(scpCommand(job, label));
      setMsg(`scp for ${label} copied — paste it in a shell, in the directory you want it in.`);
    } catch {
      setMsg("could not copy the scp command");
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

  /** Delete one checkpoint forever (console#627) — the "test, then upload or delete" half of
   *  the "none" upload mode, and the only way to free trainer disk short of deleting the run. */
  const deleteCheckpoint = async (label: string, uploaded: boolean) => {
    if (!confirm(`Delete ${label} forever? It is removed from 3090a`
                 + (uploaded ? ", and from S3 — it was uploaded" : "")
                 + ". This can't be undone.")) return;
    setBusy(true);
    setCheckpointErr("");
    try {
      onJob(await deleteTrainingCheckpoint(job.id, label));
      setMsg(`${label} deleted`);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setCheckpointErr(typeof d === "string" ? d : `could not delete ${label}`);
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
          {/* Which model the LoRA is for (#600, #614). A run from before `arch` is LTX. One
              character can have an LTX v1 and an SDXL v1 side by side (#612), so both say so. */}
          {sdxl ? (
            <Tooltip title="SDXL start-image LoRA (aio recipe). Download it for A1111; it is not an LTX character.">
              <Chip size="small" color="secondary" variant="outlined" label="SDXL" />
            </Tooltip>
          ) : (
            <Tooltip title="LTX video LoRA. Use points the character at it for renders.">
              <Chip size="small" color="info" variant="outlined" label="LTX" />
            </Tooltip>
          )}
          <Tooltip
            title={
              // The joint total, per group: "Payton Synthetic (55) · Me Synthetic (50)".
              [job.dataset_images.length && `${(job.config.dataset as {name?: string|null})?.name ?? "ad-hoc"} (${job.dataset_images.length})`,
               ...(job.identities ?? []).map((g) =>
                 `${g.dataset?.name ?? "ad-hoc"} (${g.images?.length ?? g.dataset?.count ?? 0})`)]
                .filter(Boolean).join(" · ")
            }
          >
            {/* Click: what this run trained on, image by image (wanly-api#422). The run is the
                record now; the dataset may have moved on since. */}
            <Chip size="small" variant="outlined" onClick={() => setTrainedOnOpen(true)}
              label={`${job.dataset_images.length + (job.identities ?? [])
                .reduce((n, g) => n + (g.images?.length ?? g.dataset?.count ?? 0), 0)} images`} />
          </Tooltip>
          {trainedOnOpen && (
            <TrainedOnDialog jobId={job.id} title={`${job.character} v${job.version}`}
                             onClose={() => setTrainedOnOpen(false)} />
          )}
          {runTriggers(job).length > 0 && (
            <Tooltip title="The trigger this LoRA trained under — prompt with it. Click to copy.">
              <Chip
                size="small"
                variant="outlined"
                color="primary"
                label={triggerCopied ? "copied" : `trigger: ${runTriggerPhrase(job)}`}
                onClick={async () => {
                  try {
                    // Exactly what the badge shows (#629): it used to show "and" and copy ", ".
                    await navigator.clipboard.writeText(runTriggerPhrase(job));
                    setTriggerCopied(true);
                    setTimeout(() => setTriggerCopied(false), 1500);
                  } catch {
                    setMsg("could not copy the trigger");
                  }
                }}
              />
            </Tooltip>
          )}
          {job.gpu_name && <Chip size="small" variant="outlined" label={job.gpu_name} />}
          {when && (
            <Tooltip title={runTimeDetail(job) ?? when}>
              <Chip size="small" variant="outlined" label={when} />
            </Tooltip>
          )}
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
            <>
              {job.status === "failed" && (
                <Tooltip title="Retry — re-queues this run exactly as it was: the same images and captions it recorded. To train on the dataset as it is now, start a new run">
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => { void retry(); }}
                  >
                    <Refresh fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
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
            </>
          )}
        </Box>

        {/* WHERE IT CAN BE SEEN, same rule as the delete refusal below: a refused retry that
            only flipped the chip back to pending for a second is not a retry. */}
        {retryErr && (
          <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setRetryErr("")}>
            {retryErr}
          </Alert>
        )}

        {/* Above the accordion for the same reason: the refusal is the answer to a click. */}
        {checkpointErr && (
          <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setCheckpointErr("")}>
            {checkpointErr}
          </Alert>
        )}

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
        {eta && (
          <Typography variant="caption" color="text.secondary" component="div">
            {etaLabel(eta)}
          </Typography>
        )}

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

        {/* NOTES. The judgements a run earns that no machine field fits -- loss does not rank
            checkpoints, tags are vocabulary, and progress_log is the trainer's channel that is
            overwritten on every report. Saved explicitly: a poll replaces the job object, so a
            textarea bound to it would be clobbered mid-typing. */}
        {notesDraft === null ? (
          <Box sx={{ mt: 1.5, display: "flex", alignItems: "flex-start", gap: 0.5 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ whiteSpace: "pre-wrap", flex: 1, minWidth: 0 }}
            >
              {job.notes || "No notes."}
            </Typography>
            <Tooltip title={job.notes ? "Edit notes" : "Add a note"}>
              <IconButton size="small" onClick={() => setNotesDraft(job.notes ?? "")}
                          sx={{ color: "text.disabled" }}>
                <EditNote fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ) : (
          <Box sx={{ mt: 1.5 }} onClick={(e) => e.stopPropagation()}>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={3}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="What you learned by eye: why a checkpoint was picked, what was rejected…"
              autoFocus
            />
            <Box sx={{ display: "flex", gap: 1, mt: 0.5, justifyContent: "flex-end" }}>
              <Button size="small" onClick={() => setNotesDraft(null)}>Cancel</Button>
              <Button
                size="small"
                variant="contained"
                onClick={saveNotes}
                disabled={savingNotes}
              >
                {savingNotes ? "Saving…" : "Save note"}
              </Button>
            </Box>
          </Box>
        )}

        {msg && rows.length === 0 && (
          <Typography variant="caption" color="error.main" sx={{ display: "block", mt: 1 }}>
            {msg}
          </Typography>
        )}

        {rows.length > 0 && (
          <Accordion
            disableGutters
            elevation={0}
            sx={{ mt: 1.5, border: 1, borderColor: "divider", "&:before": { display: "none" } }}
          >
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography variant="subtitle2">
                Checkpoints ({rows.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Loss does not rank these — pick by eye at a fixed seed, same start image.{" "}
                {sdxl
                  ? "SDXL checkpoints are for the start-image generator: download one into A1111."
                  : `“Use” points ${job.character} at one.`}{" "}
                One that stayed on the trainer can be uploaded from here; any can be deleted
                for good, which frees the trainer's disk.
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
                      {/* Every epoch, uploaded or not: it is on the trainer's disk (#606). */}
                      <Tooltip title="Copy an scp that pulls this off the trainer box into the current directory">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<ContentCopy fontSize="small" />}
                          onClick={() => copyScp(row.label)}
                        >
                          Copy scp
                        </Button>
                      </Tooltip>
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
                          {!sdxl && (
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
                          )}
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
                      {/* Same gate as Upload: a live run is still writing these. The API also
                          refuses one a character renders with; disabling says so up front. */}
                      <Tooltip
                        title={live ? "The run is still going — delete once it has finished"
                          : current ? `${job.character} renders with this — point it elsewhere first`
                            : "Delete forever, from the trainer and from S3"}
                      >
                        <span>
                          <Button
                            size="small"
                            variant="text"
                            color="error"
                            startIcon={<DeleteForever fontSize="small" />}
                            disabled={busy || live || current}
                            onClick={() => deleteCheckpoint(row.label, row.uri !== null)}
                          >
                            Delete
                          </Button>
                        </span>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Stack>
              {msg && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                  {msg}
                </Typography>
              )}
            </AccordionDetails>
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
