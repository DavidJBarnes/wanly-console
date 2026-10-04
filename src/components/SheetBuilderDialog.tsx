import { useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, MenuItem, Stack, TextField, Typography,
} from "@mui/material";

import {
  composeSheet, getSheetJob, getSheetPresets, listCharacterSheets, ltxError, startSheetJob,
  updateCharacter,
} from "../api/ltx";
import type { Character, CharacterSheetRecord, SheetJob, SheetPresets } from "../api/ltx";
import { getFileUrl } from "../api/client";
import PickFromRepoDialog from "./PickFromRepoDialog";
import { SheetPreview, SheetViewerDialog } from "./SheetPreview";
import {
  candidateScore, FALLBACK_PRESETS, facePanelNote, facePanelPreview, initialSheetForm, MAX_COUNT,
  PHOTO_HINT, resumeKey, savedSeeds, sheetFormProblem, sheetJobActive, sheetJobLine,
  sheetGallery, sheetGalleryLine, sheetRequest, switchGender, type SheetForm,
  type SheetGalleryItem,
} from "../lib/characterSheet";

function readResume(characterId: string): string | null {
  try {
    return localStorage.getItem(resumeKey(characterId));
  } catch {
    return null;
  }
}

function writeResume(characterId: string, jobId: string | null) {
  try {
    if (jobId) localStorage.setItem(resumeKey(characterId), jobId);
    else localStorage.removeItem(resumeKey(characterId));
  } catch {
    // Storage blocked: the job still runs, it just will not be picked up after a close.
  }
}

/**
 * Build sheet (console#580, #585, epic #582): pick ONE photo of her (face + body), describe the
 * outfit and hair she wears in it, generate N candidates on the image-edit queue, compare them
 * side by side, and approve one -- it is saved to the Image Repo and becomes the character's
 * sheet. Her build comes from the photo, and the face panel is auto-cropped from it.
 */
