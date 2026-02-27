import { useEffect, useState, useCallback } from "react";
import {
  Autocomplete,
  Box,
  Typography,
  Card,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Switch,
  FormControlLabel,
  Alert,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { ClearOutlined } from "@mui/icons-material";
import { useLoraStore } from "../stores/loraStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTagStore } from "../stores/tagStore";
import { createJob, getFileUrl, getFaceswapPresets } from "../api/client";
import type { JobCreate, LoraListItem, FaceswapPreset } from "../api/types";

interface CreateJobDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  initialStartingImage?: File | null;
}

export default function CreateJobDialog({
  open,
  onClose,
  onCreated,
  initialStartingImage,
}: CreateJobDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const { defaultLightx2vHigh, defaultLightx2vLow } = useSettingsStore();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(640);
  const [fps, setFps] = useState(30);
  const [duration, setDuration] = useState(5.0);
  const [speed, setSpeed] = useState(1.0);
  const [seed, setSeed] = useState("");
  const [lightx2vHigh, setLightx2vHigh] = useState(defaultLightx2vHigh);
  const [lightx2vLow, setLightx2vLow] = useState(defaultLightx2vLow);
  const [startingImage, setStartingImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [faceswapEnabled, setFaceswapEnabled] = useState(true);
  const [faceswapSourceType, setFaceswapSourceType] = useState<"upload" | "preset" | "start_frame">("preset");
  const [faceswapImage, setFaceswapImage] = useState<File | null>(null);
  const [faceswapPresetUri, setFaceswapPresetUri] = useState<string | null>(null);
  const [faceswapPresets, setFaceswapPresets] = useState<FaceswapPreset[]>([]);
  const [faceswapMethod, setFaceswapMethod] = useState("reactor");
  const [faceswapFacesIndex, setFaceswapFacesIndex] = useState("0");
  const [faceswapFacesOrder, setFaceswapFacesOrder] = useState("left-right");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Tag state
  const { titleTags1, titleTags2, fetchTags } = useTagStore();
  const [selectedTag1, setSelectedTag1] = useState("");
  const [selectedTag2, setSelectedTag2] = useState("");
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);

  // Auto-generate name from tags + fps
  useEffect(() => {
    if (nameManuallyEdited) return;
    const parts = [selectedTag1, selectedTag2, `${fps}fps`].filter(Boolean);
    if (selectedTag1 || selectedTag2) {
      setName(parts.join("_"));
    }
  }, [selectedTag1, selectedTag2, fps, nameManuallyEdited]);

  // LoRA state
  const { loras: loraLibrary, fetchLoras } = useLoraStore();
  const [loras, setLoras] = useState<
    { lora_id: string; name: string; high_weight: number; low_weight: number; preview_image: string | null }[]
  >([]);

  useEffect(() => {
    if (open) {
      fetchLoras();
      fetchTags();
      getFaceswapPresets().then((presets) => {
        setFaceswapPresets(presets);
        const kelly = presets.find((p) => p.name.toLowerCase() === "kelly_young.safetensors" || p.key.toLowerCase() === "kelly_young.safetensors.png");
        if (kelly && !faceswapPresetUri) setFaceswapPresetUri(kelly.url);
      }).catch(() => {});
    }
  }, [open, fetchLoras, fetchTags]);

  // Apply initialStartingImage when dialog opens
  useEffect(() => {
    if (open && initialStartingImage) {
      setStartingImage(initialStartingImage);
      const url = URL.createObjectURL(initialStartingImage);
      setImagePreview(url);
      const img = new window.Image();
      img.onload = () => {
        setWidth(img.naturalWidth);
        setHeight(img.naturalHeight);
      };
      img.src = url;
    }
  }, [open, initialStartingImage]);

  const addLoraFromLibrary = (item: LoraListItem | null) => {
    if (!item || loras.length >= 3) return;
    if (loras.some((l) => l.lora_id === item.id)) return;
    setLoras([
      ...loras,
      {
        lora_id: item.id,
        name: item.name,
        high_weight: item.high_file ? item.default_high_weight : 0,
        low_weight: item.low_file ? item.default_low_weight : 0,
        preview_image: item.preview_image,
      },
    ]);
    if (item.default_prompt) {
      setPrompt((prev) =>
        prev.trim() ? `${prev.trim()}, ${item.default_prompt}` : item.default_prompt!,
      );
    }
  };

  const updateLoraWeight = (idx: number, field: string, value: number) => {
    const updated = [...loras];
    updated[idx] = { ...updated[idx], [field]: value };
    setLoras(updated);
  };

  const removeLora = (idx: number) => {
    setLoras(loras.filter((_, i) => i !== idx));
  };

  const resetForm = useCallback(() => {
    setName("");
    setPrompt("");
    setWidth(640);
    setHeight(640);
    setFps(30);
    setDuration(5.0);
    setSpeed(1.0);
    setSeed("");
    setLightx2vHigh(defaultLightx2vHigh);
    setLightx2vLow(defaultLightx2vLow);
    setStartingImage(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setFaceswapEnabled(true);
    setFaceswapSourceType("preset");
    setFaceswapImage(null);
    setFaceswapPresetUri(null);
    setFaceswapMethod("reactor");
    setFaceswapFacesIndex("0");
    setFaceswapFacesOrder("left-right");
    setLoras([]);
    setSelectedTag1("");
    setSelectedTag2("");
    setNameManuallyEdited(false);
    setError("");
  }, [imagePreview, defaultLightx2vHigh, defaultLightx2vLow]);

  const handleSubmit = async () => {
    if (!name.trim() || !prompt.trim()) {
      setError("Name and prompt are required");
      return;
    }
    if (!startingImage) {
      setError("Starting image is required");
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const jobData: JobCreate = {
        name: name.trim(),
        width,
        height,
        fps,
        seed: seed ? parseInt(seed) : null,
        lightx2v_strength_high: lightx2vHigh && parseFloat(lightx2vHigh) !== 2.0 ? parseFloat(lightx2vHigh) : null,
        lightx2v_strength_low: lightx2vLow && parseFloat(lightx2vLow) !== 1.0 ? parseFloat(lightx2vLow) : null,
        first_segment: {
          prompt: prompt.trim(),
          duration_seconds: duration,
          speed,
          loras:
            loras.length > 0
              ? loras.map((l) => ({
                  lora_id: l.lora_id,
                  high_weight: l.high_weight,
                  low_weight: l.low_weight,
                }))
              : null,
          faceswap_enabled: faceswapEnabled,
          faceswap_method: faceswapEnabled ? faceswapMethod : null,
          faceswap_source_type: faceswapEnabled ? faceswapSourceType : null,
          faceswap_image: faceswapEnabled && faceswapSourceType === "preset" ? faceswapPresetUri : null,
          faceswap_faces_index: faceswapEnabled ? faceswapFacesIndex : null,
          faceswap_faces_order: faceswapEnabled ? faceswapFacesOrder : null,
        },
      };

      const formData = new FormData();
      formData.append("data", JSON.stringify(jobData));
      formData.append("starting_image", startingImage);
      if (faceswapEnabled && faceswapSourceType === "upload" && faceswapImage) {
        formData.append("faceswap_image", faceswapImage);
      }
      if (faceswapEnabled && faceswapSourceType === "start_frame" && startingImage) {
        formData.append("faceswap_image", startingImage);
      }

      await createJob(formData);
      resetForm();
      onCreated();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to create job",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle>Create New Job</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
            {error}
          </Alert>
        )}
        {(titleTags1.length > 0 || titleTags2.length > 0) && (
          <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
            {titleTags1.length > 0 && (
              <TextField
                label="Title Tag 1"
                select
                value={selectedTag1}
                onChange={(e) => {
                  setSelectedTag1(e.target.value);
                  setNameManuallyEdited(false);
                }}
                sx={{ flex: 1 }}
                size="small"
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {titleTags1.map((tag) => (
                  <MenuItem key={tag.id} value={tag.name}>
                    {tag.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {titleTags2.length > 0 && (
              <TextField
                label="Title Tag 2"
                select
                value={selectedTag2}
                onChange={(e) => {
                  setSelectedTag2(e.target.value);
                  setNameManuallyEdited(false);
                }}
                sx={{ flex: 1 }}
                size="small"
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {titleTags2.map((tag) => (
                  <MenuItem key={tag.id} value={tag.name}>
                    {tag.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Box>
        )}
        <TextField
          label="Job Name"
          fullWidth
          margin="normal"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameManuallyEdited(true);
          }}
          autoFocus
        />
        <TextField
          label="Prompt"
          fullWidth
          multiline
          rows={3}
          margin="normal"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: -1 }}>
          <IconButton
            size="small"
            onClick={() => setPrompt("")}
            disabled={!prompt}
            sx={{ color: "text.disabled", p: 0.25 }}
            title="Clear prompt"
          >
            <ClearOutlined sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 1 }}>
          <TextField
            label="Width"
            type="number"
            value={width}
            onChange={(e) => setWidth(parseInt(e.target.value) || 0)}
            sx={{ flex: 1, minWidth: 120 }}
          />
          <TextField
            label="Height"
            type="number"
            value={height}
            onChange={(e) => setHeight(parseInt(e.target.value) || 0)}
            sx={{ flex: 1, minWidth: 120 }}
          />
        </Box>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 2 }}>
          <TextField
            label="FPS"
            select
            value={fps}
            onChange={(e) => setFps(parseInt(e.target.value))}
            sx={{ flex: 1, minWidth: 100 }}
          >
            <MenuItem value={30}>30 fps</MenuItem>
            <MenuItem value={60}>60 fps</MenuItem>
          </TextField>
          <TextField
            label="Duration (sec)"
            type="number"
            value={duration}
            onChange={(e) => setDuration(parseFloat(e.target.value) || 0)}
            sx={{ flex: 1, minWidth: 120 }}
            slotProps={{ htmlInput: { step: 0.5, min: 1, max: 10 } }}
          />
          <TextField
            label="Speed"
            select
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            sx={{ flex: 1, minWidth: 100 }}
          >
            <MenuItem value={1.0}>1.0x</MenuItem>
            <MenuItem value={1.25}>1.25x</MenuItem>
            <MenuItem value={1.5}>1.5x</MenuItem>
            <MenuItem value={2.0}>2.0x</MenuItem>
          </TextField>
          <TextField
            label="Seed (optional)"
            type="number"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            sx={{ flex: 1, minWidth: 120 }}
          />
        </Box>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 2 }}>
          <TextField
            label="LightX2V High"
            type="number"
            value={lightx2vHigh}
            onChange={(e) => setLightx2vHigh(e.target.value)}
            sx={{ flex: 1, minWidth: 120 }}
            slotProps={{ htmlInput: { step: 0.1, min: 0 } }}
            helperText="Range: 1.0–5.6"
          />
          <TextField
            label="LightX2V Low"
            type="number"
            value={lightx2vLow}
            onChange={(e) => setLightx2vLow(e.target.value)}
            sx={{ flex: 1, minWidth: 120 }}
            slotProps={{ htmlInput: { step: 0.1, min: 0 } }}
            helperText="Range: 1.0–2.0"
          />
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Starting Image *
          </Typography>
          <Button variant="outlined" component="label">
            {startingImage ? startingImage.name : "Choose Image"}
            <input
              type="file"
              hidden
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setStartingImage(file);
                if (imagePreview) URL.revokeObjectURL(imagePreview);
                if (file) {
                  const url = URL.createObjectURL(file);
                  setImagePreview(url);
                  const img = new window.Image();
                  img.onload = () => {
                    setWidth(img.naturalWidth);
                    setHeight(img.naturalHeight);
                  };
                  img.src = url;
                } else {
                  setImagePreview(null);
                }
              }}
            />
          </Button>
          {imagePreview && (
            <Box component="img" src={imagePreview} alt="Starting image preview" sx={{ mt: 1, maxHeight: 120, borderRadius: 1, objectFit: "cover", display: "block" }} />
          )}
        </Box>

        {/* LoRA section */}
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            LoRAs
          </Typography>
          {loras.length < 3 && (
            <Autocomplete
              options={loraLibrary
                .filter((l) => !loras.some((s) => s.lora_id === l.id))
                .sort((a, b) => a.name.localeCompare(b.name))}
              getOptionLabel={(o) => o.name}
              onChange={(_, val) => {
                addLoraFromLibrary(val);
              }}
              value={null}
              renderOption={(props, option) => {
                const idx = (props as unknown as { "data-option-index": number })["data-option-index"];
                return (
                <Box
                  component="li"
                  {...props}
                  key={option.id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    bgcolor: idx % 2 === 0 ? "#f5f5f5" : "#ffffff",
                  }}
                >
                  {option.preview_image ? (
                    <Box
                      component="img"
                      src={getFileUrl(option.preview_image)}
                      alt=""
                      sx={{
                        width: 40,
                        height: 40,
                        objectFit: "cover",
                        borderRadius: 0.5,
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        bgcolor: "#eee",
                        borderRadius: 0.5,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <Box>
                    <Typography variant="body2">{option.name}</Typography>
                    {option.trigger_words && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                      >
                        {option.trigger_words}
                      </Typography>
                    )}
                  </Box>
                </Box>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  placeholder="Search LoRA library..."
                />
              )}
              size="small"
              blurOnSelect
              clearOnBlur
            />
          )}
          {loras.map((lora, idx) => (
            <Card key={lora.lora_id} variant="outlined" sx={{ p: 1.5, mt: 1 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  mb: 1,
                }}
              >
                {lora.preview_image ? (
                  <Box
                    component="img"
                    src={getFileUrl(lora.preview_image)}
                    alt=""
                    sx={{
                      width: 36,
                      height: 36,
                      objectFit: "cover",
                      borderRadius: 0.5,
                    }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: 36,
                      height: 36,
                      bgcolor: "#eee",
                      borderRadius: 0.5,
                    }}
                  />
                )}
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
                  {lora.name}
                </Typography>
                <Button
                  size="small"
                  color="error"
                  onClick={() => removeLora(idx)}
                >
                  Remove
                </Button>
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                <TextField
                  label="High Weight"
                  size="small"
                  type="number"
                  value={lora.high_weight}
                  onChange={(e) =>
                    updateLoraWeight(
                      idx,
                      "high_weight",
                      parseFloat(e.target.value),
                    )
                  }
                  disabled={!loraLibrary.find((l) => l.id === lora.lora_id)?.high_file}
                  sx={{ flex: 1, minWidth: 100 }}
                  slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
                />
                <TextField
                  label="Low Weight"
                  size="small"
                  type="number"
                  value={lora.low_weight}
                  onChange={(e) =>
                    updateLoraWeight(
                      idx,
                      "low_weight",
                      parseFloat(e.target.value),
                    )
                  }
                  disabled={!loraLibrary.find((l) => l.id === lora.lora_id)?.low_file}
                  sx={{ flex: 1, minWidth: 100 }}
                  slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
                />
              </Box>
            </Card>
          ))}
        </Box>

        {/* Faceswap section */}
        <Box sx={{ mt: 3 }}>
          <FormControlLabel
            control={
              <Switch
                checked={faceswapEnabled}
                onChange={(e) => setFaceswapEnabled(e.target.checked)}
              />
            }
            label="Enable Faceswap"
          />
          {faceswapEnabled && (
            <Box sx={{ mt: 1 }}>
              <TextField
                label="Method"
                select
                size="small"
                fullWidth
                value={faceswapMethod}
                onChange={(e) => setFaceswapMethod(e.target.value)}
                sx={{ mb: 1 }}
              >
                <MenuItem value="reactor">ReActor</MenuItem>
                <MenuItem value="facefusion">FaceFusion</MenuItem>
              </TextField>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 1 }}>
                <TextField
                  label="Faces Index"
                  size="small"
                  value={faceswapFacesIndex}
                  onChange={(e) => setFaceswapFacesIndex(e.target.value)}
                  sx={{ flex: 1, minWidth: 120 }}
                />
                <TextField
                  label="Faces Order"
                  size="small"
                  value={faceswapFacesOrder}
                  onChange={(e) => setFaceswapFacesOrder(e.target.value)}
                  sx={{ flex: 1, minWidth: 120 }}
                />
              </Box>
              <ToggleButtonGroup
                value={faceswapSourceType}
                exclusive
                onChange={(_e, v) => {
                  if (v === null) return;
                  setFaceswapSourceType(v);
                  if (v !== "upload") setFaceswapImage(null);
                  if (v !== "preset") setFaceswapPresetUri(null);
                }}
                size="small"
                fullWidth
                sx={{ mb: 1 }}
              >
                <ToggleButton value="upload">Upload</ToggleButton>
                <ToggleButton value="preset">Preset</ToggleButton>
                <ToggleButton value="start_frame" disabled={!startingImage}>
                  Start Frame
                </ToggleButton>
              </ToggleButtonGroup>
              {faceswapSourceType === "upload" && (
                <Button variant="outlined" size="small" component="label">
                  {faceswapImage ? faceswapImage.name : "Choose Faceswap Image"}
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={(e) =>
                      setFaceswapImage(e.target.files?.[0] ?? null)
                    }
                  />
                </Button>
              )}
              {faceswapSourceType === "preset" && (
                <TextField
                  label="Preset Face"
                  select
                  size="small"
                  fullWidth
                  value={faceswapPresetUri ?? ""}
                  onChange={(e) => setFaceswapPresetUri(e.target.value || null)}
                >
                  {faceswapPresets.map((p) => (
                    <MenuItem key={p.key} value={p.url}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box
                          component="img"
                          src={getFileUrl(p.url)}
                          alt={p.name}
                          sx={{
                            width: 32,
                            height: 32,
                            objectFit: "cover",
                            borderRadius: 0.5,
                          }}
                        />
                        <Typography variant="body2">{p.name}</Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Creating..." : "Create Job"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
