import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, LinearProgress,
  Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import {
  Add, Check, Close, ContentCut, Delete, Edit, ModelTraining, PhotoLibrary, Star, StarBorder,
  Upload,
} from "@mui/icons-material";

import {
  addDatasetImages, createDataset, cropDatasetFaces, deleteDataset, getFileUrl, listDatasets,
  removeDatasetImage, scoreDataset, setDatasetAnchor, updateDataset,
} from "../api/client";
import TrainLoraDialog from "../components/TrainLoraDialog";
import AddFromRepoDialog from "../components/AddFromRepoDialog";
import {
  byLikeness, byRecent, datasetNameProblem, formatCos, parseTags, removalWarning, verdictFor,
} from "../lib/datasets";
import { canTrain } from "../lib/trainingJob";
import type { Dataset, DatasetScore } from "../api/types";

/**
 * Named, taggable training datasets (wanly-api#277).
 *
 * The grouping that did not exist: before this, "these 27 images are p@y v2's training set"
 * could not be written down, so every run meant re-selecting by hand and a v2 meant doing it
 * again from memory. A dataset is training input only -- it is not a folder in the Image
 * Repo, and nothing here is connected to rendering (#464).
 */
export default function Datasets() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [trainFor, setTrainFor] = useState<Dataset | null>(null);
  const navigate = useNavigate();

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
          No datasets yet. A dataset is a named set of images to train a character LoRA from:
          add photos, crop the faces out, star one as the anchor to check the rest against it,
          then train.
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
      {trainFor && (
        <TrainLoraDialog
          imageKeys={trainFor.images}
          datasetId={trainFor.id}
          defaultCharacter={trainFor.name}
          onClose={() => setTrainFor(null)}
          onQueued={() => { setTrainFor(null); navigate("/training"); }}
        />
      )}
    </Box>
  );
}

/** Thumbnail size. Big enough to judge a face, and to give the two controls on each tile
 *  room -- at 64px the remove and anchor buttons of neighbouring tiles overlapped and a click
 *  landed on the wrong one (#464). */
const TILE = 128;

