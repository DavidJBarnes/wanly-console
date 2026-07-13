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
  Autocomplete,
  MenuItem,
} from "@mui/material";
import { Add, Edit, DeleteOutline } from "@mui/icons-material";
import { useVideoPresetStore } from "../stores/videoPresetStore";
import { useLoraStore } from "../stores/loraStore";
import { createVideoPreset, updateVideoPreset, deleteVideoPreset, getFileUrl } from "../api/client";
import type { VideoSettingsPreset, VideoSettingsPresetCreate, LoraListItem } from "../api/types";
import { MAX_LORAS } from "../constants";
import SettingsSignature, { parseSignature } from "../components/SettingsSignature";

type LoraSlot = { lora_id: string; name: string; high_weight: number; low_weight: number; preview_image: string | null };

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

const SAMPLERS = ["euler", "dpmpp_2m", "dpmpp_sde", "dpmpp_2m_sde", "unipc", "res_multistep"];
const SCHEDULERS = ["simple", "normal", "karras", "beta", "sgm_uniform"];

function emptyForm(): FormState {
  const f: FormState = { name: "", sampler_name: "", scheduler: "" };
  FIELDS.forEach((x) => (f[x.key] = ""));
  return f;
}

function presetToForm(p: VideoSettingsPreset): FormState {
  const f: FormState = { name: p.name, sampler_name: p.sampler_name ?? "", scheduler: p.scheduler ?? "" };
  FIELDS.forEach((x) => (f[x.key] = p[x.key] == null ? "" : String(p[x.key])));
  return f;
}

export default function VideoPresetLibrary() {
  const { presets, loading, error, fetchPresets } = useVideoPresetStore();
  const { loras: loraLibrary, fetchLoras } = useLoraStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VideoSettingsPreset | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [loraSlots, setLoraSlots] = useState<LoraSlot[]>([]);
  const [sigInput, setSigInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<VideoSettingsPreset | null>(null);

  useEffect(() => {
    fetchPresets();
    fetchLoras();
  }, [fetchPresets, fetchLoras]);

  const loadLoraSlots = (p: VideoSettingsPreset | null) =>
    setLoraSlots(
      (p?.loras ?? []).map((l) => {
        const lib = loraLibrary.find((item) => item.id === l.lora_id);
        return {
          lora_id: l.lora_id,
          name: lib?.name ?? l.lora_id.slice(0, 8),
          high_weight: l.high_weight,
          low_weight: l.low_weight,
          preview_image: lib?.preview_image ?? null,
        };
      }),
    );

  const addLora = (item: LoraListItem | null) => {
    if (!item || loraSlots.length >= MAX_LORAS || loraSlots.some((l) => l.lora_id === item.id)) return;
    setLoraSlots([
      ...loraSlots,
      {
        lora_id: item.id,
        name: item.name,
        high_weight: item.default_high_weight,
        low_weight: item.default_low_weight,
        preview_image: item.preview_image,
      },
    ]);
  };
  const updateWeight = (idx: number, field: "high_weight" | "low_weight", value: number) =>
    setLoraSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  const removeLora = (idx: number) => setLoraSlots((prev) => prev.filter((_, i) => i !== idx));

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    loadLoraSlots(null);
    setSigInput("");
    setFormError(null);
    setDialogOpen(true);
  };
  const openEdit = (p: VideoSettingsPreset) => {
    setEditing(p);
    setForm(presetToForm(p));
    loadLoraSlots(p);
    setSigInput("");
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
    body.sampler_name = form.sampler_name || null;
    body.scheduler = form.scheduler || null;
    body.loras = loraSlots.map((l) => ({
      lora_id: l.lora_id,
      high_weight: l.high_weight,
      low_weight: l.low_weight,
    }));
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
                <Box sx={{ mt: 1 }}>
                  <SettingsSignature values={p} />
                </Box>
                {(p.loras?.length || p.sampler_name || p.scheduler) && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                    {p.loras?.length ? `${p.loras.length} LoRA${p.loras.length > 1 ? "s" : ""}` : ""}
                    {p.sampler_name ? ` · ${p.sampler_name}` : ""}
                    {p.scheduler ? `/${p.scheduler}` : ""}
                  </Typography>
                )}
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
          <TextField
            label="Quick set — paste a signature"
            fullWidth
            size="small"
            sx={{ mb: 2 }}
            value={sigInput}
            placeholder="1,1,3,1,8,4,5"
            helperText="Order: LX-H, LX-L, CFG-H, CFG-L, Steps, St-H, Flow  (commas, ·, or / all work)"
            onChange={(e) => {
              setSigInput(e.target.value);
              const parsed = parseSignature(e.target.value);
              if (parsed) {
                setForm((f) => {
                  const nf = { ...f };
                  Object.entries(parsed).forEach(([k, v]) => (nf[k] = String(v)));
                  return nf;
                });
              }
            }}
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

          <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
            <TextField
              select
              label="Sampler"
              size="small"
              sx={{ width: 190 }}
              value={form.sampler_name}
              onChange={(e) => setForm({ ...form, sampler_name: e.target.value })}
            >
              <MenuItem value="">(default — euler)</MenuItem>
              {SAMPLERS.map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Scheduler"
              size="small"
              sx={{ width: 190 }}
              value={form.scheduler}
              onChange={(e) => setForm({ ...form, scheduler: e.target.value })}
              helperText="VACE always uses unipc unless overridden"
            >
              <MenuItem value="">(default — simple)</MenuItem>
              {SCHEDULERS.map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </TextField>
          </Box>

          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
            LoRAs (optional)
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
            Part of the recipe. High weight = motion expert, Low weight = identity expert. When this
            preset is selected, these LoRAs are used (replacing per-segment LoRAs).
          </Typography>
          {loraSlots.length < MAX_LORAS && (
            <Autocomplete
              options={loraLibrary
                .filter((l) => !loraSlots.some((s) => s.lora_id === l.id))
                .sort((a, b) => a.name.localeCompare(b.name))}
              getOptionLabel={(o) => o.name}
              onChange={(_, val) => addLora(val)}
              value={null}
              renderInput={(params) => <TextField {...params} size="small" placeholder="Add a LoRA…" />}
              size="small"
              blurOnSelect
              clearOnBlur
            />
          )}
          {loraSlots.map((lora, idx) => (
            <Card key={lora.lora_id} variant="outlined" sx={{ p: 1.5, mt: 1 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                {lora.preview_image ? (
                  <Box
                    component="img"
                    src={getFileUrl(lora.preview_image)}
                    alt=""
                    sx={{ width: 36, height: 36, objectFit: "cover", borderRadius: 0.5 }}
                  />
                ) : (
                  <Box sx={{ width: 36, height: 36, bgcolor: "#eee", borderRadius: 0.5 }} />
                )}
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>{lora.name}</Typography>
                <Button size="small" color="error" onClick={() => removeLora(idx)}>Remove</Button>
              </Box>
              <Box sx={{ display: "flex", gap: 1 }}>
                <TextField
                  label="High (motion)"
                  type="number"
                  size="small"
                  sx={{ width: 150 }}
                  value={lora.high_weight}
                  onChange={(e) => updateWeight(idx, "high_weight", Number(e.target.value))}
                />
                <TextField
                  label="Low (identity)"
                  type="number"
                  size="small"
                  sx={{ width: 150 }}
                  value={lora.low_weight}
                  onChange={(e) => updateWeight(idx, "low_weight", Number(e.target.value))}
                />
              </Box>
            </Card>
          ))}
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
