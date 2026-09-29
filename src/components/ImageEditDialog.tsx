import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent,
  DialogTitle, MenuItem, Slider, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import { ExpandLess, ExpandMore, Face, PlayArrow, RestartAlt, Send } from "@mui/icons-material";

import {
  getEditFaces, getEditJob, getEditPresets, getFileUrl, listDatasets, previewImageEdit,
  saveEditJob, saveImageEdit, startFullEdit,
} from "../api/client";
import type {
  Dataset, EditAxis, EditPreset, HeadAnglePreset, ImageEditFaces, ImageEditJob, ImageEditPreview,
  ImageEditResult,
} from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";
import { apiError } from "../lib/apiError";
import {
  applyPreset, changedParams, clampToAxis, datasetChoices, datasetSaveProblem, describeAngle,
  describeRun, FACE_LIMIT_DEG, faceChoice, faceHint, faceValuesForAngle, fullAngleBody,
  FULL_MODE_WARNING, groupAxes, hasEdit, identityVerdict, initialFace, isEditedImage, jobActive,
  jobStatusLine, matchesPreset, MAX_PROMPT, neutralValues, pickerFaces, previewBody,
  promptProblem, routeAngle, savedName, scaleBox, unknownTermsMessage, valuesFromExpression,
  type EditValues, type PreviewRequest,
} from "../lib/imageEdit";

