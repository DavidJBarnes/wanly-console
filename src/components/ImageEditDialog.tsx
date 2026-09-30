import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Slider, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import { Face, PlayArrow, RestartAlt } from "@mui/icons-material";

import {
  getEditFaces, getEditJob, getEditPresets, getFileUrl, listDatasets, saveEditJob, startFullEdit,
} from "../api/client";
import type {
  Dataset, ExpressionPreset, HeadAnglePreset, ImageEditFaces, ImageEditJob, ImageEditResult,
} from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";
import { apiError } from "../lib/apiError";
import {
  datasetChoices, datasetSaveProblem, describeAngle, describeEdit, editBody, faceChoice, faceHint,
  identityVerdict, initialFace, instructionProblem, isEditedImage, jobActive, jobStatusLine,
  MAX_INSTRUCTION, NO_EDIT, pickerFaces, QWEN_NOTE, savedName, scaleBox, type EditChoice,
} from "../lib/imageEdit";

/**
 * The Image Edit tool (wanly-console#547, #548; Qwen for everything since #569).
 *
 * Every edit is a Qwen-Image-Edit job. LivePortrait, which used to take expressions and head
 * turns within ±20°, "drops every detail" and is gone from the dialog. What to change is built
 * up from three inputs, any mix of them, and sent as ONE job when Run is pressed:
 *   - a description ("describe the change"), sent as the instruction as typed;
 *   - an expression preset (smile, big laugh, surprised, …), toggled on or off;
 *   - a head angle: presets up to a full profile, or yaw/pitch sliders, in the image's
 *     directions (yaw < 0 = toward the picture's left edge, pitch > 0 = chin up).
 *
 * There is no instant preview. A job queues for a free GPU -- the standing second 3090, or the
 * main 3090 once its render segment finishes -- and the "after" pane shows the API's reason
 * while it waits ("second 3090 busy (A1111 generating); edit queued"), then the result with an
 * AuraFace identity score against the original, so drift is visible before anything is saved.
 * Nothing is stored until Save, and Save always writes a NEW image.
 *
 * Several faces (#553): on open the dialog asks which faces there are; with two or more it
 * draws them as numbered boxes over "Before", starting on the API's default, and sends the
 * chosen box with the job. The service crops around that face, edits it alone and pastes it
 * back, so nobody else in the picture is regenerated. One pass edits one face; the next person
 * is a second pass on the saved result ("Edit the saved image"). With one face, or if the
 * faces call fails, nothing is drawn and the whole frame is edited.
 */
