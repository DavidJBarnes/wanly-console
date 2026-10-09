import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from "react-router";
import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";
import { ArrowBack } from "@mui/icons-material";

import { getDataset } from "../api/client";
import { listRecipes } from "../api/ltx";
import type { Character } from "../api/ltx";
import type { Dataset } from "../api/types";
import { DatasetCard } from "../components/DatasetCard";
import TrainLoraDialog from "../components/TrainLoraDialog";
import DatasetRunsPanel from "../components/DatasetRunsPanel";
import { characterSetHome, ownerOf } from "../lib/characterPage";

/**
 * One dataset, on its own page (wanly-console#647).
 *
 * Reads and re-reads ONLY this set: a change here -- a crop, a caption run finishing, a face
 * measure -- fetches GET /datasets/{id}, never the whole list (console#640: ~100 list reads in
 * 15 s on 2026-10-08 when every card on the shared page did it).
 */
export default function DatasetDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [ds, setDs] = useState<Dataset | null>(null);
  const [error, setError] = useState("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [training, setTraining] = useState(false);
  // Bumped after a run is queued so the run panel re-reads at once.
  const [runsKey, setRunsKey] = useState(0);
  // An old /training?run=<id> link lands here with that run (wanly-console#647).
  const [searchParams] = useSearchParams();
  const focusRun = searchParams.get("run");

  const fetchOne = useCallback(async () => {
    try {
      setDs(await getDataset(id));
      setError("");
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(status === 404 ? "No such dataset — it may have been deleted." : "could not load the dataset");
    }
  }, [id]);

  const fetchCharacters = useCallback(() => {
    listRecipes().then((b) => setCharacters(b.characters)).catch(() => {});
  }, []);

  // The first read, here rather than through fetchOne so a late answer for a set already
  // navigated away from (a clone moves the URL) is dropped.
  useEffect(() => {
    let live = true;
    getDataset(id)
      .then((d) => { if (live) { setDs(d); setError(""); } })
      .catch((e: unknown) => {
        if (!live) return;
        const status = (e as { response?: { status?: number } })?.response?.status;
        setError(status === 404 ? "No such dataset — it may have been deleted." : "could not load the dataset");
      });
    listRecipes().then((b) => { if (live) setCharacters(b.characters); }).catch(() => {});
    return () => { live = false; };
  }, [id]);
  // After a clone the URL moves to the copy before its read lands: show nothing stale meanwhile.
  const shown = ds && ds.id === id ? ds : null;

  // A CHARACTER'S OWN SET LIVES ON ITS CHARACTER'S PAGE (wanly-api#452): an old link to it
  // lands on the Images tab (or Training, with the run, from an old /training?run= link).
  // Archived version sets, unassigned sets and regularization pools still show here.
  const owner = shown ? ownerOf(shown, characters) : null;
  useEffect(() => {
    if (owner) navigate(characterSetHome(owner, focusRun), { replace: true });
  }, [owner, focusRun, navigate]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
        <Button component={RouterLink} to="/characters" startIcon={<ArrowBack />} size="small">
          Characters
        </Button>
        {shown && <Typography variant="h4" noWrap>{shown.name}</Typography>}
      </Box>

      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
      {!shown && !error && <CircularProgress size={22} />}
      {shown && (
        // The set on the left, its run history on the right (wanly-console#647); one column,
        // runs below, when the screen is narrow.
        <Box sx={{ display: "grid", gap: 2, alignItems: "start",
                   gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 420px" } }}>
          <Box sx={{ minWidth: 0 }}>
            <DatasetCard
              key={shown.id}
              ds={shown}
              characters={characters}
              onChanged={fetchOne}
              onCharactersChanged={fetchCharacters}
              onTrain={() => setTraining(true)}
              onCloned={(copy) => navigate(`/datasets/${copy.id}`)}
              onDeleted={() => navigate("/characters", { replace: true })}
            />
          </Box>
          <DatasetRunsPanel ds={shown} refreshKey={runsKey} focusRun={focusRun} />
        </Box>
      )}
      {shown && training && (
        <TrainLoraDialog
          dataset={shown}
          onClose={() => setTraining(false)}
          onQueued={() => { setTraining(false); setRunsKey((k) => k + 1); }}
        />
      )}
    </Box>
  );
}
