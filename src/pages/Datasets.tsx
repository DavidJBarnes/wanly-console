import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, LinearProgress, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import { Add, Delete, ModelTraining, Upload } from "@mui/icons-material";

import {
  addDatasetImages, createDataset, deleteDataset, getFileUrl, listDatasets, updateDataset,
} from "../api/client";
import TrainLoraDialog from "../components/TrainLoraDialog";
import { byRecent, datasetNameProblem, datasetPrefix, parseTags } from "../lib/datasets";
import { canTrain } from "../lib/trainingJob";
import type { Dataset } from "../api/types";

/**
 * Named, taggable training datasets (wanly-api#277).
 *
 * The grouping that did not exist: before this, "these 27 images are p@y v2's training set"
 * could not be written down, so every run meant re-selecting by hand and a v2 meant doing it
 * again from memory.
 */
export default function Datasets() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [trainFor, setTrainFor] = useState<Dataset | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setDatasets((await listDatasets()).sort(byRecent));
      setError("");
    } catch {
      setError("could not load datasets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, mb: 3 }}>
        <Typography variant="h4">Datasets</Typography>
        <Typography variant="body2" color="text.secondary">
          {datasets.length}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" startIcon={<Add />} onClick={() => setCreateOpen(true)}>
          New dataset
        </Button>
      </Box>

      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <CircularProgress size={22} />}
      {!loading && datasets.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No datasets yet. A dataset is a named, tagged set of images you can train from — and
          re-open for a v2 without picking them all again.
        </Typography>
      )}

      <Stack spacing={2}>
        {datasets.map((ds) => (
          <DatasetCard
            key={ds.id}
            ds={ds}
            onChanged={fetchAll}
            onTrain={() => setTrainFor(ds)}
          />
        ))}
      </Stack>

      <NewDatasetDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={fetchAll}
      />
      <TrainLoraDialog
        open={trainFor !== null}
        imageKeys={trainFor?.images ?? []}
        datasetId={trainFor?.id}
        defaultCharacter={trainFor?.name ?? ""}
        onClose={() => setTrainFor(null)}
        onQueued={() => setTrainFor(null)}
      />
    </Box>
  );
}

function DatasetCard({
  ds, onChanged, onTrain,
}: { ds: Dataset; onChanged: () => void; onTrain: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [tags, setTags] = useState(ds.tags ?? "");
  const [msg, setMsg] = useState("");
  const eligible = canTrain(ds.images);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMsg("");
    try {
      const updated = await addDatasetImages(ds.id, Array.from(files));
      setMsg(`${updated.images.length} images in the set`);
      onChanged();
    } catch {
      setMsg("upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
          <Typography variant="h6">{ds.name}</Typography>
          <Chip size="small" variant="outlined" label={`${ds.images.length} images`} />
          {parseTags(ds.tags).map((t) => (
            <Chip key={t} size="small" label={t} />
          ))}
          <Box sx={{ flexGrow: 1 }} />
          <Tooltip title={eligible.ok ? "" : eligible.reason ?? ""}>
            <span>
              <Button
                size="small"
                variant="contained"
                color="secondary"
                startIcon={<ModelTraining />}
                disabled={!eligible.ok}
                onClick={onTrain}
              >
                Train
              </Button>
            </span>
          </Tooltip>
          <Button
            size="small"
            startIcon={<Upload />}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Add images
          </Button>
          <IconButton
            size="small"
            color="error"
            onClick={async () => {
              if (!confirm(`Delete dataset "${ds.name}"? The images stay in the repo.`)) return;
              await deleteDataset(ds.id);
              onChanged();
            }}
          >
            <Delete fontSize="small" />
          </IconButton>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => upload(e.target.files)}
          />
        </Box>

        {busy && <LinearProgress sx={{ mb: 1 }} />}
        {msg && <Typography variant="caption" color="text.secondary">{msg}</Typography>}
        {!eligible.ok && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block" }}>
            {eligible.reason}
          </Typography>
        )}
        {eligible.warning && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block" }}>
            {eligible.warning}
          </Typography>
        )}

        {/* A strip of what is actually in the set. Twelve is enough to recognise it without
            turning the page into a gallery — the Image Repo is the gallery. */}
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1 }}>
          {ds.images.slice(0, 12).map((uri) => (
            <Box
              key={uri}
              component="img"
              src={getFileUrl(uri)}
              sx={{ width: 56, height: 56, objectFit: "cover", borderRadius: 1 }}
            />
          ))}
          {ds.images.length > 12 && (
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center", ml: 1 }}>
              +{ds.images.length - 12} more
            </Typography>
          )}
        </Box>

        <TextField
          size="small"
          label="Tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          onBlur={async () => {
            if (tags !== (ds.tags ?? "")) {
              await updateDataset(ds.id, { tags });
              onChanged();
            }
          }}
          placeholder="character, faces, curated"
          sx={{ mt: 1.5, width: 320 }}
        />
      </CardContent>
    </Card>
  );
}

function NewDatasetDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New dataset</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={name.trim() !== "" && datasetNameProblem(name) !== null}
            helperText={
              datasetNameProblem(name) ??
              `Its images will live in ${datasetPrefix(name || "name")}/`
            }
            autoFocus
            fullWidth
          />
          <TextField
            label="Tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="character, faces, curated"
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={datasetNameProblem(name) !== null || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await createDataset({ name: name.trim(), tags: tags.trim() || null });
              setName("");
              setTags("");
              onCreated();
              onClose();
            } catch (e: unknown) {
              const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
              setError(d || "could not create it");
            } finally {
              setBusy(false);
            }
          }}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
