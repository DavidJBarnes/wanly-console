import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import {
  Alert, Box, Button, Card, CardActions, CardContent, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, MenuItem, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import { Add, DeleteOutline, Edit, Refresh, ViewInAr } from "@mui/icons-material";
import {
  createFaceLoop, deleteFaceLoop, getFileUrl, listCharacterFaceLoops, listFaceLoopPresets, rankFaceLoopPhotos,
  renameFaceLoop, reprocessFaceLoop, uploadFile,
} from "../api/client";
import type { FaceLoop, FaceLoopPhoto, FaceLoopPreset } from "../api/types";
import { loopFile, loopStatsLabel, loopStatusLabel, needsPolling, photoHint } from "../lib/faceLoops";

const POLL_MS = 15_000;

/**
 * A character's face loops (console#742): calm, still, looping face clips for the AR face page.
 *
 * Create = pick a close-up photo + an expression preset. That queues an ordinary LTX render
 * (Prompt recipe, the character's own LoRA); when it lands, the api prepares the loop (calmest
 * 3 s, steadied, smoothed) and it appears here as Ready, and in the AR page's picker.
 */
export default function CharacterFaceLoops({ character }: { character: string }) {
  const [loops, setLoops] = useState<FaceLoop[] | null>(null);
  const [presets, setPresets] = useState<FaceLoopPreset[]>([]);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const [doomed, setDoomed] = useState<FaceLoop | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoops(await listCharacterFaceLoops(character));
      setError("");
    } catch {
      setError("Could not load the face loops.");
    }
  }, [character]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    listFaceLoopPresets().then(setPresets, () => setPresets([]));
  }, []);
  // Refresh while a render or a preparation is in flight.
  useEffect(() => {
    if (!loops || !needsPolling(loops)) return;
    const id = window.setTimeout(() => void load(), POLL_MS);
    return () => window.clearTimeout(id);
  }, [loops, load]);

  const run = async (fn: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    try {
      await fn();
      setError("");
      await load();
      return true;
    } catch {
      setError(failed);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1100 }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)}>New face loop</Button>
        <Typography variant="body2" color="text.secondary">
          Short, calm loops of {character}'s face for the AR face page. Rendering takes a few minutes in the queue;
          the loop is prepared automatically when it lands.
        </Typography>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loops === null ? (
        <CircularProgress size={24} />
      ) : loops.length === 0 ? (
        <Alert severity="info">No face loops yet. Make one with <b>New face loop</b>.</Alert>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 2 }}>
          {loops.map((l) => (
            <LoopCard
              key={l.id}
              loop={l}
              busy={busy}
              onRename={() => setRenaming({ id: l.id, label: l.label })}
              onDelete={() => setDoomed(l)}
              onRetry={() => void run(() => reprocessFaceLoop(l.id), "Could not restart the preparation.")}
            />
          ))}
        </Box>
      )}

      {creating && (
        <CreateLoopDialog
          character={character}
          presets={presets}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); void load(); }}
        />
      )}

      <Dialog open={!!renaming} onClose={() => setRenaming(null)} fullWidth maxWidth="xs">
        <DialogTitle>Rename face loop</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth sx={{ mt: 1 }} value={renaming?.label ?? ""}
            onChange={(e) => setRenaming((r) => (r ? { ...r, label: e.target.value } : r))} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(null)}>Cancel</Button>
          <Button variant="contained" disabled={busy || !renaming?.label.trim()} onClick={async () => {
            if (renaming && await run(() => renameFaceLoop(renaming.id, renaming.label.trim()), "Could not rename.")) setRenaming(null);
          }}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!doomed} onClose={() => setDoomed(null)}>
        <DialogTitle>Delete “{doomed?.label}”?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">The loop files are removed. The render job it came from stays in the job list.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDoomed(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={async () => {
            if (doomed && await run(() => deleteFaceLoop(doomed.id), "Could not delete.")) setDoomed(null);
          }}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function LoopCard({ loop, busy, onRename, onDelete, onRetry }: {
  loop: FaceLoop; busy: boolean; onRename: () => void; onDelete: () => void; onRetry: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const poster = loopFile(loop, "poster.jpg");
  const clip = loopFile(loop, "loop.mp4");
  const ready = loop.status === "ready";
  const failed = loop.status === "failed" || loop.render_status === "failed";
  return (
    <Card variant="outlined">
      <Box
        sx={{ position: "relative", aspectRatio: "1 / 1", bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center" }}
        onMouseEnter={() => void video.current?.play().catch(() => {})}
        onMouseLeave={() => video.current?.pause()}
      >
        {ready && clip ? (
          <video ref={video} src={getFileUrl(clip)} poster={poster ? getFileUrl(poster) : undefined}
            muted loop playsInline preload="none" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : failed ? (
          <Typography variant="body2" color="error" sx={{ p: 2 }}>{loopStatusLabel(loop)}</Typography>
        ) : (
          <Stack alignItems="center" spacing={1}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">{loopStatusLabel(loop)}</Typography>
          </Stack>
        )}
      </Box>
      <CardContent sx={{ pb: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }} noWrap title={loop.label}>{loop.label}</Typography>
          <Chip size="small" label={loopStatusLabel(loop)}
            color={ready ? "success" : failed ? "error" : "default"} variant={ready ? "filled" : "outlined"} />
        </Stack>
        <Typography variant="caption" color="text.secondary" component="div">
          {loopStatsLabel(loop) || new Date(loop.created_at).toLocaleString()}
        </Typography>
        {loop.error && (
          <Typography variant="caption" color="error" component="div" sx={{ mt: 0.5 }} title={loop.error}>
            {loop.error.slice(0, 140)}
          </Typography>
        )}
      </CardContent>
      <CardActions disableSpacing sx={{ gap: 0.5 }}>
        {ready && (
          <Tooltip title="Open the AR face page with this loop">
            <Button size="small" startIcon={<ViewInAr />} component={RouterLink} to={`/holo/face-spike?loop=${loop.id}`}>AR</Button>
          </Tooltip>
        )}
        {loop.job_id && <Button size="small" component={RouterLink} to={`/jobs/${loop.job_id}`}>Job</Button>}
        <Box sx={{ flexGrow: 1 }} />
        {loop.status === "failed" && (
          <Tooltip title="Prepare the loop again from the finished render">
            <span><IconButton size="small" disabled={busy} onClick={onRetry}><Refresh fontSize="small" /></IconButton></span>
          </Tooltip>
        )}
        <Tooltip title="Rename"><span><IconButton size="small" disabled={busy} onClick={onRename}><Edit fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Delete"><span><IconButton size="small" color="error" disabled={busy} onClick={onDelete}><DeleteOutline fontSize="small" /></IconButton></span></Tooltip>
      </CardActions>
    </Card>
  );
}

function CreateLoopDialog({ character, presets, onClose, onCreated }: {
  character: string; presets: FaceLoopPreset[]; onClose: () => void; onCreated: () => void;
}) {
  const [photos, setPhotos] = useState<FaceLoopPhoto[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    rankFaceLoopPhotos(character).then(
      (ranked) => {
        setPhotos(ranked);
        // Preselect the best suitable photo: it is almost always the right one.
        const best = ranked.find((p) => p.suitable);
        if (best) setPhoto((cur) => cur ?? best.uri);
      },
      () => setPhotos([]),
    );
  }, [character]);
  const [preset, setPreset] = useState("calm");
  const [motion, setMotion] = useState("");
  const [label, setLabel] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = presets.find((p) => p.id === preset);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      setPhoto((await uploadFile(f)).path);
      setError("");
    } catch {
      setError("Could not upload the photo.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!photo) return;
    setBusy(true);
    try {
      await createFaceLoop(character, {
        preset, start_image: photo, label: label.trim() || undefined,
        motion: preset === "custom" ? motion.trim() : undefined,
      });
      onCreated();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not create the face loop.");
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>New face loop for {character}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="Expression" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {presets.map((p) => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
          </TextField>
          {preset === "custom" ? (
            <TextField label="What the face does" multiline minRows={2} value={motion}
              helperText="Keep it calm and small: blinks, a smile, a glance. Big expressions make the face slide on the mannequin."
              onChange={(e) => setMotion(e.target.value)} />
          ) : chosen?.motion ? (
            <Typography variant="body2" color="text.secondary">{chosen.motion}</Typography>
          ) : null}
          <TextField label="Name (optional)" value={label} placeholder={chosen?.label} onChange={(e) => setLabel(e.target.value)} />

          <Box>
            <Typography variant="subtitle2">Start photo</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              A close-up, front-facing photo with the face filling the frame, mouth closed, eyes open.
              The sharper and bigger the face, the better the loop.
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Button component="label" variant="outlined" size="small" disabled={busy}>
                Upload a photo
                <input hidden type="file" accept="image/*" onChange={(e) => void upload(e.target.files?.[0])} />
              </Button>
              {photo && <Typography variant="caption" color="text.secondary" noWrap>Chosen: {photo.split("/").pop()}</Typography>}
            </Stack>
            {photos === null ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  Rating {character}'s photos… (the first time can take half a minute)
                </Typography>
              </Stack>
            ) : photos.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No photos with a detectable face in {character}'s sets. Upload one.</Typography>
            ) : (
              <>
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 1, maxHeight: 360, overflowY: "auto", p: 0.5 }}>
                  {(showAll ? photos : photos.filter((p) => p.suitable).slice(0, 24)).map((p, i) => (
                    <Tooltip key={p.uri} title={photoHint(p)}>
                      <Box onClick={() => setPhoto(p.uri)} sx={{
                        position: "relative", aspectRatio: "1 / 1", borderRadius: 1, overflow: "hidden", cursor: "pointer",
                        outline: photo === p.uri ? "3px solid" : "none", outlineColor: "primary.main",
                        opacity: p.suitable ? 1 : 0.45, bgcolor: "action.hover",
                      }}>
                        <Box component="img" loading="lazy" src={getFileUrl(p.uri)} alt=""
                          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                        {i < 3 && p.suitable && !showAll && (
                          <Chip label="Best" size="small" color="success" sx={{ position: "absolute", top: 4, left: 4, height: 18 }} />
                        )}
                      </Box>
                    </Tooltip>
                  ))}
                </Box>
                <Button size="small" sx={{ mt: 0.5 }} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show the best only" : `Show all ${photos.length} photos`}
                </Button>
              </>
            )}
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !photo || (preset === "custom" && !motion.trim())} onClick={() => void submit()}>
          Queue render
        </Button>
      </DialogActions>
    </Dialog>
  );
}