export default function ImageEditDialog({
  open, sourceUri, dataset = null, onClose, onSaved,
}: {
  open: boolean;
  sourceUri: string | null;
  /** Opened from a dataset tile: "Save to dataset" means this one. Otherwise a picker. */
  dataset?: Dataset | null;
  onClose: () => void;
  onSaved: (result: ImageEditResult) => void;
}) {
  const isMobile = useIsMobile();
  const [headAngles, setHeadAngles] = useState<HeadAnglePreset[]>([]);
  const [expressions, setExpressions] = useState<ExpressionPreset[]>([]);
  const [maxYaw, setMaxYaw] = useState(90);
  const [maxPitch, setMaxPitch] = useState(45);
  const [choice, setChoice] = useState<EditChoice>(NO_EDIT);
  const [job, setJob] = useState<ImageEditJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<ImageEditResult[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [targetId, setTargetId] = useState("");
  // "Edit the saved image": the dialog moves on to its own result without closing, so the
  // next face is one click away. Cleared whenever the parent opens or points it elsewhere.
  const [chained, setChained] = useState<string | null>(null);
  const [faces, setFaces] = useState<ImageEditFaces | null>(null);
  const [selectedFace, setSelectedFace] = useState<number | null>(null);
  // Where "Before" is drawn inside its pane, for placing the face boxes on it.
  const [drawn, setDrawn] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const beforeImg = useRef<HTMLImageElement | null>(null);
  const openFor = useRef<string | null>(null);

  useEffect(() => { setChained(null); }, [open, sourceUri]);
  const uri = chained ?? sourceUri;

  // By id, not by object: saving to the dataset refreshes the parent's copy of it, and a new
  // object must not reset the dialog mid-session (and wipe the "Saved ..." list).
  const fixedDatasetId = dataset?.id ?? null;
  useEffect(() => {
    if (!open || !uri) return;
    openFor.current = uri;
    setFaces(null);
    setSelectedFace(null);
    // Silent on failure: without the list the whole frame is edited, which is right for the
    // one-person images most edits are.
    getEditFaces(uri)
      .then((f) => {
        if (openFor.current !== uri) return;
        setFaces(f);
        setSelectedFace(initialFace(f));
      })
      .catch((e) => console.warn("Image Edit: face list unavailable, editing the whole frame:", e));
    setError("");
    setSaved([]);
    setChoice(NO_EDIT);
    setJob(null);
    getEditPresets()
      .then((p) => {
        setHeadAngles(p.head_angles ?? []);
        setExpressions(p.expressions ?? []);
        setMaxYaw(p.max_yaw ?? 90);
        setMaxPitch(p.max_pitch ?? 45);
      })
      .catch((e) => setError(apiError(e, "Could not load the edit presets")));
    if (!fixedDatasetId) {
      listDatasets().then(setDatasets).catch(() => setDatasets([]));
    }
  }, [open, uri, fixedDatasetId]);

  // Poll the job until it lands. Every 3 s: the wait is minutes when a GPU is finishing a
  // render or A1111 is generating, and seconds once it is editing. Stops when the dialog moves on.
  const jobId = job?.id ?? null;
  const jobLive = jobActive(job);
  useEffect(() => {
    if (!jobId || !jobLive) return;
    const forUri = openFor.current;
    const t = setTimeout(() => {
      getEditJob(jobId)
        .then((j) => { if (openFor.current === forUri) setJob(j); })
        .catch((e) => {
          if (openFor.current === forUri) {
            setJob((prev) => (prev ? { ...prev, state: "failed", message: apiError(e, "Lost the edit job") } : prev));
          }
        });
    }, 3000);
    return () => clearTimeout(t);
  }, [jobId, jobLive, job]);

  const body = uri ? editBody(uri, choice, headAngles, faceChoice(faces, selectedFace)) : null;
  const textProblem = instructionProblem(choice.text);

  const run = async () => {
    if (!body || textProblem || jobActive(job)) return;
    setStarting(true);
    setError("");
    try {
      setJob(await startFullEdit(body));
    } catch (e) {
      setError(apiError(e, "Could not start the edit"));
    } finally {
      setStarting(false);
    }
  };

  const change = (patch: Partial<EditChoice>) => setChoice((c) => ({ ...c, ...patch }));

  const chooseFace = (index: number) => {
    // Takes effect on the next Run; a result already on screen stays the face it was run on.
    setSelectedFace(index);
  };

  // The rendered size and position of "Before", re-read whenever the image loads or its box
  // changes (window resize, the mobile layout): the face boxes are placed from it.
  const measure = useCallback(() => {
    const img = beforeImg.current;
    if (!img || !img.clientWidth) return;
    setDrawn({ left: img.offsetLeft, top: img.offsetTop, width: img.clientWidth, height: img.clientHeight });
  }, []);
  // A callback ref, not an effect: the dialog's content mounts through a portal a render after
  // `open` flips, so an effect would find no image to watch. The pane is watched as well as
  // the image because a height-bound image keeps its size while the pane widens -- only its
  // offset moves, and the boxes must move with it.
  const watcher = useRef<ResizeObserver | null>(null);
  const beforeRef = useCallback((img: HTMLImageElement | null) => {
    watcher.current?.disconnect();
    watcher.current = null;
    beforeImg.current = img;
    if (!img || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(img);
    if (img.parentElement) ro.observe(img.parentElement);
    watcher.current = ro;
  }, [measure]);

  const target = dataset ?? datasets.find((d) => d.id === targetId) ?? null;
  const targetProblem = datasetSaveProblem(target);
  const done = job?.state === "done";
  const busy = jobActive(job) || starting;

  const save = async (toDataset: boolean) => {
    if (!job || !done) return;
    setSaving(true);
    setError("");
    try {
      const result = await saveEditJob(job.id, toDataset && target ? target.id : null);
      setSaved((prev) => [result, ...prev]);
      onSaved(result);
    } catch (e) {
      setError(apiError(e, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const picker = pickerFaces(faces);
  const overlay = picker.length > 0 && drawn && faces
    ? picker.map((f) => {
      const b = scaleBox(f.box, faces, drawn, drawn);
      const on = f.index === selectedFace;
      return (
        <Box
          key={f.index}
          component="button"
          type="button"
          onClick={() => chooseFace(f.index)}
          disabled={saving}
          aria-label={`Edit face ${f.index + 1}`}
          aria-pressed={on}
          sx={{
            position: "absolute", left: b.left, top: b.top, width: b.width, height: b.height,
            p: 0, m: 0, bgcolor: "transparent", cursor: "pointer", borderRadius: 0.5,
            border: "2px solid", borderColor: on ? "primary.main" : "rgba(255,255,255,0.8)",
            boxShadow: on ? 3 : "0 0 0 1px rgba(0,0,0,0.6)",
            "&:hover": { borderColor: "primary.light" },
          }}
        >
          <Box component="span" sx={{
            position: "absolute", top: -2, left: -2, px: 0.6, minWidth: 18, fontSize: 12,
            lineHeight: "18px", fontWeight: 700, borderRadius: "0 0 4px 0",
            bgcolor: on ? "primary.main" : "rgba(0,0,0,0.7)", color: "#fff",
          }}>
            {f.index + 1}
          </Box>
        </Box>
      );
    })
    : null;

  const pane = (label: string, src: string | null, spin = false, note?: string, before = false) => (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Box sx={{
        position: "relative", bgcolor: "action.hover", borderRadius: 1, overflow: "hidden",
        height: isMobile ? 260 : 440, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {src
          ? <Box component="img" src={src} alt={label}
              ref={before ? beforeRef : undefined}
              onLoad={before ? measure : undefined}
              sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", opacity: spin ? 0.5 : 1 }} />
          : <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
              {note}
            </Typography>}
        {spin && <CircularProgress size={32} sx={{ position: "absolute" }} />}
        {before && overlay}
      </Box>
    </Box>
  );

  const summary = describeEdit(choice, headAngles, expressions);
  const verdict = done ? identityVerdict(job?.identity) : null;

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="lg" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Face /> Edit image
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {QWEN_NOTE}
        </Typography>
        {uri && isEditedImage(uri) && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            This image is already an edit. Every pass regenerates what it edits and the drift adds
            up — edit the original instead when you can.
            {picker.length > 0 && " Editing a different face from last time is fine: only the chosen face is regenerated."}
          </Alert>
        )}
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        {/* At the top, not under the controls: on a short screen the bottom of the content is
            scrolled out of view, and a save that confirms out of sight reads as one that did
            nothing. */}
        {saved.length > 0 && (
          <Alert severity="success" sx={{ mb: 1 }}>
            Saved {savedName(saved[0].uri)}
            {saved[0].dataset_id ? ` to ${dataset?.name ?? "the dataset"}` : " to the Image Repo"}
            {saved.length > 1 ? ` (${saved.length} saved this session)` : ""}. Keep editing to
            save another variant.
            {picker.length > 0 && (
              <Button size="small" sx={{ ml: 1 }} onClick={() => setChained(saved[0].uri)} disabled={saving}>
                Edit the saved image
              </Button>
            )}
          </Alert>
        )}

        {picker.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {faceHint(picker.length)}
          </Typography>
        )}

        <Stack direction={isMobile ? "column" : "row"} spacing={2}>
          <Stack direction="row" spacing={1} sx={{ flex: 3, minWidth: 0 }}>
            {pane("Before", uri ? getFileUrl(uri) : null, false, undefined, true)}
            {pane(
              "After",
              done ? job?.preview ?? null : null,
              busy,
              job ? jobStatusLine(job) : "Choose a change and press Run",
            )}
          </Stack>

          <Box sx={{ flex: 2, minWidth: 0 }}>
            <Typography variant="overline">Describe the change</Typography>
            <TextField
              size="small"
              fullWidth
              multiline
              maxRows={4}
              placeholder="e.g. a warm genuine smile, eyes looking at the camera"
              value={choice.text}
              disabled={saving}
              error={Boolean(textProblem)}
              helperText={textProblem ?? undefined}
              onChange={(e) => change({ text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void run();
                }
              }}
              slotProps={{ htmlInput: { maxLength: MAX_INSTRUCTION, "aria-label": "Describe the change" } }}
            />

            {expressions.length > 0 && (
              <>
                <Typography variant="overline" sx={{ display: "block", mt: 1 }}>Expression</Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {expressions.map((p) => (
                    <Button
                      key={p.name}
                      size="small"
                      variant={choice.expression === p.name ? "contained" : "outlined"}
                      disabled={saving}
                      // A toggle: click again to drop it from the edit.
                      onClick={() => change({ expression: choice.expression === p.name ? null : p.name })}
                    >
                      {p.label}
                    </Button>
                  ))}
                </Box>
              </>
            )}

            {headAngles.length > 0 && (
              <>
                <Typography variant="overline" sx={{ display: "block", mt: 1 }}>Head angle</Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1 }}>
                  {headAngles.map((p) => {
                    const on = choice.yaw === p.yaw && choice.pitch === p.pitch;
                    return (
                      <Button
                        key={p.name}
                        size="small"
                        variant={on ? "contained" : "outlined"}
                        disabled={saving}
                        onClick={() => change(on ? { yaw: 0, pitch: 0 } : { yaw: p.yaw, pitch: p.pitch })}
                      >
                        {p.label}
                      </Button>
                    );
                  })}
                </Box>
                {([["Turn (yaw)", "yaw", maxYaw], ["Tilt (pitch)", "pitch", maxPitch]] as const)
                  .map(([label, key, max]) => (
                    <Box key={key} sx={{ px: 1 }}>
                      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                        <Typography variant="caption">{label}</Typography>
                        <Typography variant="caption" color="text.secondary">{choice[key]}°</Typography>
                      </Stack>
                      <Slider
                        size="small" min={-max} max={max} step={5} value={choice[key]}
                        disabled={saving}
                        marks={[{ value: 0 }]}
                        onChange={(_, nv) => change({ [key]: nv as number })}
                        aria-label={label}
                      />
                    </Box>
                  ))}
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 1 }}>
                  {describeAngle(choice.yaw, choice.pitch)} — left/right as the picture is seen.
                </Typography>
              </>
            )}

            <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: "center", flexWrap: "wrap" }}>
              <Tooltip title={jobActive(job) ? "Wait for the edit in progress to finish" : ""}>
                <span>
                  <Button
                    variant="contained"
                    startIcon={starting ? <CircularProgress size={16} /> : <PlayArrow />}
                    disabled={saving || busy || !body || Boolean(textProblem)}
                    onClick={() => void run()}
                  >
                    Run
                  </Button>
                </span>
              </Tooltip>
              <Button
                size="small"
                startIcon={<RestartAlt />}
                onClick={() => setChoice(NO_EDIT)}
                disabled={saving || !summary}
              >
                Reset
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
              {summary ? `Will run: ${summary}` : "Describe a change, pick an expression or a head angle — or several."}
            </Typography>

            {job && (
              <Typography variant="body2" color={job.state === "failed" ? "error" : "text.secondary"} sx={{ mt: 1 }}>
                {jobStatusLine(job)}
              </Typography>
            )}
            {verdict && <Alert severity={verdict.severity} sx={{ mt: 1 }}>{verdict.text}</Alert>}
          </Box>
        </Stack>

      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        {!dataset && (
          <TextField
            select
            size="small"
            label="Dataset"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            sx={{ minWidth: 220 }}
          >
            {datasetChoices(datasets).map(({ ds, problem }) => (
              <MenuItem key={ds.id} value={ds.id} disabled={Boolean(problem)}>
                {ds.name}{problem ? " (locked)" : ""}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Tooltip title={done ? (targetProblem ?? "") : "Nothing to save yet"}>
          <span>
            <Button
              onClick={() => save(true)}
              disabled={!done || saving || Boolean(targetProblem)}
            >
              {dataset ? `Save to ${dataset.name}` : "Save to dataset"}
            </Button>
          </span>
        </Tooltip>
        <Button
          variant="contained"
          onClick={() => save(false)}
          disabled={!done || saving}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          Save as new image
        </Button>
        <Button onClick={onClose} disabled={saving} sx={{ ml: "auto" }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
