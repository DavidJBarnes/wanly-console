import { useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, MenuItem, Stack, TextField, Typography,
} from "@mui/material";

import {
  composeSheet, getSheetJob, getSheetPresets, listCharacterSheets, ltxError, startSheetJob,
} from "../api/ltx";
import type {
  Character, CharacterSheetRecord, SheetCandidate, SheetJob, SheetPresets,
} from "../api/ltx";
import { getFileUrl } from "../api/client";
import PickFromRepoDialog from "./PickFromRepoDialog";
import {
  bodySentence, candidateScore, FALLBACK_PRESETS, facePanelNote, initialSheetForm, MAX_COUNT,
  resumeKey, savedSeeds, sheetFormProblem, sheetJobActive, sheetJobLine, sheetPanels,
  sheetRequest, switchGender, type SheetForm,
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

/** One candidate: the composed sheet with REAL / GENERATED labels drawn over it (never burned
 *  in -- the saved sheet is exactly what renders condition on). */
function CandidateSheet({ c }: { c: SheetCandidate }) {
  return (
    <Box sx={{ position: "relative", width: "100%", aspectRatio: "1536 / 1024",
               bgcolor: "action.hover", borderRadius: 1, overflow: "hidden" }}>
      <img src={getFileUrl(c.preview_uri ?? c.sheet_uri)} alt={`candidate seed ${c.seed}`}
           style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
      {sheetPanels().map((p, i) => (
        <Box key={i} sx={{
          position: "absolute", top: 0, bottom: 0, left: `${p.leftPct}%`, width: `${p.widthPct}%`,
          border: 2, borderColor: p.kind === "real" ? "success.main" : "error.main",
          pointerEvents: "none",
        }}>
          <Typography variant="caption" sx={{
            position: "absolute", left: 4, bottom: 4, px: 0.5, borderRadius: 0.5, lineHeight: 1.3,
            bgcolor: "rgba(255,255,255,0.85)", color: p.kind === "real" ? "success.dark" : "error.dark",
            fontWeight: 700, fontSize: 10,
          }}>
            {p.label} · {p.caption}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Build sheet (console#580, epic #582): pick a real face photo, describe outfit, hair and body,
 * generate N candidates on the image-edit queue, compare them side by side, and approve one --
 * it is saved to the Image Repo and becomes the character's sheet.
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
      setJob(await getSheetJob(job.id));
      writeResume(character.id, null);
      onSaved(out.character);
    } catch (e) {
      setError(ltxError(e));
    } finally {
      setComposing(null);
    }
  };

  const saved = savedSeeds(job);
  const sentence = bodySentence(form.body, form.gender);

  return (
    <Dialog open fullWidth maxWidth="xl" onClose={onClose}>
      <DialogTitle>Build a character sheet — {character.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            The official Qwen-Image-Edit-2511 draws a front, side and back full-body turnaround
            from a real face photo, and the sheet puts that photo's face beside it (1536×1024,
            the layout renders are conditioned on). Candidates queue for the image-edit GPU like
            edits do: they wait for a render segment to finish and never interrupt training.
          </Typography>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          {savedMsg && <Alert severity="success">{savedMsg}</Alert>}

          <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
            <Box sx={{ width: { xs: "100%", md: 220 }, flexShrink: 0 }}>
              <Typography variant="overline">1 · Real face photo</Typography>
              {form.faceUri ? (
                <Stack spacing={1}>
                  <img src={getFileUrl(form.faceUri)} alt="face photo"
                       style={{ width: "100%", borderRadius: 4, display: "block" }} />
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {form.faceUri.split("/").pop()}
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
            </Box>

            <Stack spacing={1.5} sx={{ flexGrow: 1, minWidth: 0, width: "100%" }}>
              <Typography variant="overline">2 · Outfit, hair and body</Typography>
              <TextField label="Outfit" value={form.outfit} multiline minRows={2} fullWidth
                         disabled={live} inputProps={{ maxLength: 600 }}
                         onChange={(e) => set({ outfit: e.target.value })}
                         helperText="Worn in all three views. Dress it like the start frames: in wide shots the body takes the sheet's clothes." />
              <TextField label="Hair" value={form.hair} fullWidth disabled={live}
                         inputProps={{ maxLength: 300 }}
                         onChange={(e) => set({ hair: e.target.value })} />
              <Box>
                <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
                  {presets.body.map((p) => (
                    <Chip key={p.name} size="small" label={p.label} disabled={live}
                          color={form.body === p.text ? "primary" : "default"}
                          variant={form.body === p.text ? "filled" : "outlined"}
                          onClick={() => set({ body: form.body === p.text ? "" : p.text })} />
                  ))}
                </Stack>
                <TextField label="Body build (optional)" value={form.body} fullWidth disabled={live}
                           inputProps={{ maxLength: 300 }}
                           onChange={(e) => set({ body: e.target.value })}
                           helperText={sentence
                             ? `Added to the prompt as its own sentence: “${sentence}”`
                             : "A preset or your own words, e.g. “a slim, athletic build”. Empty: the model keeps what the photo suggests."} />
              </Box>
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
                      <CandidateSheet c={c} />
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

          {history.length > 0 && (
            <>
              <Divider textAlign="left"><Typography variant="overline">Sheets saved for {character.name}</Typography></Divider>
              {history.map((h) => (
                <Typography key={h.id} variant="caption" color="text.secondary" component="div">
                  {h.created_at ? new Date(h.created_at).toLocaleString() : ""} · seed {h.seed} ·
                  face {h.face_uri.split("/").pop()} · {h.model ?? "?"}
                  {h.sheet_uri === character.sheet_uri ? " · current" : ""}
                </Typography>
              ))}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{live ? "Close (it keeps running)" : "Close"}</Button>
      </DialogActions>

      {picking && (
        <PickFromRepoDialog
          title="Choose a real face photo"
          onClose={() => setPicking(false)}
          onPick={(path) => {
            setForm((f) => ({ ...f, faceUri: path }));
            setPicking(false);
          }}
        />
      )}
    </Dialog>
  );
}