function DatasetCard({
  ds, onChanged, onTrain,
}: { ds: Dataset; onChanged: () => void; onTrain: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [tags, setTags] = useState(ds.tags ?? "");
  const [msg, setMsg] = useState("");
  const [cropOpen, setCropOpen] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [scores, setScores] = useState<Record<string, DatasetScore>>({});
  const [worstFirst, setWorstFirst] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(ds.name);
  const eligible = canTrain(ds.images);

  const score = async (anchor?: string) => {
    setBusy(true);
    setMsg("");
    try {
      const res = await scoreDataset(ds.id, anchor);
      setScores(Object.fromEntries(res.scores.map((x) => [x.uri, x])));
      const below = res.scores.filter((x) => !x.is_anchor && x.cos !== null
                                             && x.cos < res.cos_floor).length;
      const none = res.scores.filter((x) => x.cos === null).length;
      setMsg(`scored against the anchor — ${below} below ${res.cos_floor}`
             + (none ? `, ${none} with no face detected` : ""));
      setWorstFirst(true);
      onChanged();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setMsg(typeof d === "string" ? d : "scoring failed");
    } finally {
      setBusy(false);
    }
  };

  const pickAnchor = async (uri: string) => {
    setBusy(true);
    try {
      await setDatasetAnchor(ds.id, uri);
      onChanged();
    } finally {
      setBusy(false);
    }
    // Scoring immediately is the point of picking one.
    await score(uri);
  };

  const rename = async () => {
    const problem = datasetNameProblem(name);
    if (problem) { setMsg(problem); return; }
    if (name.trim() === ds.name) { setRenaming(false); return; }
    setBusy(true);
    setMsg("");
    try {
      await updateDataset(ds.id, { name: name.trim() });
      setRenaming(false);
      onChanged();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setMsg(typeof d === "string" ? d : "could not rename it");
    } finally {
      setBusy(false);
    }
  };

  // Worst first once a score exists, so a cull starts where the answer is obvious. Before
  // that, the set's own order, which is the order the trainer will stage them in.
  const ordered = worstFirst && Object.keys(scores).length
    ? [...ds.images].sort((a, b) =>
        byLikeness(scores[a] ?? { cos: null, is_anchor: false },
                   scores[b] ?? { cos: null, is_anchor: false }))
    : ds.images;

  const remove = async (uri: string) => {
    setBusy(true);
    setMsg("");
    try {
      // No confirm: culling a crop set means doing this a dozen times in a row, and the file
      // stays in the bucket.
      const updated = await removeDatasetImage(ds, uri);
      setMsg(`${updated.images.length} images in the set`);
      onChanged();
    } catch {
      setMsg("could not remove that image");
    } finally {
      setBusy(false);
    }
  };

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

  const shown = ordered.slice(0, showAll ? undefined : 12);

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1, flexWrap: "wrap" }}>
          {renaming ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <TextField
                size="small"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename();
                  if (e.key === "Escape") { setName(ds.name); setRenaming(false); }
                }}
                error={datasetNameProblem(name) !== null}
                autoFocus
                sx={{ width: 260 }}
              />
              <IconButton size="small" color="primary" onClick={rename} disabled={busy}>
                <Check fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => { setName(ds.name); setRenaming(false); }}>
                <Close fontSize="small" />
              </IconButton>
            </Box>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography variant="h6">{ds.name}</Typography>
              <Tooltip title="Rename">
                <IconButton size="small" onClick={() => setRenaming(true)} aria-label="Rename">
                  <Edit sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )}
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
            startIcon={<ContentCut />}
            disabled={busy || ds.images.length === 0}
            onClick={() => setCropOpen(true)}
          >
            Crop faces
          </Button>
          {ds.anchor_uri && (
            <Button size="small" startIcon={<Star />} disabled={busy} onClick={() => score()}>
              Re-score
            </Button>
          )}
          <Button
            size="small"
            startIcon={<Upload />}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Add images
          </Button>
          <Button
            size="small"
            startIcon={<PhotoLibrary />}
            disabled={busy}
            onClick={() => setRepoOpen(true)}
          >
            From repo
          </Button>
          <IconButton
            size="small"
            color="error"
            aria-label="Delete dataset"
            onClick={async () => {
              if (!confirm(`Delete dataset "${ds.name}" and its images?`)) return;
              await deleteDataset(ds.id, true);
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
        {!eligible.ok && ds.images.length > 0 && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block" }}>
            {eligible.reason}
          </Typography>
        )}
        {eligible.warning && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block" }}>
            {eligible.warning}
          </Typography>
        )}

        {/* Twelve by default; it expands, because culling is the point and you cannot remove
            what you cannot see. Each tile owns its two controls: remove top-right, anchor
            bottom-left, both INSIDE the tile, with a gap between tiles wider than a button. */}
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mt: 2 }}>
          {shown.map((uri) => {
            const sc = scores[uri];
            const verdict = verdictFor(sc ?? (uri === ds.anchor_uri
              ? { cos: 1, is_anchor: true } : undefined));
            const ring = {
              anchor: "primary.main", match: "success.main", below: "error.main",
              "no-face": "warning.main", unscored: "divider",
            }[verdict];
            return (
              <Box key={uri} sx={{ width: TILE }}>
                <Box sx={{ position: "relative", width: TILE, height: TILE }}>
                  <Box
                    component="img"
                    src={getFileUrl(uri)}
                    sx={{
                      width: TILE, height: TILE, objectFit: "cover", borderRadius: 1,
                      display: "block", border: "3px solid", borderColor: ring,
                    }}
                  />
                  <Tooltip title="Remove from the dataset">
                    <IconButton
                      size="small"
                      aria-label={`Remove ${uri.split("/").pop()}`}
                      disabled={busy}
                      onClick={() => remove(uri)}
                      sx={{
                        position: "absolute", top: 4, right: 4,
                        bgcolor: "rgba(255,255,255,0.9)", boxShadow: 1,
                        "&:hover": { bgcolor: "error.main", color: "error.contrastText" },
                      }}
                    >
                      <Close sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={verdict === "anchor" ? "The anchor" : "Use as the anchor"}>
                    <IconButton
                      size="small"
                      aria-label={`Use ${uri.split("/").pop()} as the anchor`}
                      disabled={busy}
                      onClick={() => pickAnchor(uri)}
                      sx={{
                        position: "absolute", bottom: 4, left: 4,
                        bgcolor: "rgba(255,255,255,0.9)", boxShadow: 1,
                        color: verdict === "anchor" ? "primary.main" : "text.secondary",
                      }}
                    >
                      {verdict === "anchor"
                        ? <Star sx={{ fontSize: 18 }} />
                        : <StarBorder sx={{ fontSize: 18 }} />}
                    </IconButton>
                  </Tooltip>
                </Box>
                {(sc || verdict === "anchor") && (
                  <Typography
                    variant="caption"
                    align="center"
                    sx={{ display: "block", lineHeight: 1.6, color: ring, fontSize: 12 }}
                  >
                    {verdict === "anchor" ? "anchor" : formatCos(sc?.cos ?? null)}
                  </Typography>
                )}
              </Box>
            );
          })}
          {ds.images.length > 12 && (
            <Button size="small" onClick={() => setShowAll((v) => !v)} sx={{ alignSelf: "center" }}>
              {showAll ? "show fewer" : `+${ds.images.length - 12} more`}
            </Button>
          )}
        </Box>
        {!ds.anchor_uri && ds.images.length > 1 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            Star one image to make it the anchor — every other image is then scored for likeness
            against it, worst first.
          </Typography>
        )}
        {removalWarning(ds.images.length) && ds.images.length > 0 && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 0.5 }}>
            {removalWarning(ds.images.length)}
          </Typography>
        )}

        {repoOpen && (
          <AddFromRepoDialog
            ds={ds}
            onClose={() => setRepoOpen(false)}
            onAdded={(updated) => {
              setMsg(`${updated.images.length} images in the set`);
              onChanged();
            }}
          />
        )}

        <CropDialog
          open={cropOpen}
          ds={ds}
          onClose={() => setCropOpen(false)}
          onDone={(updated) => {
            setScores({});
            setWorstFirst(false);
            setMsg(`${updated.images.length} faces — star one as the anchor to check the rest`);
            onChanged();
          }}
        />

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
          sx={{ mt: 2, width: 320 }}
        />
      </CardContent>
    </Card>
  );
}

