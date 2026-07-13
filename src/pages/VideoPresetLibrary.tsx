import { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  Chip,
  Stack,
} from "@mui/material";
import { Add, Edit, DeleteOutline } from "@mui/icons-material";
import { useVideoPresetStore } from "../stores/videoPresetStore";
import { createVideoPreset, updateVideoPreset, deleteVideoPreset } from "../api/client";
import type { VideoSettingsPreset, VideoSettingsPresetCreate } from "../api/types";

type ParamKey =
  | "lightx2v_strength_high"
  | "lightx2v_strength_low"
  | "cfg_high"
  | "cfg_low"
  | "steps_total"
  | "high_noise_steps"
  | "flow_shift";

const FIELDS: { key: ParamKey; label: string }[] = [
  { key: "lightx2v_strength_high", label: "LightX2V High" },
  { key: "lightx2v_strength_low", label: "LightX2V Low" },
  { key: "cfg_high", label: "CFG High" },
  { key: "cfg_low", label: "CFG Low" },
  { key: "steps_total", label: "Steps Total" },
  { key: "high_noise_steps", label: "High-Noise Steps" },
  { key: "flow_shift", label: "Flow Shift" },
];

type FormState = Record<string, string>;

function emptyForm(): FormState {
  const f: FormState = { name: "" };
  FIELDS.forEach((x) => (f[x.key] = ""));
  return f;
}

function presetToForm(p: VideoSettingsPreset): FormState {
  const f: FormState = { name: p.name };
  FIELDS.forEach((x) => (f[x.key] = p[x.key] == null ? "" : String(p[x.key])));
  return f;
}

export default function VideoPresetLibrary() {
  const { presets, loading, error, fetchPresets } = useVideoPresetStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VideoSettingsPreset | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<VideoSettingsPreset | null>(null);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormError(null);
    setDialogOpen(true);
  };
  const openEdit = (p: VideoSettingsPreset) => {
    setEditing(p);
    setForm(presetToForm(p));
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError("Name is required");
      return;
    }
    setSaving(true);
    setFormError(null);
    const body: VideoSettingsPresetCreate = { name: form.name.trim() };
    FIELDS.forEach((x) => {
      const v = form[x.key].trim();
      body[x.key] = v === "" ? null : Number(v);
    });
    try {
      if (editing) await updateVideoPreset(editing.id, body);
      else await createVideoPreset(body);
      setDialogOpen(false);
      await fetchPresets();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFormError(detail || (e instanceof Error ? e.message : "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    await deleteVideoPreset(deleteConfirm.id);
    setDeleteConfirm(null);
    await fetchPresets();
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
        <Typography variant="h5">Video Presets</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={openNew}>
          New Preset
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Named bundles of sampler settings. Choose one per-job (default) or per-segment (override) —
        edits apply to future runs of anything using the preset.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? (
        <CircularProgress />
      ) : (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
          {presets.map((p) => (
            <Card key={p.id} sx={{ width: 340 }}>
              <CardContent>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="subtitle1" fontWeight={600}>{p.name}</Typography>
                  <Box>
                    <IconButton size="small" onClick={() => openEdit(p)}>
                      <Edit fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => setDeleteConfirm(p)}>
                      <DeleteOutline fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
                <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 1 }}>
                  {FIELDS.map((x) => (
                    <Chip key={x.key} size="small" label={`${x.label}: ${p[x.key] ?? "—"}`} />
                  ))}
                </Stack>
              </CardContent>
            </Card>
          ))}
          {presets.length === 0 && (
            <Typography color="text.secondary" sx={{ p: 2 }}>No presets yet.</Typography>
          )}
        </Box>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? "Edit Preset" : "New Preset"}</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <TextField
            label="Name"
            fullWidth
            size="small"
            sx={{ mt: 1, mb: 2 }}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            {FIELDS.map((x) => (
              <TextField
                key={x.key}
                label={x.label}
                type="number"
                size="small"
                sx={{ width: 150 }}
                value={form[x.key]}
                onChange={(e) => setForm({ ...form, [x.key]: e.target.value })}
              />
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <DialogTitle>Delete preset?</DialogTitle>
        <DialogContent>
          Delete “{deleteConfirm?.name}”? Jobs/segments using it fall back to their raw settings.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