/**
 * The Image Edit tool, phase 1: face mode (wanly-console#547).
 *
 * LivePortrait WARPS the existing pixels -- expression, gaze, small head turns -- so the person
 * stays the same person, which is what makes it safe for identity datasets. It cannot invent
 * what it cannot see: head turns stop at about ±20°. (Phase 2, #548, adds a "Full" mode here:
 * Qwen-Image-Edit, which can, at the cost of regenerating the face.)
 *
 * Previews are run on each preset click and on each slider RELEASE, never mid-drag, and are
 * coalesced: while one is running, further changes wait and only the latest is sent. On the
 * CPU fallback a preview takes several seconds, and a queue of stale ones would be worse than
 * useless. Nothing is stored until Save, and Save always writes a NEW image.
 *
 * "Describe the change" (#550) sends text instead of numbers; the preview answers with what
 * the service understood (chips) and the numbers it resolved to, which move the sliders so the
 * description is a starting point to fine-tune, like a preset. It shares the coalescing above:
 * whichever input came last -- a description, a preset, a slider -- is what gets previewed.
 *
 * Several faces (#553): the service edits the one nearest the horizontal centre unless told
 * otherwise. On open the dialog asks which faces there are; with two or more it draws them as
 * numbered boxes over "Before", starting on the one the service would pick, and sends the
 * chosen box with every preview and save. One pass edits one face, so the next person is a
 * second pass on the saved result ("Edit the saved image"). With one face, or if the faces
 * call fails (an older service), nothing is drawn and the dialog is what it was.
 *
 * Head angle (#548): presets and yaw/pitch sliders in degrees, in the image's directions (yaw
 * < 0 = toward the picture's left edge, pitch > 0 = chin up). Within ±20° the angle becomes
 * LivePortrait slider values and previews like any face edit. Beyond it only Qwen can invent the
 * unseen side of the face, so it is a FULL-MODE job on the 3090: it carries the "regenerates the
 * image" warning, runs only when asked (it may wait for a render to finish), shows the API's
 * queued/waiting reason while it waits, and comes back with an AuraFace identity score against
 * the original so drift is visible before anything is saved. Whichever engine produced the
 * "after" pane last is what Save writes.
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
  const [axes, setAxes] = useState<EditAxis[]>([]);
  const [presets, setPresets] = useState<EditPreset[]>([]);
  const [values, setValues] = useState<EditValues>({});
  const [preset, setPreset] = useState<EditPreset | null>(null);
  const [preview, setPreview] = useState<ImageEditPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<ImageEditResult[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [targetId, setTargetId] = useState("");
  const [promptText, setPromptText] = useState("");
  const [promptNote, setPromptNote] = useState("");
  // The last description the service understood, and the sliders it produced. Kept so a save
  // that has not been fine-tuned since is recorded as that description, not as bare numbers.
  const [described, setDescribed] = useState<{ text: string; terms: string[]; values: EditValues } | null>(null);
  // "Edit the saved image": the dialog moves on to its own result without closing, so the
  // next face is one click away. Cleared whenever the parent opens or points it elsewhere.
  const [chained, setChained] = useState<string | null>(null);
  const [faces, setFaces] = useState<ImageEditFaces | null>(null);
  const [selectedFace, setSelectedFace] = useState<number | null>(null);
  // Where "Before" is drawn inside its pane, for placing the face boxes on it.
  const [drawn, setDrawn] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const beforeImg = useRef<HTMLImageElement | null>(null);
  // The face to send, readable from runPreview without re-creating it on every click.
  const face = useRef<{ faces: ImageEditFaces | null; selected: number | null }>({ faces: null, selected: null });
  // Head angle (#548).
  const [headAngles, setHeadAngles] = useState<HeadAnglePreset[]>([]);
  const [faceLimit, setFaceLimit] = useState(FACE_LIMIT_DEG);
  const [maxYaw, setMaxYaw] = useState(90);
  const [maxPitch, setMaxPitch] = useState(45);
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [job, setJob] = useState<ImageEditJob | null>(null);
  const [starting, setStarting] = useState(false);
  // Which engine the "after" pane and Save belong to: the last one the user drove.
  const [active, setActive] = useState<"face" | "full">("face");

  // The slider values as of the last change, readable from callbacks without a re-render.
  const current = useRef<EditValues>({});
  // Coalescing: what the NEXT preview should send, and whether one is running.
  const latest = useRef<PreviewRequest>({ kind: "values", values: {} });
  const inFlight = useRef(false);
  const dirty = useRef(false);
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
    face.current = { faces: null, selected: null };
    // Silent on failure: without the list the service edits the centre-most face, which is
    // exactly the dialog as it was before the picker existed.
    getEditFaces(uri)
      .then((f) => {
        if (openFor.current !== uri) return;
        const sel = initialFace(f);
        setFaces(f);
        setSelectedFace(sel);
        face.current = { faces: f, selected: sel };
      })
      .catch((e) => console.warn("Image Edit: face list unavailable, editing the default face:", e));
    setPreview(null);
    setPreset(null);
    setError("");
    setSaved([]);
    setPromptText("");
    setPromptNote("");
    setDescribed(null);
    setYaw(0);
    setPitch(0);
    setJob(null);
    setActive("face");
    getEditPresets()
      .then((p) => {
        setAxes(p.axes);
        setPresets(p.presets);
        setHeadAngles(p.head_angles ?? []);
        setFaceLimit(p.face_limit_deg ?? FACE_LIMIT_DEG);
        setMaxYaw(p.max_yaw ?? 90);
        setMaxPitch(p.max_pitch ?? 45);
        const v = neutralValues(p.axes);
        setValues(v);
        current.current = v;
        latest.current = { kind: "values", values: v };
      })
      .catch((e) => setError(apiError(e, "Could not load the edit presets")));
    if (!fixedDatasetId) {
      listDatasets().then(setDatasets).catch(() => setDatasets([]));
    }
  }, [open, uri, fixedDatasetId]);

  const runPreview = useCallback(async () => {
    if (!uri) return;
    if (inFlight.current) {
      dirty.current = true;
      return;
    }
    const req = latest.current;
    const body = previewBody(uri, req, faceChoice(face.current.faces, face.current.selected));
    if (!body) {
      setPreview(null);
      return;
    }
    inFlight.current = true;
    dirty.current = false;
    setPreviewing(true);
    setError("");
    setPromptNote("");
    const forUri = uri;
    try {
      const p = await previewImageEdit(body);
      // Dropped if the dialog moved on to another image meanwhile, or if the input changed
      // again: the follow-up preview below will replace it anyway. A description is dropped
      // on ANY newer input, even a drag not yet released: it would move sliders the user has
      // touched since.
      const superseded = dirty.current || (req.kind === "prompt" && latest.current !== req);
      if (openFor.current === forUri && !superseded) {
        setPreview(p);
        if (req.kind === "prompt") {
          const v = valuesFromExpression(axes, p.expression ?? p.params);
          setValues(v);
          current.current = v;
          setPreset(null);
          setDescribed({ text: req.text.trim(), terms: p.matched_terms ?? [], values: v });
        }
      }
    } catch (e) {
      if (openFor.current === forUri && !dirty.current) {
        const msg = apiError(e, "Preview failed");
        const unknown = req.kind === "prompt" ? unknownTermsMessage(msg) : null;
        if (unknown) setPromptNote(unknown);
        else setError(msg);
      }
    } finally {
      inFlight.current = false;
      setPreviewing(false);
      if (dirty.current && openFor.current === forUri) void runPreview();
    }
  }, [uri, axes]);

  // Poll a full-mode job until it lands. Every 3 s: the wait is minutes when the 3090 is
  // finishing a render, and seconds once it is editing. Stops when the dialog moves on.
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

  const angleRoute = routeAngle(yaw, pitch, faceLimit);

  // A head angle within LivePortrait's reach is just a face edit: its sliders, its preview.
  const applyAngle = (y: number, p: number) => {
    if (routeAngle(y, p, faceLimit) === "face") {
      const v = faceValuesForAngle(axes, y, p);
      setPreset(null);
      setValues(v);
      setDescribed(null);
      current.current = v;
      latest.current = { kind: "values", values: v };
      setActive("face");
      void runPreview();
    } else {
      // Qwen: not run until asked -- it may cost the render queue a mode switch.
      setActive("full");
    }
  };

  const chooseHeadAngle = (p: HeadAnglePreset) => {
    setYaw(p.yaw);
    setPitch(p.pitch);
    applyAngle(p.yaw, p.pitch);
  };

  const runFull = async () => {
    if (!uri) return;
    const body = fullAngleBody(uri, yaw, pitch, headAngles);
    if (!body) return;
    setStarting(true);
    setError("");
    setActive("full");
    try {
      setJob(await startFullEdit(body));
    } catch (e) {
      setError(apiError(e, "Could not start the full-mode edit"));
    } finally {
      setStarting(false);
    }
  };

  const chooseFace = (index: number) => {
    if (index === selectedFace) return;
    setSelectedFace(index);
    face.current = { ...face.current, selected: index };
    // Re-preview whatever is on the sliders (or the description), now on this face.
    if (previewBody(uri ?? "", latest.current)) void runPreview();
    else setPreview(null);
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

  const choosePreset = (p: EditPreset) => {
    setActive("face");
    const v = applyPreset(axes, p);
    setPreset(p);
    setValues(v);
    setDescribed(null);
    setPromptNote("");
    current.current = v;
    latest.current = { kind: "values", values: v };
    void runPreview();
  };

  const moveSlider = (key: string, v: number) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    current.current = { ...current.current, [key]: v };
    latest.current = { kind: "values", values: current.current };
  };

  const describe = () => {
    setActive("face");
    const problem = promptProblem(promptText);
    if (problem) {
      setPromptNote(problem);
      return;
    }
    latest.current = { kind: "prompt", text: promptText };
    void runPreview();
  };

  const reset = () => {
    setActive("face");
    setYaw(0);
    setPitch(0);
    const v = neutralValues(axes);
    setPreset(null);
    setValues(v);
    setDescribed(null);
    setPromptNote("");
    current.current = v;
    latest.current = { kind: "values", values: v };
    setPreview(null);
  };

  const target = dataset ?? datasets.find((d) => d.id === targetId) ?? null;
  const targetProblem = datasetSaveProblem(target);
  const edited = hasEdit(values);
  const fullDone = job?.state === "done";
  const canSave = active === "full" ? fullDone : edited;
  const stillDescribed = Boolean(described) && matchesPreset(values, { expression: described!.values });

  const save = async (toDataset: boolean) => {
    if (!uri || !canSave) return;
    setSaving(true);
    setError("");
    if (active === "full" && job) {
      try {
        const result = await saveEditJob(job.id, toDataset && target ? target.id : null);
        setSaved((prev) => [result, ...prev]);
        onSaved(result);
      } catch (e) {
        setError(apiError(e, "Save failed"));
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      const result = await saveImageEdit({
        source_uri: uri,
        mode: "face",
        // Named only while the sliders still say exactly what the preset said; a tweaked
        // preset is a custom edit, and the file name should not claim otherwise.
        preset: matchesPreset(values, preset) ? preset!.name : null,
        // Likewise a description: sent as text only while the sliders still hold exactly what
        // it resolved to (the service resolves it the same way again), so the record says
        // what was asked for. Fine-tuned, it is numbers.
        ...(stillDescribed
          ? { prompt: described!.text }
          : { expression: changedParams(values) }),
        dataset_id: toDataset && target ? target.id : null,
        // The face the preview showed: the save re-runs the edit, on the same face.
        ...faceChoice(faces, selectedFace),
      });
      setSaved((prev) => [result, ...prev]);
      onSaved(result);
    } catch (e) {
      setError(apiError(e, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const groups = groupAxes(axes);
  const slider = (a: EditAxis) => (
    <Box key={a.key} sx={{ px: 1 }}>
      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
        <Typography variant="caption">{a.label}</Typography>
        <Typography variant="caption" color="text.secondary">{values[a.key] ?? 0}</Typography>
      </Stack>
      <Slider
        size="small"
        min={a.min}
        max={a.max}
        step={a.step}
        value={values[a.key] ?? 0}
        disabled={saving}
        // A mark at zero: the face as it is. The slider's middle is not zero on every axis.
        marks={[{ value: 0 }]}
        onChange={(_, v) => moveSlider(a.key, clampToAxis(a, v as number))}
        onChangeCommitted={() => { setActive("face"); setPreset((p) => (matchesPreset(current.current, p) ? p : null)); void runPreview(); }}
        aria-label={a.label}
      />
    </Box>
  );

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

  const pane = (label: string, src: string | null, busy = false, note?: string, before = false) => (
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
              sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", opacity: busy ? 0.5 : 1 }} />
          : <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
              {note}
            </Typography>}
        {busy && <CircularProgress size={32} sx={{ position: "absolute" }} />}
        {before && overlay}
      </Box>
    </Box>
  );

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="lg" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Face /> Edit image
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Expression, gaze and small head turns (about ±20°). The face is warped, not
          regenerated, so it stays the same person. The original is never changed.
        </Typography>
        {uri && isEditedImage(uri) && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            This image is already an edit. Every pass re-decodes the face and loses skin texture —
            edit the original instead when you can.
            {picker.length > 0 && " Editing a different face from last time is fine: only the chosen face is re-decoded."}
          </Alert>
        )}
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        {/* At the top, not under the sliders: on a short screen the bottom of the content is
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
            {active === "full"
              ? pane(
                "After (full mode)",
                fullDone ? job?.preview ?? null : null,
                jobActive(job) || starting,
                job ? jobStatusLine(job) : "Run the head angle on the 3090 to see it here",
              )
              : pane(
                "After",
                preview?.image ?? null,
                previewing,
                previewing ? "Editing…" : "Describe the change, pick a preset or move a slider",
              )}
          </Stack>

          <Box sx={{ flex: 2, minWidth: 0 }}>
            <Typography variant="overline">Describe the change</Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
              <TextField
                size="small"
                fullWidth
                placeholder="big smile, eyes closed, look left"
                value={promptText}
                disabled={saving}
                onChange={(e) => { setPromptText(e.target.value); setPromptNote(""); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    describe();
                  }
                }}
                slotProps={{ htmlInput: { maxLength: MAX_PROMPT, "aria-label": "Describe the change" } }}
              />
              <Button
                variant="outlined"
                onClick={describe}
                disabled={saving || !promptText.trim()}
                startIcon={<Send />}
                sx={{ flexShrink: 0 }}
              >
                Preview
              </Button>
            </Stack>
            {promptNote && <Alert severity="info" sx={{ mt: 1 }}>{promptNote}</Alert>}
            {described && described.terms.length > 0 && (
              <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5, mt: 1 }}>
                <Typography variant="caption" color="text.secondary">Understood:</Typography>
                {described.terms.map((t) => <Chip key={t} size="small" label={t} color="primary" variant="outlined" />)}
                {!stillDescribed && (
                  <Typography variant="caption" color="text.secondary">(fine-tuned since)</Typography>
                )}
              </Box>
            )}
            {headAngles.length > 0 && (
              <>
                <Typography variant="overline" sx={{ display: "block", mt: 1 }}>Head angle</Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1 }}>
                  {headAngles.map((p) => (
                    <Tooltip key={p.name} title={p.route === "full"
                      ? "Full mode: Qwen on the 3090 regenerates the image"
                      : "Face mode: LivePortrait, instant"}>
                      <Button
                        size="small"
                        variant={yaw === p.yaw && pitch === p.pitch ? "contained" : "outlined"}
                        color={p.route === "full" ? "secondary" : "primary"}
                        disabled={saving}
                        onClick={() => chooseHeadAngle(p)}
                      >
                        {p.label}
                      </Button>
                    </Tooltip>
                  ))}
                </Box>
                {([["Turn (yaw)", yaw, setYaw, maxYaw], ["Tilt (pitch)", pitch, setPitch, maxPitch]] as const)
                  .map(([label, v, set, max]) => (
                    <Box key={label} sx={{ px: 1 }}>
                      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                        <Typography variant="caption">{label}</Typography>
                        <Typography variant="caption" color="text.secondary">{v}°</Typography>
                      </Stack>
                      <Slider
                        size="small" min={-max} max={max} step={5} value={v}
                        disabled={saving}
                        marks={[{ value: -faceLimit }, { value: 0 }, { value: faceLimit }]}
                        onChange={(_, nv) => set(nv as number)}
                        onChangeCommitted={(_, nv) => applyAngle(
                          label.startsWith("Turn") ? (nv as number) : yaw,
                          label.startsWith("Turn") ? pitch : (nv as number))}
                        aria-label={label}
                      />
                    </Box>
                  ))}
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 1 }}>
                  {describeAngle(yaw, pitch)} — left/right as the picture is seen.{" "}
                  {angleRoute === "face"
                    ? `Within ±${faceLimit}°: face mode (LivePortrait, instant).`
                    : "Beyond LivePortrait's reach: full mode (Qwen on the 3090)."}
                </Typography>
                {angleRoute === "full" && (
                  <>
                    <Alert severity="warning" sx={{ mt: 1 }}>{FULL_MODE_WARNING}</Alert>
                    <Button
                      sx={{ mt: 1 }}
                      variant="contained"
                      color="secondary"
                      startIcon={starting ? <CircularProgress size={16} /> : <PlayArrow />}
                      disabled={saving || starting || jobActive(job) || !fullAngleBody(uri ?? "", yaw, pitch)}
                      onClick={() => void runFull()}
                    >
                      Run on the 3090
                    </Button>
                  </>
                )}
                {active === "full" && job && (
                  <Typography variant="body2" color={job.state === "failed" ? "error" : "text.secondary"} sx={{ mt: 1 }}>
                    {jobStatusLine(job)}
                  </Typography>
                )}
                {active === "full" && fullDone && (() => {
                  const v = identityVerdict(job?.identity);
                  return <Alert severity={v.severity} sx={{ mt: 1 }}>{v.text}</Alert>;
                })()}
              </>
            )}
            <Typography variant="overline" sx={{ display: "block", mt: 1 }}>Presets</Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1 }}>
              {presets.map((p) => (
                <Button
                  key={p.name}
                  size="small"
                  variant={preset?.name === p.name ? "contained" : "outlined"}
                  disabled={saving}
                  onClick={() => choosePreset(p)}
                >
                  {p.label}
                </Button>
              ))}
            </Box>
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
              <Typography variant="overline">Adjust</Typography>
              <Button size="small" startIcon={<RestartAlt />} onClick={reset} disabled={saving || !edited}>
                Reset
              </Button>
            </Stack>
            {groups.main.map(slider)}
            {groups.gaze.map(slider)}
            {groups.more.length > 0 && (
              <>
                <Button size="small" onClick={() => setShowMore((v) => !v)}
                  endIcon={showMore ? <ExpandLess /> : <ExpandMore />}>
                  More
                </Button>
                <Collapse in={showMore}>{groups.more.map(slider)}</Collapse>
              </>
            )}
            {preview && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                Preview: {describeRun(preview)}
              </Typography>
            )}
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
        <Tooltip title={canSave ? (targetProblem ?? "") : "Nothing to save yet"}>
          <span>
            <Button
              onClick={() => save(true)}
              disabled={!canSave || saving || Boolean(targetProblem)}
            >
              {dataset ? `Save to ${dataset.name}` : "Save to dataset"}
            </Button>
          </span>
        </Tooltip>
        <Button
          variant="contained"
          onClick={() => save(false)}
          disabled={!canSave || saving}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          Save as new image
        </Button>
        <Button onClick={onClose} disabled={saving} sx={{ ml: "auto" }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