export default function SheetBuilderDialog({
  character, onClose, onSaved,
}: {
  character: Character;
  onClose: () => void;
  onSaved: (c: Character) => void;
}) {
  const [presets, setPresets] = useState<SheetPresets>(FALLBACK_PRESETS);
  const [form, setForm] = useState<SheetForm>(() => initialSheetForm(character.gender));
  const [picking, setPicking] = useState(false);
  const [job, setJob] = useState<SheetJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [composing, setComposing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CharacterSheetRecord[]>([]);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  // The sheet the character renders with right now (console#598): it moves on approve and on
  // Make current, without waiting for the parent to reload.
  const [current, setCurrent] = useState<string | null>(character.sheet_uri ?? null);
  const [viewing, setViewing] = useState<{ uri: string; title: string; subtitle?: string } | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const touched = useRef(false);
  const set = (patch: Partial<SheetForm>) => {
    touched.current = true;
    setForm((f) => ({ ...f, ...patch }));
  };

  useEffect(() => {
    getSheetPresets()
      .then((p) => {
        setPresets(p);
        // Re-fill from the API's words only if the user has not started typing.
        if (!touched.current) setForm(initialSheetForm(character.gender, p));
      })
      .catch(() => { /* the fallback presets are the same words */ });
    listCharacterSheets(character.id).then(setHistory).catch(() => setHistory([]));
    // A job started earlier (the dialog was closed while it waited) is picked up again.
    const resume = readResume(character.id);
    if (resume) {
      getSheetJob(resume).then(setJob).catch(() => writeResume(character.id, null));
    }
  }, [character.id, character.gender]);

  // Poll every 4 s: the wait is minutes while the 3090 finishes a segment, and each
  // candidate is a few minutes of 40-step Qwen once it runs.
  const jobId = job?.id ?? null;
  const live = sheetJobActive(job);
  useEffect(() => {
    if (!jobId || !live) return;
    const t = setTimeout(() => {
      getSheetJob(jobId).then(setJob).catch((e) =>
        setJob((prev) => (prev ? { ...prev, state: "failed", message: ltxError(e) } : prev)));
    }, 4000);
    return () => clearTimeout(t);
  }, [jobId, live, job]);

  const problem = sheetFormProblem(form);
  const generate = async () => {
    if (problem || live) return;
    setStarting(true);
    setError(null);
    setSavedMsg(null);
    try {
      const j = await startSheetJob(character.id, sheetRequest(form));
      setJob(j);
      writeResume(character.id, j.id);
    } catch (e) {
      setError(ltxError(e));
    } finally {
      setStarting(false);
    }
  };

  const approve = async (seed: number) => {
    if (!job) return;
    setComposing(seed);
    setError(null);
    try {
      const out = await composeSheet(character.id, job.id, seed);
      setSavedMsg(`Saved as ${character.name}'s sheet: ${out.sheet.sheet_uri.split("/").pop()}`);
      setHistory((h) => [out.sheet, ...h]);
      setCurrent(out.character.sheet_uri ?? out.sheet.sheet_uri);
      setJob(await getSheetJob(job.id));
      writeResume(character.id, null);
      onSaved(out.character);
    } catch (e) {
      setError(ltxError(e));
    } finally {
      setComposing(null);
    }
  };

  const makeCurrent = async (item: SheetGalleryItem) => {
    setSwitching(item.uri);
    setError(null);
    setSavedMsg(null);
    try {
      const c = await updateCharacter(character.id, { sheet_uri: item.uri });
      setCurrent(c.sheet_uri ?? item.uri);
      setSavedMsg(`${character.name} now renders with ${item.uri.split("/").pop()}.`);
      onSaved(c);
    } catch (e) {
      setError(ltxError(e));
    } finally {
      setSwitching(null);
    }
  };

  const gallery = sheetGallery(history, current);
  const saved = savedSeeds(job);
  const panel = facePanelPreview(job);

  return (
    <Dialog open fullWidth maxWidth="xl" onClose={onClose}>
      <DialogTitle>Character sheet — {character.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Give it one photo of her, full body or most of it, in the outfit. The official
            Qwen-Image-Edit-2511 draws a front, side and back full-body turnaround from that
            photo, keeping her face, build and proportions, and the sheet puts her real face,
            cropped automatically from the same photo, beside it (1536×1024, the layout renders
            are conditioned on). Candidates queue for the image-edit GPU like edits do: they wait
            for a render segment to finish and never interrupt training.
          </Typography>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          {savedMsg && <Alert severity="success">{savedMsg}</Alert>}

          {gallery.length > 0 && (
            <>
              <Divider textAlign="left">
                <Typography variant="overline">{character.name}'s sheets</Typography>
              </Divider>
              <Box sx={{ display: "grid", gap: 2,
                         gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
                {gallery.map((item) => (
                  <Stack key={item.uri} spacing={0.5} sx={{
                    p: 0.5, borderRadius: 1, border: 2,
                    borderColor: item.current ? "primary.main" : "transparent",
                  }}>
                    <SheetPreview uri={item.uri} alt={`${character.name} sheet`} labels={false}
                                  onClick={() => setViewing({
                                    uri: item.uri,
                                    title: `${character.name}${item.current ? " — current sheet" : ""}`,
                                    subtitle: sheetGalleryLine(item),
                                  })} />
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="caption" color="text.secondary" noWrap
                                  sx={{ flexGrow: 1, minWidth: 0 }} title={sheetGalleryLine(item)}>
                        {sheetGalleryLine(item)}
                      </Typography>
                      {item.current ? (
                        <Chip size="small" color="primary" label="Current" />
                      ) : (
                        <Button size="small" disabled={switching !== null}
                                onClick={() => void makeCurrent(item)}>
                          {switching === item.uri ? "Switching…" : "Make current"}
                        </Button>
                      )}
                    </Stack>
                  </Stack>
                ))}
              </Box>
              <Divider textAlign="left"><Typography variant="overline">Build a new sheet</Typography></Divider>
            </>
          )}

          <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
            <Box sx={{ width: { xs: "100%", md: 220 }, flexShrink: 0 }}>
              <Typography variant="overline">1 · Photo of her (face + body)</Typography>
              {form.photoUri ? (
                <Stack spacing={1}>
                  <img src={getFileUrl(form.photoUri)} alt="photo of her"
                       style={{ width: "100%", borderRadius: 4, display: "block" }} />
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {form.photoUri.split("/").pop()}
                  </Typography>
                  <Button size="small" disabled={live} onClick={() => setPicking(true)}>
                    Change
                  </Button>
                </Stack>
              ) : (
                <Button variant="outlined" fullWidth onClick={() => setPicking(true)}>
                  Choose from the Image Repo
                </Button>
              )}
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                {PHOTO_HINT}
              </Typography>
              {panel && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="overline" component="div">Face panel (auto-cropped)</Typography>
                  <Box sx={{ position: "relative", width: 112, aspectRatio: "448 / 1024",
                             border: 2, borderColor: "success.main", borderRadius: 0.5,
                             overflow: "hidden", bgcolor: "#fff" }}>
                    <img src={getFileUrl(panel)} alt="face panel cropped from the photo"
                         style={{ display: "block", width: "100%", height: "100%",
                                  objectFit: "contain" }} />
                    <Typography variant="caption" sx={{
                      position: "absolute", left: 2, bottom: 2, px: 0.5, borderRadius: 0.5,
                      bgcolor: "rgba(255,255,255,0.85)", color: "success.dark", fontWeight: 700,
                      fontSize: 10, lineHeight: 1.3,
                    }}>
                      REAL
                    </Typography>
                  </Box>
                </Box>
              )}
            </Box>

            <Stack spacing={1.5} sx={{ flexGrow: 1, minWidth: 0, width: "100%" }}>
              <Typography variant="overline">
                2 · Outfit and hair — describe what she wears in the photo
              </Typography>
              <TextField label="Outfit" value={form.outfit} multiline minRows={2} fullWidth
                         disabled={live} inputProps={{ maxLength: 600 }}
                         onChange={(e) => set({ outfit: e.target.value })}
                         helperText="Describe what she wears in the photo; the turnaround keeps it in all three views. Her build comes from the photo itself." />
              <TextField label="Hair" value={form.hair} fullWidth disabled={live}
                         inputProps={{ maxLength: 300 }}
                         onChange={(e) => set({ hair: e.target.value })}
                         helperText="Describe her hair in the photo." />
              <Stack direction="row" spacing={2}>
                <TextField select label="Pronoun" value={form.gender} disabled={live}
                           sx={{ width: 160 }}
                           onChange={(e) => setForm((f) => switchGender(
                             f, e.target.value as "female" | "male", presets))}>
                  <MenuItem value="female">she / her</MenuItem>
                  <MenuItem value="male">he / his</MenuItem>
                </TextField>
                <TextField select label="Candidates" value={form.count} disabled={live}
                           sx={{ width: 140 }}
                           onChange={(e) => set({ count: Number(e.target.value) })}>
                  {Array.from({ length: presets.max_count || MAX_COUNT }, (_, i) => i + 1).map((n) => (
                    <MenuItem key={n} value={n}>{n}</MenuItem>
                  ))}
                </TextField>
                <Box sx={{ flexGrow: 1 }} />
                <Button variant="contained" disabled={!!problem || live || starting}
                        onClick={generate} sx={{ alignSelf: "center" }}>
                  {starting ? "Starting…" : job ? "Generate again" : "Generate"}
                </Button>
              </Stack>
              {problem && !job && (
                <Typography variant="caption" color="text.secondary">{problem}</Typography>
              )}
            </Stack>
          </Stack>

          {job && (
            <>
              <Divider textAlign="left"><Typography variant="overline">3 · Compare and approve</Typography></Divider>
              <Alert severity={job.state === "failed" ? "error" : job.state === "done" ? "success" : "info"}
                     icon={live ? <CircularProgress size={18} /> : undefined}>
                {sheetJobLine(job)}
              </Alert>
              <Box sx={{ display: "grid", gap: 2,
                         gridTemplateColumns: { xs: "1fr", lg: "repeat(auto-fill, minmax(560px, 1fr))" } }}>
                {job.candidates.map((c) => {
                  const note = facePanelNote(c);
                  return (
                    <Stack key={c.seed} spacing={0.5}>
                      <SheetPreview uri={c.preview_uri ?? c.sheet_uri}
                                    alt={`candidate seed ${c.seed}`}
                                    onClick={() => setViewing({
                                      uri: c.preview_uri ?? c.sheet_uri,
                                      title: `Candidate — seed ${c.seed}`,
                                      subtitle: candidateScore(c),
                                    })} />
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="caption" sx={{ flexGrow: 1 }}>
                          Seed {c.seed} · {candidateScore(c)}
                        </Typography>
                        <Button size="small" href={getFileUrl(c.sheet_uri)} target="_blank"
                                rel="noreferrer">Full size</Button>
                        <Button size="small" variant={saved.has(c.seed) ? "outlined" : "contained"}
                                disabled={composing !== null}
                                onClick={() => approve(c.seed)}>
                          {composing === c.seed ? "Saving…"
                            : saved.has(c.seed) ? "Saved — save again" : "Use this one"}
                        </Button>
                      </Stack>
                      {note && <Typography variant="caption" color="warning.main">{note}</Typography>}
                    </Stack>
                  );
                })}
                {live && job.candidates.length < job.seeds.length && (
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center",
                             aspectRatio: "1536 / 1024", border: 1, borderStyle: "dashed",
                             borderColor: "divider", borderRadius: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      {job.seeds.length - job.candidates.length} more to come
                    </Typography>
                  </Box>
                )}
              </Box>
            </>
          )}

        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{live ? "Close (it keeps running)" : "Close"}</Button>
      </DialogActions>

      {viewing && (
        <SheetViewerDialog uri={viewing.uri} title={viewing.title} subtitle={viewing.subtitle}
                           onClose={() => setViewing(null)} />
      )}

      {picking && (
        <PickFromRepoDialog
          title="Choose a photo of her (face + body)"
          onClose={() => setPicking(false)}
          onPick={(path) => {
            setForm((f) => ({ ...f, photoUri: path }));
            setPicking(false);
          }}
        />
      )}
    </Dialog>
  );
}
