import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import { Alert, Box, Chip, Stack, Tooltip, Typography } from "@mui/material";

import { getDatasetRuns, listTrainingJobs } from "../api/client";
import { listRecipes } from "../api/ltx";
import type { Character } from "../api/ltx";
import type { Dataset, DatasetRun, TrainingJob } from "../api/types";
import { POLL_INTERVAL_FAST } from "../constants";
import { queueEtas } from "../lib/trainingJob";
import TrainingRow from "./TrainingRow";

/**
 * A dataset's run history (wanly-console#647): the right-hand panel of /datasets/:id.
 *
 * Training is reached through datasets only -- the LoRA Training page left the nav -- so every
 * run must be reachable from some dataset's panel, with everything that page could do for it
 * (the same TrainingRow card). Which runs, and in what role, is the API's call
 * (GET /datasets/{id}/runs): this set's own runs; a pair run on its composition set, and
 * tagged "pair" on each member's set; a run whose sets are all gone on its character's set.
 *
 * Polls only while one of its runs is live; the run list is read once per refresh, because the
 * ETAs need every queued run, not just this set's.
 */
export default function DatasetRunsPanel({
  ds, refreshKey, focusRun, loadRuns, title = "Training runs",
}: {
  /** The set whose runs these are. Null on a character with no living set (wanly-api#452):
   *  then `loadRuns` supplies them. */
  ds: Dataset | null;
  refreshKey: number;
  focusRun?: string | null;
  /** Where the runs come from; the set's own list by default. */
  loadRuns?: () => Promise<DatasetRun[]>;
  title?: string;
}) {
  const fetchRuns = loadRuns ?? (() => (ds ? getDatasetRuns(ds.id) : Promise.resolve([])));
  const fetchRef = useRef(fetchRuns);
  useEffect(() => { fetchRef.current = fetchRuns; });
  const key = ds?.id ?? "none";
  const [runs, setRuns] = useState<DatasetRun[] | null>(null);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [error, setError] = useState("");
  const focusRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, all] = await Promise.all([fetchRef.current(), listTrainingJobs({ limit: 500 })]);
      setRuns(r);
      setJobs(all);
      setFetchedAt(Date.now());
      setError("");
    } catch {
      setError("could not load this set's training runs");
    }
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([fetchRef.current(), listTrainingJobs({ limit: 500 })])
      .then(([r, all]) => {
        if (!live) return;
        setRuns(r); setJobs(all); setFetchedAt(Date.now()); setError("");
      })
      .catch(() => { if (live) setError("could not load this set's training runs"); });
    listRecipes().then((b) => { if (live) setCharacters(b.characters); }).catch(() => {});
    return () => { live = false; };
  }, [key, refreshKey]);

  const byId = new Map(jobs.map((j) => [j.id, j]));
  const shown = (runs ?? []).map((r) => ({ r, job: byId.get(r.job_id) }))
    .filter((x): x is { r: DatasetRun; job: TrainingJob } => Boolean(x.job));
  const anyLive = shown.some(({ job }) =>
    job.status === "running" || job.status === "claimed" || job.status === "pending");

  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(load, POLL_INTERVAL_FAST);
    return () => clearInterval(t);
  }, [anyLive, load]);

  // Arrived from an old /training?run=<id> link: scroll to that run once it is drawn.
  useEffect(() => {
    if (focusRun && focusRef.current) focusRef.current.scrollIntoView({ block: "start" });
  }, [focusRun, shown.length]);

  const etas = queueEtas(jobs, fetchedAt);

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>{title}</Typography>
      {error && <Alert severity="warning" sx={{ mb: 1 }}>{error}</Alert>}
      {runs && shown.length === 0 && !error && (
        <Typography variant="body2" color="text.secondary">
          No runs yet. “Train” starts one, and it shows here.
        </Typography>
      )}
      <Stack spacing={1.5}>
        {shown.map(({ r, job }) => (
          <Box key={job.id} ref={job.id === focusRun ? focusRef : undefined}
               sx={job.id === focusRun ? { scrollMarginTop: 80, outline: "2px solid",
                                           outlineColor: "primary.main", borderRadius: 1 } : undefined}>
            {r.role === "pair_member" && r.pair && (
              <Tooltip title="A pair run that also trained on this set. It lives on the pair's own dataset.">
                <Chip size="small" variant="outlined" sx={{ mb: 0.5 }}
                      label={`pair: ${r.pair.character}`}
                      clickable={Boolean(r.pair.dataset_id)}
                      component={r.pair.dataset_id ? RouterLink : "div"}
                      {...(r.pair.dataset_id ? { to: `/datasets/${r.pair.dataset_id}?run=${job.id}` } : {})} />
              </Tooltip>
            )}
            {r.role === "orphan" && (
              <Tooltip title="Every dataset this run trained on has since been deleted; it is kept here, on its character's set. Its record of what it trained on is intact.">
                <Chip size="small" color="warning" variant="outlined" sx={{ mb: 0.5 }}
                      label="original dataset gone" />
              </Tooltip>
            )}
            <TrainingRow
              job={job}
              eta={etas.get(job.id)}
              characters={characters}
              onChanged={() => { void load(); listRecipes().then((b) => setCharacters(b.characters)).catch(() => {}); }}
              onJob={(updated) => setJobs((js) => js.map((j) => (j.id === updated.id ? updated : j)))}
            />
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