/** Crop the faces out of every image in the set. One choice, one sentence. */
function CropDialog({
  open, ds, onClose, onDone,
}: {
  open: boolean;
  ds: Dataset;
  onClose: () => void;
  onDone: (updated: Dataset) => void;
}) {
  const [largestOnly, setLargestOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Crop faces</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {busy && (
            <Box>
              <LinearProgress />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                Detecting faces in {ds.images.length} images — up to a couple of minutes.
              </Typography>
            </Box>
          )}
          <Typography variant="body2">
            Replaces the {ds.images.length} images in “{ds.name}” with the faces cropped out of
            them. Remove any you do not want afterwards.
          </Typography>
          <FormControlLabel
            control={
              <Checkbox checked={largestOnly} onChange={(e) => setLargestOnly(e.target.checked)} />
            }
            label="Only the largest face in each image"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const updated = await cropDatasetFaces(ds.id, { largestOnly });
              onDone(updated);
              onClose();
            } catch (e: unknown) {
              const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
              setError(typeof d === "string" ? d : "cropping failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Cropping…" : "Crop"}
        </Button>
      </DialogActions>
    </Dialog>
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
            helperText={datasetNameProblem(name) ?? "The character it is of, usually."}
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
              setError(typeof d === "string" ? d : "could not create it");
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
