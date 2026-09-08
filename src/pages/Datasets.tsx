import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, LinearProgress,
  Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import {
  Add, Close, ContentCut, Delete, ModelTraining, Star, StarBorder, Upload,
} from "@mui/icons-material";

import {
  addDatasetImages, createDataset, cropDatasetFaces, deleteDataset, getFileUrl, listDatasets,
  removeDatasetImage, scoreDataset, setDatasetAnchor, updateDataset,
} from "../api/client";
import TrainLoraDialog from "../components/TrainLoraDialog";
import {
  byLikeness, byRecent, datasetNameProblem, datasetPrefix, formatCos, parseTags, removalWarning,
  verdictFor,
} from "../lib/datasets";
import { canTrain } from "../lib/trainingJob";
import type { Dataset, DatasetScore } from "../api/types";

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
          No datasets yet. A dataset is a named, tagged set of images you can train from — and
          re-open for a v2 without picking them all again.
        </Typography>
      )}

      <Stack spacing={2}>
        {datasets.map((ds) => (
          <DatasetCard
            key={ds.id}
            ds={ds}
            all={datasets}
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

function DatasetCard({
  ds, all, onChanged, onTrain,
}: { ds: Dataset; all: Dataset[]; onChanged: () => void; onTrain: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [tags, setTags] = useState(ds.tags ?? "");
  const [msg, setMsg] = useState("");
  const [cropOpen, setCropOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [scores, setScores] = useState<Record<string, DatasetScore>>({});
  const [worstFirst, setWorstFirst] = useState(false);
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
      setMsg(d || "scoring failed");
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
    // Scoring immediately is the point of picking one; a separate button to do it would be a
    // step nobody wants and would leave stale numbers on screen in the meantime.
    await score(uri);
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
      // No confirm. The object stays in S3 and in the Image Repo, so this is reversible by
      // re-adding it — and culling a crop set means doing this a dozen times in a row.
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
            startIcon={<ContentCut />}
            disabled={busy || ds.images.length === 0}
            onClick={() => setCropOpen(true)}
          >
            Crop faces
          </Button>
          {/* Only once an anchor exists — without one there is nothing to score against, and a
              button that always fails is worse than one that is not there. */}
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

        {/* Twelve by default — enough to recognise the set without turning the page into a
            gallery. It expands, because culling is the point: a crop of group photos comes back
            with people you did not mean, and you cannot remove what you cannot see. */}
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1.5 }}>
          {ordered.slice(0, showAll ? undefined : 12).map((uri) => {
            const sc = scores[uri];
            const verdict = verdictFor(sc ?? (uri === ds.anchor_uri
              ? { cos: 1, is_anchor: true } : undefined));
            const ring = {
              anchor: "primary.main", match: "success.main", below: "error.main",
              "no-face": "warning.main", unscored: "transparent",
            }[verdict];
            return (
              <Box key={uri} sx={{ position: "relative", width: 64 }}>
                <Box
                  component="img"
                  src={getFileUrl(uri)}
                  sx={{
                    width: 64, height: 64, objectFit: "cover", borderRadius: 1, display: "block",
                    border: "2px solid", borderColor: ring,
                  }}
                />
                {/* Always visible rather than hover-only: this page is used on a phone, where
                    there is no hover and a hidden control does not exist. */}
                <IconButton
                  size="small"
                  aria-label={`Remove ${uri.split("/").pop()}`}
                  disabled={busy}
                  onClick={() => remove(uri)}
                  sx={{
                    position: "absolute", top: -8, right: -8, p: 0.25,
                    bgcolor: "background.paper", boxShadow: 1,
                    "&:hover": { bgcolor: "error.main", color: "error.contrastText" },
                  }}
                >
                  <Close sx={{ fontSize: 14 }} />
                </IconButton>
                {/* Picking an anchor scores the set immediately — that is the whole reason to
                    pick one, and a separate button would leave stale numbers on screen. */}
                <Tooltip title={verdict === "anchor" ? "the anchor" : "use as anchor"}>
                  <IconButton
                    size="small"
                    aria-label={`Use ${uri.split("/").pop()} as the anchor`}
                    disabled={busy}
                    onClick={() => pickAnchor(uri)}
                    sx={{
                      position: "absolute", top: -8, left: -8, p: 0.25,
                      bgcolor: "background.paper", boxShadow: 1,
                      color: verdict === "anchor" ? "primary.main" : "text.disabled",
                    }}
                  >
                    {verdict === "anchor"
                      ? <Star sx={{ fontSize: 14 }} />
                      : <StarBorder sx={{ fontSize: 14 }} />}
                  </IconButton>
                </Tooltip>
                {(sc || verdict === "anchor") && (
                  <Typography
                    variant="caption"
                    align="center"
                    sx={{ display: "block", lineHeight: 1.4, color: `${ring}`, fontSize: 11 }}
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
        {removalWarning(ds.images.length) && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 0.5 }}>
            {removalWarning(ds.images.length)}
          </Typography>
        )}

        <CropDialog
          open={cropOpen}
          ds={ds}
          all={all}
          onClose={() => setCropOpen(false)}
          onDone={(created) => {
            setMsg(`created "${created.name}" — ${created.images.length} crops`);
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
          sx={{ mt: 1.5, width: 320 }}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Crop faces out of a dataset, optionally gated against a reference.
 *
 * The reference is the whole point of the dialog. Detection is easy; telling this character
 * from someone else in the same photo set is what hand-culling failed at twice, and without a
 * known-good set to score against, a cos number only says the crops resemble each other.
 */
function CropDialog({
  open, ds, all, onClose, onDone,
}: {
  open: boolean;
  ds: Dataset;
  all: Dataset[];
  onClose: () => void;
  onDone: (created: Dataset) => void;
}) {
  const [reference, setReference] = useState("");
  // Off by default now. Scoring a mixed set against its own mean is not a check -- the mean is
  // a blend of everyone in it -- so the API drops nothing without a real reference either way.
  // Culling happens afterwards, against an anchor, with the numbers on screen.
  const [gate, setGate] = useState(false);
  // Matches the API default. Keeping everything is the recoverable choice: an unwanted crop is
  // one click to remove, a missing one is a re-run.
  const [largestOnly, setLargestOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const others = all.filter((d) => d.id !== ds.id && d.images.length > 0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Crop faces from “{ds.name}”</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {/* A LABEL ON A BUTTON IS NOT PROGRESS. This runs for a minute or more -- detection is
              a second or two per image on CPU, and every image has to be fetched from S3 and
              posted to another host first -- and "Cropping…" on a disabled button is
              indistinguishable from a dialog that has wedged. */}
          {busy && (
            <Box>
              <LinearProgress />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                Detecting faces in {ds.images.length} images — a second or two each on CPU,
                plus fetching them, so up to a couple of minutes. This closes itself when the new
                dataset exists.
              </Typography>
            </Box>
          )}
          <Typography variant="body2" color="text.secondary">
            {largestOnly
              ? `Detects the largest face in each of the ${ds.images.length} images`
              : `Detects every face in all ${ds.images.length} images`}{" "}
            and writes the crops to a new dataset. The originals are left alone.
          </Typography>

          <FormControlLabel
            control={
              <Checkbox
                checked={!largestOnly}
                onChange={(e) => setLargestOnly(!e.target.checked)}
              />
            }
            label="Every face, not just the largest"
          />
          <Typography variant="caption" color="text.secondary">
            {largestOnly
              ? "One face per photo. In a group shot “largest” is only whoever stood closer to "
                + "the camera, and the other face is thrown away — untick this to keep both."
              : "Every face is kept, including people you did not mean. Remove them with the × "
                + "on each thumbnail; an unwanted crop is one click, a missing one is a re-run."}
          </Typography>
          {gate && !reference && (
            <Alert severity="info">
              Nothing will be dropped: there is no reference to score against. Crop, then star
              one crop as the anchor — every other one is scored against it and you remove what
              you do not want, with the numbers in front of you.
            </Alert>
          )}

          <TextField
            select
            SelectProps={{ native: true }}
            // A NATIVE SELECT ALWAYS SHOWS AN OPTION, so the label has nowhere to sit unshrunk.
            // MUI decides by looking at `value`, and "no reference" is the empty string -- so it
            // left the label full-size and painted "Score against" straight over "no reference
            // (weak check)". The two selects in LaunchRunPodDialog only escape this because
            // their values are never empty; explicit here and there, so it cannot come back.
            InputLabelProps={{ shrink: true }}
            label="Score against"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            helperText={
              reference
                ? "A crop scoring below 0.4 against this set is a different person, and is dropped."
                : "Without a reference the crops are scored against their own mean — that shows they resemble each other, not that they are the right person."
            }
            fullWidth
          >
            <option value="">no reference (weak check)</option>
            {others.map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.images.length})</option>
            ))}
          </TextField>

          <FormControlLabel
            control={<Checkbox checked={gate} onChange={(e) => setGate(e.target.checked)} />}
            label="Drop faces below the 0.4 same-person floor"
          />
          {!gate && (
            <Alert severity="warning">
              Hand-culling let two different people into this project&apos;s training sets, one
              of them into a set already culled by eye. The gate is what caught it.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const created = await cropDatasetFaces(ds.id, {
                referenceDatasetId: reference || undefined,
                gate,
                largestOnly,
              });
              onDone(created);
              onClose();
            } catch (e: unknown) {
              const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
              setError(d || "cropping failed");
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
