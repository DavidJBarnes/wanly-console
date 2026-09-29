import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent,
  DialogTitle, MenuItem, Slider, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import { ExpandLess, ExpandMore, Face, RestartAlt, Send } from "@mui/icons-material";

import {
  getEditPresets, getFileUrl, listDatasets, previewImageEdit, saveImageEdit,
} from "../api/client";
import type { Dataset, EditAxis, EditPreset, ImageEditPreview, ImageEditResult } from "../api/types";
import { useIsMobile } from "../hooks/useIsMobile";
import { apiError } from "../lib/apiError";
import {
  applyPreset, changedParams, clampToAxis, datasetChoices, datasetSaveProblem, describeRun,
  groupAxes, hasEdit, isEditedImage, matchesPreset, MAX_PROMPT, neutralValues, previewBody,
  promptProblem, savedName, unknownTermsMessage, valuesFromExpression,
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

  // The slider values as of the last change, readable from callbacks without a re-render.
  const current = useRef<EditValues>({});
  // Coalescing: what the NEXT preview should send, and whether one is running.
  const latest = useRef<PreviewRequest>({ kind: "values", values: {} });
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const openFor = useRef<string | null>(null);

  // By id, not by object: saving to the dataset refreshes the parent's copy of it, and a new
  // object must not reset the dialog mid-session (and wipe the "Saved ..." list).
  const fixedDatasetId = dataset?.id ?? null;
  useEffect(() => {
    if (!open || !sourceUri) return;
    openFor.current = sourceUri;
    setPreview(null);
    setPreset(null);
    setError("");
    setSaved([]);
    setPromptText("");
    setPromptNote("");
    setDescribed(null);
    getEditPresets()
      .then((p) => {
        setAxes(p.axes);
        setPresets(p.presets);
        const v = neutralValues(p.axes);
        setValues(v);
        current.current = v;
        latest.current = { kind: "values", values: v };
      })
      .catch((e) => setError(apiError(e, "Could not load the edit presets")));
    if (!fixedDatasetId) {
      listDatasets().then(setDatasets).catch(() => setDatasets([]));
    }
  }, [open, sourceUri, fixedDatasetId]);

  const runPreview = useCallback(async () => {
    if (!sourceUri) return;
    if (inFlight.current) {
      dirty.current = true;
      return;
    }
    const req = latest.current;
    const body = previewBody(sourceUri, req);
    if (!body) {
      setPreview(null);
      return;
    }
    inFlight.current = true;
    dirty.current = false;
    setPreviewing(true);
    setError("");
    setPromptNote("");
    const uri = sourceUri;
    try {
      const p = await previewImageEdit(body);
      // Dropped if the dialog moved on to another image meanwhile, or if the input changed
      // again: the follow-up preview below will replace it anyway. A description is dropped
      // on ANY newer input, even a drag not yet released: it would move sliders the user has
      // touched since.
      const superseded = dirty.current || (req.kind === "prompt" && latest.current !== req);
      if (openFor.current === uri && !superseded) {
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
      if (openFor.current === uri && !dirty.current) {
        const msg = apiError(e, "Preview failed");
        const unknown = req.kind === "prompt" ? unknownTermsMessage(msg) : null;
        if (unknown) setPromptNote(unknown);
        else setError(msg);
      }
    } finally {
      inFlight.current = false;
      setPreviewing(false);
      if (dirty.current && openFor.current === uri) void runPreview();
    }
  }, [sourceUri, axes]);

  const choosePreset = (p: EditPreset) => {
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
    const problem = promptProblem(promptText);
    if (problem) {
      setPromptNote(problem);
      return;
    }
    latest.current = { kind: "prompt", text: promptText };
    void runPreview();
  };

  const reset = () => {
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
  const stillDescribed = Boolean(described) && matchesPreset(values, { expression: described!.values });

  const save = async (toDataset: boolean) => {
    if (!sourceUri || !edited) return;
    setSaving(true);
    setError("");
    try {
      const result = await saveImageEdit({
        source_uri: sourceUri,
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
        onChangeCommitted={() => { setPreset((p) => (matchesPreset(current.current, p) ? p : null)); void runPreview(); }}
        aria-label={a.label}
      />
    </Box>
  );

  const pane = (label: string, src: string | null, busy = false, note?: string) => (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Box sx={{
        position: "relative", bgcolor: "action.hover", borderRadius: 1, overflow: "hidden",
        height: isMobile ? 260 : 440, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {src
          ? <Box component="img" src={src} alt={label}
              sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", opacity: busy ? 0.5 : 1 }} />
          : <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
              {note}
            </Typography>}
        {busy && <CircularProgress size={32} sx={{ position: "absolute" }} />}
      </Box>
    </Box>
  );

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="lg" fullWidth fullScreen={isMobile}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Face /> Edit image — face
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Expression, gaze and small head turns (about ±20°). The face is warped, not
          regenerated, so it stays the same person. The original is never changed.
        </Typography>
        {sourceUri && isEditedImage(sourceUri) && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            This image is already an edit. Every pass re-decodes the face and loses skin texture —
            edit the original instead when you can.
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
          </Alert>
        )}

        <Stack direction={isMobile ? "column" : "row"} spacing={2}>
          <Stack direction="row" spacing={1} sx={{ flex: 3, minWidth: 0 }}>
            {pane("Before", sourceUri ? getFileUrl(sourceUri) : null)}
            {pane(
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
        <Tooltip title={edited ? (targetProblem ?? "") : "Nothing to save yet"}>
          <span>
            <Button
              onClick={() => save(true)}
              disabled={!edited || saving || Boolean(targetProblem)}
            >
              {dataset ? `Save to ${dataset.name}` : "Save to dataset"}
            </Button>
          </span>
        </Tooltip>
        <Button
          variant="contained"
          onClick={() => save(false)}
          disabled={!edited || saving}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          Save as new image
        </Button>
        <Button onClick={onClose} disabled={saving} sx={{ ml: "auto" }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
