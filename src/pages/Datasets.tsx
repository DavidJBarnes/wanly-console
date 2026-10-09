import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Alert, Box, Button, Card, CardActionArea, Chip, CircularProgress, FormControlLabel, Stack,
  Switch, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import { Add, Lock, Movie } from "@mui/icons-material";

import { getFileUrl, listDatasets } from "../api/client";
import { NewDatasetDialog } from "../components/DatasetCard";
import {
  byRecent, datasetCover, isAssigned, itemCountLabel, ownerLabel, splitClips, trainedByLabel,
} from "../lib/datasets";
import { faceSizeSummary } from "../lib/faceSize";
import { DATASET_SHOWS, matchesShow, parseShow, showCounts } from "../lib/datasetFilter";
import type { DatasetShow } from "../lib/datasetFilter";
import type { Dataset } from "../api/types";

/**
 * Named, taggable training datasets (wanly-api#277), as a grid of cards (wanly-console#647).
 *
 * Each set is worked on from its OWN page, /datasets/:id, not from a long page where every
 * other set lives too. That was David's ask, and it is also what kept the shared page from
 * costing the API: every card on it polled, measured and re-read the whole list on its own,
 * which fed the 2 GB API box's hang on 2026-10-08 (wanly-api#434, console#640). This page is
 * one GET /datasets and lazy thumbnails -- nothing polls and nothing is measured here.
 */
export default function Datasets() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // An old link, /datasets?dataset=<id> (character cards, the Image Repo; migration 099), is
  // the set's own page now.
  const askedDataset = searchParams.get("dataset");
  useEffect(() => {
    if (askedDataset) navigate(`/datasets/${askedDataset}`, { replace: true });
  }, [askedDataset, navigate]);

  // ALL · SINGLES · PAIRS (wanly-console#643), in the URL so a link or a reload keeps it.
  const show = parseShow(searchParams.get("show"));
  const setShow = (next: DatasetShow) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === "all") p.delete("show");
      else p.set("show", next);
      return p;
    }, { replace: true });
  };
  const counts = showCounts(datasets);
  const visible = datasets.filter((ds) => matchesShow(ds, show));

  // Archived version sets (wanly-api#419) are history: hidden unless asked for.
  const [showArchived, setShowArchived] = useState(false);
  const fetchAll = useCallback(async () => {
    try {
      setDatasets((await listDatasets(showArchived)).sort(byRecent));
      setError("");
    } catch {
      setError("could not load datasets");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <Typography variant="h4">Datasets</Typography>
        <Typography variant="body2" color="text.secondary">
          {show === "all" ? datasets.length : `${visible.length} of ${datasets.length}`}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={show}
          onChange={(_, v: DatasetShow | null) => { if (v) setShow(v); }}
          aria-label="Show which datasets"
          sx={{ alignSelf: "center" }}
        >
          {/* Regularization only when there is a pool to show (or the URL asks for it). */}
          {DATASET_SHOWS.filter((o) => o.value !== "regularization"
            || counts.regularization > 0 || show === "regularization").map((o) => (
            <ToggleButton key={o.value} value={o.value} sx={{ py: 0.25, px: 1.25 }}>
              {o.label}{o.value === "all" ? "" : ` (${counts[o.value]})`}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title="Old version sets folded into each subject's living set. Read-only; their runs still link to them.">
          <FormControlLabel
            control={<Switch size="small" checked={showArchived}
                             onChange={(e) => setShowArchived(e.target.checked)} />}
            label="Show archived"
          />
        </Tooltip>
        <Button variant="contained" startIcon={<Add />} onClick={() => setCreateOpen(true)}>
          New dataset
        </Button>
      </Box>

      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <CircularProgress size={22} />}
      {!loading && datasets.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No datasets yet. A dataset is a named set of images to train a character LoRA from:
          add photos, say whose they are, crop the faces out, star one as the anchor to check
          the rest against it, caption them, then train.
        </Typography>
      )}
      {!loading && datasets.length > 0 && visible.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No {DATASET_SHOWS.find((o) => o.value === show)?.label.toLowerCase()} datasets.{" "}
          <Button size="small" onClick={() => setShow("all")}>Show all</Button>
        </Typography>
      )}

      {/* A grid of cards, like Characters (console#616). Everything else is on the set's page. */}
      <Box sx={{ display: "grid", gap: 2,
                 gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {visible.map((ds) => (
          <DatasetSummaryCard key={ds.id} ds={ds} onOpen={() => navigate(`/datasets/${ds.id}`)} />
        ))}
      </Box>

      <NewDatasetDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => navigate(`/datasets/${created.id}`)}
      />
    </Box>
  );
}

/** One set on the grid: its picture and what you would want to know before opening it. */
function DatasetSummaryCard({ ds, onOpen }: { ds: Dataset; onOpen: () => void }) {
  // The card's picture IS the anchor (David, 2026-10-09); the first still only when there is
  // none -- and the card says so, since an anchor is what likeness scoring checks against.
  const cover = datasetCover(ds);
  const noAnchor = ds.kind !== "regularization" && cover !== null
    && !(ds.anchor_uri && ds.images.includes(ds.anchor_uri));
  const owner = ownerLabel(ds);
  const { clips } = splitClips(ds.images);
  const sizes = ds.kind === "regularization" ? null : faceSizeSummary(ds);
  const runs = ds.trained_by ?? [];
  return (
    <Card variant="outlined" sx={{ opacity: ds.archived_at ? 0.55 : 1 }}>
      <CardActionArea onClick={onOpen}>
        {cover ? (
          <Box component="img" loading="lazy" src={getFileUrl(cover)} alt={ds.name}
               sx={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
        ) : (
          <Box sx={{ width: "100%", aspectRatio: "1 / 1", display: "flex", alignItems: "center",
                     justifyContent: "center", bgcolor: "action.hover" }}>
            {clips.length ? <Movie fontSize="large" color="disabled" /> : (
              <Typography variant="h2" color="text.secondary">
                {ds.name.slice(0, 1).toUpperCase()}
              </Typography>
            )}
          </Box>
        )}
        <Box sx={{ p: 1.25 }}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="subtitle1" noWrap sx={{ flexGrow: 1 }}>{ds.name}</Typography>
            {ds.locked && !ds.archived_at && (
              <Tooltip title="Locked by hand"><Lock fontSize="small" color="action" /></Tooltip>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {itemCountLabel(ds.images)}
            {noAnchor && (
              <Tooltip title="No anchor: open the set and star the photo that is most clearly them">
                <Box component="span" sx={{ ml: 0.75, fontStyle: "italic", opacity: 0.8 }}>
                  · no anchor
                </Box>
              </Tooltip>
            )}
          </Typography>
          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
            {owner ? <Chip size="small" variant="outlined" label={owner} />
              : !isAssigned(ds) && <Chip size="small" color="warning" label="No owner" />}
            {sizes && sizes.small > 0 && (
              <Chip size="small" color="warning" variant="outlined" label={`${sizes.small} small`} />
            )}
            {ds.archived_at && <Chip size="small" label="Archived" />}
          </Stack>
          {runs.length > 0 && (
            <Tooltip title={runs.map(trainedByLabel).join(", ")}>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", mt: 0.5 }}>
                Trained {runs.map((r) => `v${r.version}${r.arch === "sdxl" ? " SDXL" : ""}`).join(", ")}
              </Typography>
            </Tooltip>
          )}
        </Box>
      </CardActionArea>
    </Card>
  );
}
