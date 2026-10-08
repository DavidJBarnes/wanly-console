import { useCallback, useEffect, useRef, useState } from "react";
import CharacterAvatar from "../components/CharacterAvatar";
import { offeredCharacters } from "../lib/characterIcon";
import { useNavigate, useSearchParams } from "react-router";
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, IconButton,
  LinearProgress, MenuItem, Radio, RadioGroup, Stack, Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import {
  Add, Archive, AutoAwesome, Check, Close, ContentCopy, ContentCut, Delete, Edit, Face, Lock, LockOpen,
  Unarchive,
  ModelTraining, Movie, PhotoLibrary, Star, StarBorder, Upload, WarningAmber,
} from "@mui/icons-material";

import {
  addDatasetImages, captionDataset, cloneDataset, createDataset, cropDatasetFaces, deleteDataset,
  getCaptionStatus, getFileUrl, getRegularizeStatus, listDatasets, lockDataset, regularizeDataset,
  archiveDataset, removeDatasetImage, scoreDataset, setDatasetAnchor, unarchiveDataset,
  unlockDataset, updateDataset, updateDatasetCaption,
} from "../api/client";
import type { CropFraming } from "../api/client";
import { listRecipes } from "../api/ltx";
import type { Character } from "../api/ltx";
import TrainLoraDialog from "../components/TrainLoraDialog";
import AddFromRepoDialog from "../components/AddFromRepoDialog";
import NewCharacterDialog from "../components/NewCharacterDialog";
import ImageEditDialog from "../components/ImageEditDialog";
import CaptionStatusChip from "../components/CaptionStatusChip";
import { useBackgroundStatus } from "../hooks/useBackgroundStatus";
import {
  byLikeness, byRecent, canLockByHand, canUnlock, captionCoverage, captionProgressLabel,
  cropSelectionProblem, datasetNameProblem, defaultCloneName, formatCos, isAssigned, isClip,
  itemCountLabel, splitClips,
  lockedReason, lockLabel, lockReasonBody, ownerLabel, parseTags, progressPct, regularizeProgressLabel, removalWarning, scoreFor,
  trainedByLabel, trainedLabel, unlockedLabel, usedInLabel, verdictFor,
} from "../lib/datasets";
import { apiErrorText, canTrain, isPairCharacter } from "../lib/trainingJob";
import type { Dataset, DatasetKind, DatasetScore, RegClass } from "../api/types";

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
  // The registry, for the owner picker: a set is owned by a registered character (#537).
  const [characters, setCharacters] = useState<Character[]>([]);
  const navigate = useNavigate();
  // A character card links here as /datasets?dataset=<id> (migration 099): scroll to and
  // accent that dataset. Unknown ids simply no-op.
  const [searchParams, setSearchParams] = useSearchParams();
  const askedDataset = searchParams.get("dataset");
  const matchedRef = useRef<HTMLDivElement>(null);

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

  const fetchCharacters = useCallback(() => {
    listRecipes().then((b) => setCharacters(b.characters)).catch(() => {});
  }, []);

  useEffect(() => { fetchAll(); fetchCharacters(); }, [fetchAll, fetchCharacters]);

  useEffect(() => {
    if (askedDataset && matchedRef.current) {
      matchedRef.current.scrollIntoView({ block: "center" });
    }
  }, [askedDataset, loading]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, mb: 3 }}>
        <Typography variant="h4">Datasets</Typography>
        <Typography variant="body2" color="text.secondary">
          {datasets.length}
        </Typography>
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

      <Stack spacing={2}>
        {datasets.map((ds) => (
          <Box
            key={ds.id}
            ref={ds.id === askedDataset ? matchedRef : undefined}
            sx={{ scrollMarginTop: 80 }}
          >
            <DatasetCard
              ds={ds}
              characters={characters}
              onChanged={fetchAll}
              onCharactersChanged={fetchCharacters}
              onTrain={() => setTrainFor(ds)}
              onCloned={async (copy) => {
                // Re-read first, so the copy's card exists when the accent lands on it.
                await fetchAll();
                setSearchParams({ dataset: copy.id });
              }}
              highlighted={ds.id === askedDataset}
            />
          </Box>
        ))}
      </Stack>

      <NewDatasetDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={fetchAll}
      />
      {trainFor && (
        <TrainLoraDialog
          dataset={trainFor}
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

/**
 * A clip's tile (#625): its first frame at rest, playing on hover. Muted so the browser lets it
 * start without a gesture (the stored clips have no audio anyway), and `preload="metadata"` so
 * a set of twenty clips does not pull twenty videos just to draw the grid.
 */
function ClipThumb({ src, ring }: { src: string; ring: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <Box
      component="video"
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      preload="metadata"
      onMouseEnter={() => { ref.current?.play().catch(() => {}); }}
      onMouseLeave={() => {
        const v = ref.current;
        if (!v) return;
        v.pause();
        v.currentTime = 0;
      }}
      sx={{
        width: TILE, height: TILE, objectFit: "cover", borderRadius: 1,
        display: "block", border: "3px solid", borderColor: ring, bgcolor: "black",
      }}
    />
  );
}

function DatasetCard({
  ds, characters, onChanged, onCharactersChanged, onTrain, onCloned, highlighted = false,
}: {
  ds: Dataset;
  characters: Character[];
  onChanged: () => void;
  onCharactersChanged: () => void;
  onTrain: () => void;
  onCloned: (copy: Dataset) => void;
  highlighted?: boolean;
}) {
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
  const [assignOpen, setAssignOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  // The Image Edit tool (#547) on one of this set's images. Offered on a locked set too:
  // "Save as new image" writes to the repo and never touches the set; only "Save to" is off.
  const [editUri, setEditUri] = useState<string | null>(null);
  const [generateCount, setGenerateCount] = useState(150);
  // Clips (#625) sit in `images` beside the stills. The training floor, the removal warning
  // and the crop are about the stills alone; clips train in a group of their own.
  const eligible = canTrain(ds.images);
  const { stills } = splitClips(ds.images);
  const isReg = ds.kind === "regularization";
  const assigned = isAssigned(ds);
  const owner = ownerLabel(ds);
  const coverage = captionCoverage(ds);
  // Read-only only when locked by hand (wanly-api#358) or archived (#419): everything that
  // changes what it trains on is off, with this as the reason. Training locks nothing any more
  // (#420) -- each run keeps its own record of what it trained on.
  const locked = lockedReason(ds);
  const unlocked = unlockedLabel(ds);
  const trained = trainedLabel(ds);

  // Background runs on the server (#537). Both re-read the set when they finish, so the
  // captions or frames they wrote show up without a reload.
  const captioning = useBackgroundStatus(() => getCaptionStatus(ds.id), onChanged);
  const rendering = useBackgroundStatus(
    () => getRegularizeStatus(ds.id), onChanged, isReg);
  const captionRunning = Boolean(captioning.status?.running);
  const renderRunning = isReg && Boolean(rendering.status?.running);

  const caption = async (overwrite: boolean) => {
    if (overwrite && !confirm(
      `Recaption every image in "${ds.name}"? This replaces all ${coverage.captioned} `
      + "existing captions, including any you edited by hand.")) return;
    setMsg("");
    try {
      await captionDataset(ds.id, overwrite);
      captioning.kick();
    } catch (e: unknown) {
      setMsg(apiErrorText(e, "could not start captioning"));
    }
  };

  const generate = async () => {
    setMsg("");
    try {
      await regularizeDataset(ds.id, generateCount);
      rendering.kick();
    } catch (e: unknown) {
      setMsg(apiErrorText(e, "could not start rendering"));
    }
  };

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
  // Scores come from this page's last scoring, else the ones the API saved with the set.
  const scoreOf = (uri: string) => scoreFor(ds, uri, scores);
  const ordered = worstFirst
    ? [...ds.images].sort((a, b) =>
        byLikeness(scoreOf(a) ?? { cos: null, is_anchor: false },
                   scoreOf(b) ?? { cos: null, is_anchor: false }))
    : ds.images;

  const remove = async (uri: string) => {
    setBusy(true);
    setMsg("");
    try {
      // No confirm: culling a crop set means doing this a dozen times in a row, and the file
      // stays in the bucket.
      const updated = await removeDatasetImage(ds, uri);
      setMsg(`${itemCountLabel(updated.images)} in the set`);
      onChanged();
    } catch (e: unknown) {
      // A 409 means another tab's run locked it since this page loaded: say so, and re-read
      // so the lock shows.
      setMsg(apiErrorText(e, "could not remove that image"));
      onChanged();
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
      setMsg(`${itemCountLabel(updated.images)} in the set`);
      onChanged();
    } catch (e: unknown) {
      setMsg(apiErrorText(e, "upload failed"));
      onChanged();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const clone = async () => {
    const asked = prompt(`Name for the copy of "${ds.name}"`, defaultCloneName(ds.name));
    if (asked === null) return;
    const problem = datasetNameProblem(asked);
    if (problem) { setMsg(`not cloned: ${problem}`); return; }
    setBusy(true);
    setMsg("");
    try {
      onCloned(await cloneDataset(ds.id, asked.trim()));
    } catch (e: unknown) {
      setMsg(apiErrorText(e, "could not clone it"));
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async () => {
    setBusy(true);
    setMsg("");
    try {
      if (ds.archived_at) await unarchiveDataset(ds.id);
      else await archiveDataset(ds.id);
    } catch (e: unknown) {
      setMsg(apiErrorText(e, ds.archived_at ? "could not unarchive it" : "could not archive it"));
    } finally {
      setBusy(false);
    }
    onChanged();
  };

  const removeSet = async () => {
    if (!confirm(`Delete dataset "${ds.name}" and its images?`)) return;
    setMsg("");
    try {
      await deleteDataset(ds.id, true);
    } catch (e: unknown) {
      setMsg(apiErrorText(e, "could not delete it"));
    }
    onChanged();
  };

  const shown = ordered.slice(0, showAll ? undefined : 12);

  return (
    <Card variant={highlighted ? "outlined" : "elevation"}
      sx={highlighted ? { border: 2, borderColor: "primary.main" } : undefined}>
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
          <Chip size="small" variant="outlined" label={itemCountLabel(ds.images)} />
          {locked && (
            <Tooltip title={locked}>
              <Chip size="small" color="default" icon={ds.archived_at ? <Archive /> : <Lock />}
                    label={lockLabel(ds)} />
            </Tooltip>
          )}
          {/* Which runs this set fed (wanly-api#419). Information, not a lock: each run keeps
              its own record of what it trained on -- Training page, "Trained on". */}
          {trained && (
            <Tooltip title={`${trained}. Each run keeps its own record of the images it trained on, so this set stays editable.`}>
              <Chip size="small" variant="outlined" icon={<ModelTraining />}
                    label={`Trained ${ds.trained_by!.length} run${ds.trained_by!.length === 1 ? "" : "s"}`} />
            </Tooltip>
          )}
          {unlocked && (
            <Tooltip title="Unlocked by hand: editable until it is locked again">
              <Chip size="small" variant="outlined" icon={<LockOpen />} label={unlocked} />
            </Tooltip>
          )}
          {/* What the set is for and whose it is. Unassigned is loud on purpose: training
              refuses it, and it is how another person's images got into a LoRA. */}
          <Tooltip title={locked ?? ""}>
            {assigned ? (
              <Chip
                size="small"
                color={isReg ? "info" : "primary"}
                label={owner}
                icon={locked ? undefined : <Edit />}
                onClick={locked ? undefined : () => setAssignOpen(true)}
              />
            ) : (
              <Chip
                size="small"
                color="warning"
                icon={<WarningAmber />}
                label={owner ? `${owner} — incomplete` : "Unassigned — say whose this is"}
                onClick={locked ? undefined : () => setAssignOpen(true)}
              />
            )}
          </Tooltip>
          {ds.images.length > 0 && (
            // A blank caption is the standard, not a gap (wanly-api#365): it trains as the bare
            // "<trigger>, <gender>". Typed captions are for props only, so "bare" is neutral.
            <Tooltip title="Blank captions train as the bare trigger + class — the standard. Type a caption only for props (wearing glasses, holding a phone); never describe the person.">
              <Chip
                size="small"
                variant="outlined"
                label={coverage.missing === ds.images.length
                  ? "bare captions"
                  : `${ds.images.length - coverage.missing} with props · ${coverage.missing} bare`}
              />
            </Tooltip>
          )}
          {parseTags(ds.tags).map((t) => (
            <Chip key={t} size="small" label={t} />
          ))}
          <Box sx={{ flexGrow: 1 }} />
          {/* A regularization pool is never trained on its own: the API adds it to runs. */}
          {!isReg && (
            <Tooltip title={!assigned ? "Say whose this set is first" : eligible.ok ? "" : eligible.reason ?? ""}>
              <span>
                <Button
                  size="small"
                  variant="contained"
                  color="secondary"
                  startIcon={<ModelTraining />}
                  disabled={!eligible.ok || !assigned}
                  onClick={onTrain}
                >
                  Train
                </Button>
              </span>
            </Tooltip>
          )}
          <Tooltip title="Make a separate copy of this set — same images, captions, scores and owner. Not needed to change a trained set: it stays editable, and each run records what it trained on">
            <span>
              <Button size="small" startIcon={<ContentCopy />} disabled={busy} onClick={clone}>
                Clone
              </Button>
            </span>
          </Tooltip>
          {/* Hand lock (wanly-api#358): optional, off by default. Training never locks a set
              (#420); this is for one to keep exactly as it is. Unlock lifts it. */}
          {canLockByHand(ds) && (
            <Tooltip title="Optional: freeze this set as it is. Unlock it to change it later">
              <span>
                <Button size="small" startIcon={<Lock />} disabled={busy} onClick={() => setLockOpen(true)}>
                  Lock
                </Button>
              </span>
            </Tooltip>
          )}
          {canUnlock(ds) && (
            <Tooltip title="Lift the hand lock: make this set editable again">
              <span>
                <Button size="small" startIcon={<LockOpen />} disabled={busy} onClick={() => setUnlockOpen(true)}>
                  Unlock
                </Button>
              </span>
            </Tooltip>
          )}
          {/* Archive (wanly-api#419): hide an old version set without deleting it. Its runs
              keep linking to it. */}
          <Tooltip title={ds.archived_at
            ? "Bring this set back into the lists and pickers, editable again"
            : "Hide this set from the lists and pickers. Nothing is deleted; runs that trained on it keep their record"}>
            <span>
              <Button size="small" startIcon={ds.archived_at ? <Unarchive /> : <Archive />}
                      disabled={busy} onClick={toggleArchive}>
                {ds.archived_at ? "Unarchive" : "Archive"}
              </Button>
            </span>
          </Tooltip>
          {isReg ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <TextField
                size="small"
                type="number"
                value={generateCount}
                onChange={(e) => setGenerateCount(Math.max(1, parseInt(e.target.value) || 1))}
                slotProps={{ htmlInput: { min: 1, "aria-label": "How many to generate" } }}
                sx={{ width: 84 }}
              />
              <Tooltip title={locked ?? (ds.reg_class
                ? `Render ${generateCount} generic ${ds.reg_class} clips with no character LoRA; `
                  + "each one's last frame lands in this set. GPU-hours for a full pool."
                : "Pick the class (woman or man) first")}>
                <span>
                  <Button
                    size="small"
                    startIcon={<Movie />}
                    disabled={busy || renderRunning || !ds.reg_class || Boolean(locked)}
                    onClick={generate}
                  >
                    Generate {generateCount}
                  </Button>
                </span>
              </Tooltip>
            </Box>
          ) : (
            <Tooltip title={locked ?? ""}>
              <span>
                <Button
                  size="small"
                  startIcon={<ContentCut />}
                  disabled={busy || ds.images.length === 0 || Boolean(locked)}
                  onClick={() => setCropOpen(true)}
                >
                  Crop faces
                </Button>
              </span>
            </Tooltip>
          )}
          <Tooltip title={locked ?? ("Describe framing, pose, clothing, light and background for every image "
            + "without a caption. Never the face: the trigger carries identity.")}>
            <span>
              <Button
                size="small"
                startIcon={<AutoAwesome />}
                disabled={busy || captionRunning || ds.images.length === 0 || Boolean(locked)}
                onClick={() => caption(false)}
              >
                Caption all
              </Button>
            </span>
          </Tooltip>
          {coverage.captioned > 0 && (
            <Tooltip title={locked ?? ""}>
              <span>
                <Button
                  size="small"
                  color="inherit"
                  disabled={busy || captionRunning || Boolean(locked)}
                  onClick={() => caption(true)}
                >
                  Recaption…
                </Button>
              </span>
            </Tooltip>
          )}
          {!isReg && ds.anchor_uri && (
            <Button size="small" startIcon={<Star />} disabled={busy} onClick={() => score()}>
              Re-score
            </Button>
          )}
          <Tooltip title={locked ?? "Photos, or short video clips (2-10 s) of the face in motion for an LTX LoRA"}>
            <span>
              <Button
                size="small"
                startIcon={<Upload />}
                disabled={busy || Boolean(locked)}
                onClick={() => fileRef.current?.click()}
              >
                Add images or clips
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={locked ?? ""}>
            <span>
              <Button
                size="small"
                startIcon={<PhotoLibrary />}
                disabled={busy || Boolean(locked)}
                onClick={() => setRepoOpen(true)}
              >
                From repo
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={locked ?? "Delete dataset"}>
            <span>
              <IconButton
                size="small"
                color="error"
                aria-label="Delete dataset"
                disabled={Boolean(locked)}
                onClick={removeSet}
              >
                <Delete fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <input
            ref={fileRef}
            type="file"
            // Clips (#625): the API normalizes any of these to a silent 25 fps .mp4, and refuses
            // one under 2 s with a reason the upload's error path shows as is.
            accept="image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
            multiple
            hidden
            onChange={(e) => upload(e.target.files)}
          />
        </Box>

        {busy && <LinearProgress sx={{ mb: 1 }} />}
        {[
          { label: captionProgressLabel(captioning.status), s: captioning.status,
            done: captioning.status?.captioned ?? 0, total: captioning.status?.total ?? 0 },
          { label: isReg ? regularizeProgressLabel(rendering.status) : null,
            s: rendering.status,
            done: (rendering.status?.done ?? 0) + (rendering.status?.failed ?? 0),
            total: rendering.status?.requested ?? 0 },
        ].filter((p) => p.label).map((p) => {
          const pct = p.s?.running ? progressPct(p.done, p.total) : null;
          return (
            <Box key={p.label} sx={{ mb: 1 }}>
              {pct !== null && <LinearProgress variant="determinate" value={pct} />}
              <Typography variant="caption"
                color={p.s?.running ? "text.secondary" : "error.main"}>
                {p.label}
              </Typography>
            </Box>
          );
        })}
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
            const sc = scoreOf(uri);
            const verdict = verdictFor(sc);
            const ring = {
              anchor: "primary.main", match: "success.main", below: "error.main",
              "no-face": "warning.main", unscored: "divider",
            }[verdict];
            const clip = isClip(uri);
            return (
              <Box key={uri} sx={{ width: TILE }}>
                <Box sx={{ position: "relative", width: TILE, height: TILE }}>
                  {/* A link, not an onClick: middle-click and "open in new tab" work too, and the
                      tile's own buttons (remove, anchor) sit above it and keep their clicks. */}
                  <Box
                    component="a"
                    href={getFileUrl(uri)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open full size in a new tab"
                    sx={{ display: "block", cursor: "zoom-in" }}
                  >
                    {clip ? <ClipThumb src={getFileUrl(uri)} ring={ring} /> : (
                      <Box
                        component="img"
                        src={getFileUrl(uri)}
                        sx={{
                          width: TILE, height: TILE, objectFit: "cover", borderRadius: 1,
                          display: "block", border: "3px solid", borderColor: ring,
                        }}
                      />
                    )}
                  </Box>
                  {/* The span carries the position so a disabled button still shows its reason. */}
                  <Tooltip title={locked ?? "Remove from the dataset"}>
                    <Box component="span" sx={{ position: "absolute", top: 4, right: 4 }}>
                      <IconButton
                        size="small"
                        aria-label={`Remove ${uri.split("/").pop()}`}
                        disabled={busy || Boolean(locked)}
                        onClick={() => remove(uri)}
                        sx={{
                          bgcolor: "rgba(255,255,255,0.9)", boxShadow: 1,
                          "&:hover": { bgcolor: "error.main", color: "error.contrastText" },
                          "&.Mui-disabled": { bgcolor: "rgba(255,255,255,0.6)" },
                        }}
                      >
                        <Close sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Box>
                  </Tooltip>
                  {/* Which runs trained on this image (wanly-api#422). Removing it from the set
                      changes none of them: each run keeps its own record. */}
                  {usedInLabel(ds.used_in?.[uri]) && (
                    <Tooltip title={`Used in ${(ds.used_in?.[uri] ?? []).map(trainedByLabel).join(", ")}`}>
                      <Chip
                        size="small"
                        icon={<ModelTraining sx={{ fontSize: 14 }} />}
                        label={usedInLabel(ds.used_in?.[uri])}
                        sx={{
                          position: "absolute", bottom: 6, right: 4, height: 22, maxWidth: TILE - 8,
                          bgcolor: "rgba(255,255,255,0.9)", boxShadow: 1,
                        }}
                      />
                    </Tooltip>
                  )}
                  {/* Image Edit and the anchor star are for stills: the editor takes one frame,
                      and the anchor is what every clip's frames are scored against. */}
                  {clip ? (
                    <Chip
                      size="small"
                      icon={<Movie sx={{ fontSize: 14 }} />}
                      label="clip"
                      sx={{
                        position: "absolute", top: 6, left: 4, height: 22,
                        bgcolor: "rgba(255,255,255,0.9)", boxShadow: 1, pointerEvents: "none",
                      }}
                    />
                  ) : <Tooltip title="Edit: expression, gaze, small head turns — saves a new image">
                    <IconButton
                      size="small"
                      aria-label={`Edit ${uri.split("/").pop()}`}
                      disabled={busy}
                      onClick={() => setEditUri(uri)}
                      sx={{
                        position: "absolute", top: 4, left: 4,
                        bgcolor: "rgba(255,255,255,0.9)", boxShadow: 1, color: "text.secondary",
                        "&:hover": { bgcolor: "primary.main", color: "primary.contrastText" },
                      }}
                    >
                      <Face sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>}
                  {/* Where this image's caption is (console#564): its description, a held
                      job's, or this set's training caption while it is in line. */}
                  <CaptionStatusChip path={uri} overlay corner="right" includeDatasetCaptions />
                  {!isReg && !clip && <Tooltip title={verdict === "anchor" ? "The anchor" : "Use as the anchor"}>
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
                  </Tooltip>}
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
                <CaptionField
                  datasetId={ds.id}
                  uri={uri}
                  caption={ds.captions?.[uri] ?? ""}
                  disabled={captionRunning}
                  locked={locked}
                  onSaved={onChanged}
                />
              </Box>
            );
          })}
          {ds.images.length > 12 && (
            <Button size="small" onClick={() => setShowAll((v) => !v)} sx={{ alignSelf: "center" }}>
              {showAll ? "show fewer" : `+${ds.images.length - 12} more`}
            </Button>
          )}
        </Box>
        {!isReg && !ds.anchor_uri && ds.images.length > 1 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            Star one image to make it the anchor — every other image is then scored for likeness
            against it, worst first.
          </Typography>
        )}
        {removalWarning(stills.length) && stills.length > 0 && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 0.5 }}>
            {removalWarning(stills.length)}
          </Typography>
        )}

        {assignOpen && (
          <AssignDialog
            ds={ds}
            characters={characters}
            onClose={() => setAssignOpen(false)}
            onSaved={() => { setAssignOpen(false); onChanged(); }}
            onCharactersChanged={onCharactersChanged}
          />
        )}

        <ImageEditDialog
          open={editUri !== null}
          sourceUri={editUri}
          dataset={ds}
          onClose={() => setEditUri(null)}
          // Saved into this set: re-read it so the new tile shows. Saved to the repo: nothing
          // here changed.
          onSaved={(r) => { if (r.dataset_id) onChanged(); }}
        />

        {lockOpen && (
          <LockDialog
            ds={ds}
            onClose={() => setLockOpen(false)}
            onLocked={() => { setLockOpen(false); setMsg("locked"); onChanged(); }}
          />
        )}

        {unlockOpen && (
          <UnlockDialog
            ds={ds}
            onClose={() => setUnlockOpen(false)}
            onUnlocked={() => { setUnlockOpen(false); setMsg("unlocked"); onChanged(); }}
          />
        )}

        {repoOpen && (
          <AddFromRepoDialog
            ds={ds}
            onClose={() => setRepoOpen(false)}
            onAdded={(updated) => {
              setMsg(`${itemCountLabel(updated.images)} in the set`);
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
              try {
                await updateDataset(ds.id, { tags });
              } catch (e: unknown) {
                setMsg(apiErrorText(e, "tags not saved"));
              }
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

/** Crop the faces out of the selected images — every one of them unless a subset is picked.
 *  One choice for what happens to the output, made once for the whole batch: replace the
 *  cropped photographs with their faces, or keep the set and add the crops (Save / Save As).
 *  The cropped images themselves are chosen per image, below. */
function CropDialog({
  open, ds, onClose, onDone,
}: {
  open: boolean;
  ds: Dataset;
  onClose: () => void;
  onDone: (updated: Dataset) => void;
}) {
  const [largestOnly, setLargestOnly] = useState(false);
  const [saveAs, setSaveAs] = useState(false);
  const [framing, setFraming] = useState<CropFraming>("face");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Reopening the dialog restarts the selection: a stale one from last time would crop
  // images the user removed since, silently and with no way to see it.
  useEffect(() => {
    if (open) setSelected(new Set());
  }, [open]);

  const toggled = (uri: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  };

  const problem = cropSelectionProblem(selected);
  // Clips are skipped by the crop (#625), so they are neither counted nor offered here.
  const { stills } = splitClips(ds.images);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Crop faces</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {busy && (
            <Box>
              <LinearProgress />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                Detecting faces in {selected.size || stills.length} images — up to a couple of
                minutes.
              </Typography>
            </Box>
          )}
          <Typography variant="body2">
            {selected.size > 0
              ? `Crops ${selected.size} of ${stills.length} — the rest are left alone.`
              : `Crops every image in “${ds.name}” (${stills.length}). Pick images below to crop only those.`
                + (stills.length < ds.images.length ? " Clips are left as they are." : "")}
          </Typography>
          <RadioGroup
            value={framing}
            onChange={(e) => setFraming(e.target.value as CropFraming)}
          >
            <FormControlLabel
              value="face"
              control={<Radio size="small" />}
              label={
                <Box>
                  <Typography variant="body2">Tight face</Typography>
                  <Typography variant="caption" color="text.secondary">
                    A square around the face, with a little hair and chin.
                  </Typography>
                </Box>
              }
            />
            <FormControlLabel
              value="head_shoulders"
              control={<Radio size="small" />}
              label={
                <Box>
                  <Typography variant="body2">Head and shoulders</Typography>
                  <Typography variant="caption" color="text.secondary">
                    A portrait from just above the hairline down to the collarbone and upper
                    chest.
                  </Typography>
                </Box>
              }
            />
          </RadioGroup>
          {stills.length > 0 && (
            <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
              {stills.map((uri) => {
                const picked = selected.has(uri);
                return (
                  <Box
                    key={uri}
                    component="img"
                    src={getFileUrl(uri)}
                    onClick={() => toggled(uri)}
                    sx={{
                      width: 72, height: 72, objectFit: "cover", borderRadius: 1,
                      cursor: "pointer", display: "block",
                      border: "3px solid", borderColor: picked ? "secondary.main" : "divider",
                      opacity: picked ? 1 : 0.55,
                    }}
                  />
                );
              })}
            </Box>
          )}
          <FormControlLabel
            control={
              <Checkbox checked={largestOnly} onChange={(e) => setLargestOnly(e.target.checked)} />
            }
            label="Only the largest face in each image"
          />
          <FormControlLabel
            control={<Checkbox checked={saveAs} onChange={(e) => setSaveAs(e.target.checked)} />}
            label="Keep the photographs and add the crops (save as)"
          />
          {!saveAs && (
            <Typography variant="caption" color="text.secondary">
              Otherwise the cropped photographs are replaced by their crops. The originals stay
              in the bucket either way.
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Tooltip title={problem ?? ""}>
          <span>
            <Button
              variant="contained"
              disabled={busy || problem !== null}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const updated = await cropDatasetFaces(ds.id, {
                    largestOnly,
                    saveAs,
                    framing,
                    // Only send a selection when the user made one: an empty set means every
                    // image, and sending an empty list means none of them.
                    ...(selected.size > 0 ? { uris: [...selected] } : {}),
                  });
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
          </span>
        </Tooltip>
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

/**
 * One image's caption BODY, under its tile, edited in place (#537). Saved on blur.
 *
 * No trigger in it, ever: the run adds "<trigger>, <gender>, " itself, so the caption says
 * only what is in the frame — framing, pose, clothing, light — and the face is left to the
 * trigger. That is the difference between a LoRA that learns the person and one that learns
 * the person in that jacket against that wall.
 */
function CaptionField({
  datasetId, uri, caption, disabled, locked = null, onSaved,
}: {
  datasetId: string;
  uri: string;
  caption: string;
  disabled: boolean;
  /** Why the set cannot be edited (hand lock or archived), or null. Shown instead of the caption on
   *  hover, since hovering is how you would find out why a click did nothing. */
  locked?: string | null;
  onSaved: () => void;
}) {
  const readOnly = disabled || Boolean(locked);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(caption);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setEditing(false);
    if (text.trim() === caption.trim()) return;
    setSaving(true);
    setError("");
    try {
      await updateDatasetCaption(datasetId, uri, text.trim());
      onSaved();
    } catch (e: unknown) {
      setError(apiErrorText(e, "not saved"));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <TextField
        size="small"
        multiline
        minRows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setText(caption); setEditing(false); }
        }}
        autoFocus
        fullWidth
        slotProps={{ htmlInput: { style: { fontSize: 11, lineHeight: 1.35 } } }}
        sx={{ mt: 0.5 }}
      />
    );
  }
  return (
    <Tooltip title={locked ? `${caption ? caption + " — " : ""}${locked}` : caption || ""}
      placement="bottom-start">
      <Typography
        variant="caption"
        component="div"
        onClick={() => { if (!readOnly) { setText(caption); setEditing(true); } }}
        sx={{
          mt: 0.5, fontSize: 11, lineHeight: 1.35, cursor: readOnly ? "default" : "text",
          color: error ? "error.main" : caption ? "text.secondary" : "text.disabled",
          display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
          overflow: "hidden", opacity: saving ? 0.5 : 1,
        }}
      >
        {error || caption || (locked ? "bare (trigger + class)" : "bare — click to add a prop")}
      </Typography>
    </Tooltip>
  );
}

/**
 * Say what a set is for and whose it is (#537).
 *
 * A character set is owned by one registered character — picked from the registry, not typed,
 * so it cannot be owned by a misspelling. A composition set is owned by a PAIR, which may not
 * be a row yet (a pair's row is created by its first run), so that name is typed, with the
 * pairs that exist offered. A regularization pool has a class instead of an owner.
 *
 * The API refuses a change while a running job uses the set; its message is shown as is.
 */
/** Confirm a hand lock (wanly-api#358): optional, for a set to keep exactly as it is. Unlock
 *  lifts it. Training never locks a set (wanly-api#420). */
function LockDialog({
  ds, onClose, onLocked,
}: {
  ds: Dataset;
  onClose: () => void;
  onLocked: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const lock = async () => {
    setBusy(true);
    setError("");
    try {
      await lockDataset(ds.id, lockReasonBody(reason));
      onLocked();
    } catch (e: unknown) {
      setError(apiErrorText(e, "could not lock it"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Lock “{ds.name}”?</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2">
            Its images, crops, captions and owner can no longer be changed, and it cannot be
            deleted, until you unlock it. Optional: a set that trained stays editable without
            this, because each run keeps its own record of what it trained on.
          </Typography>
          <TextField
            size="small"
            label="Reason (optional)"
            placeholder="final v5 set"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) lock(); }}
            autoFocus
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" startIcon={<Lock />} onClick={lock} disabled={busy}>
          Lock
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Confirm lifting a hand lock (wanly-api#358, #363). The runs that trained on the set keep
 *  their own record of what they trained on, so changing it changes none of them. */
function UnlockDialog({
  ds, onClose, onUnlocked,
}: {
  ds: Dataset;
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const unlock = async () => {
    setBusy(true);
    setError("");
    try {
      await unlockDataset(ds.id);
      onUnlocked();
    } catch (e: unknown) {
      setError(apiErrorText(e, "could not unlock it"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Unlock “{ds.name}”?</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2">
            Its images, crops, captions and owner can be changed again, and it can be deleted.
          </Typography>
          <Typography variant="body2">
            The LoRAs already trained from it keep their own snapshot of its images and captions,
            so changing the set does not change what they learned or what a retry trains on.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" color="warning" startIcon={<LockOpen />} onClick={unlock}
                disabled={busy}>
          Unlock
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AssignDialog({
  ds, characters, onClose, onSaved, onCharactersChanged,
}: {
  ds: Dataset;
  characters: Character[];
  onClose: () => void;
  onSaved: () => void;
  onCharactersChanged: () => void;
}) {
  const [kind, setKind] = useState<DatasetKind | "">(ds.kind ?? "");
  const [owner, setOwner] = useState(ds.character ?? "");
  const [regClass, setRegClass] = useState<RegClass | "">(ds.reg_class ?? "");
  const [newCharOpen, setNewCharOpen] = useState(false);
  // One made from here, until the page's own re-read of the registry includes it.
  const [created, setCreated] = useState<Character | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const solos = [...characters.filter((c) => !isPairCharacter(c)),
    ...(created && !characters.some((c) => c.id === created.id) ? [created] : [])]
    .sort((a, b) => a.name.localeCompare(b.name));
  const pairs = characters.filter(isPairCharacter).map((c) => c.name).sort();
  const soloMatch = solos.find((c) => c.name.toLowerCase() === owner.trim().toLowerCase());

  const ready = kind === "" ? true
    : kind === "regularization" ? regClass !== ""
      : kind === "character" ? Boolean(soloMatch)
        : Boolean(owner.trim());

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await updateDataset(ds.id, {
        kind: kind || null,
        character: kind === "character" ? soloMatch!.name
          : kind === "composition" ? owner.trim() : null,
        reg_class: kind === "regularization" ? (regClass as RegClass) : null,
      });
      onSaved();
    } catch (e: unknown) {
      setError(apiErrorText(e, "could not save it"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>What is “{ds.name}”?</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <RadioGroup value={kind} onChange={(e) => setKind(e.target.value as DatasetKind | "")}>
            <FormControlLabel value="character" control={<Radio size="small" />}
              label="Character — one person, and only that person" />
            <FormControlLabel value="composition" control={<Radio size="small" />}
              label="Composition — both people of a pair in the same frame" />
            <FormControlLabel value="regularization" control={<Radio size="small" />}
              label="Regularization — generic people, no character" />
            <FormControlLabel value="" control={<Radio size="small" />}
              label="Unassigned" />
          </RadioGroup>

          {kind === "character" && (
            <TextField
              select
              label="Whose images"
              value={soloMatch?.name ?? ""}
              onChange={(e) => {
                if (e.target.value === "__new__") setNewCharOpen(true);
                else setOwner(e.target.value);
              }}
              helperText={owner && !soloMatch
                ? `“${owner}” is not a registered character — pick one, or create it.`
                : "Only this person's images train under this character's trigger."}
              error={Boolean(owner) && !soloMatch}
              fullWidth
            >
              {offeredCharacters(solos, owner).map((c) => (
                <MenuItem key={c.id} value={c.name}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <CharacterAvatar character={c} name={c.name} />
                    <span>{c.name}</span>
                  </Stack>
                </MenuItem>
              ))}
              <Divider />
              <MenuItem value="__new__"><em>New character…</em></MenuItem>
            </TextField>
          )}
          {kind === "composition" && (
            <Autocomplete
              freeSolo
              options={pairs}
              inputValue={owner}
              onInputChange={(_e, v) => setOwner(v)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Pair name"
                  helperText="Exactly the pair name the Train dialog uses, e.g. DavidKelly-2026."
                  fullWidth
                />
              )}
            />
          )}
          {kind === "regularization" && (
            <TextField
              select
              label="Class"
              value={regClass}
              onChange={(e) => setRegClass(e.target.value as RegClass)}
              helperText="Every run of a character of this gender trains against this pool, so the class word stops drifting toward that character."
              fullWidth
            >
              <MenuItem value="woman">woman</MenuItem>
              <MenuItem value="man">man</MenuItem>
            </TextField>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disabled={busy || !ready} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
      {newCharOpen && (
        <NewCharacterDialog
          initialName={ds.name.trim().replace(/\s+/g, "-")}
          onClose={() => setNewCharOpen(false)}
          onCreated={(c) => { setCreated(c); setOwner(c.name); onCharactersChanged(); }}
        />
      )}
    </Dialog>
  );
}
