import { useEffect, useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Slider,
  TextField,
  Typography,
} from "@mui/material";
import { ContentCut, Lock, LockOpen } from "@mui/icons-material";
import { getFileUrl, uploadImage } from "../api/client";
import type { ImageFile } from "../api/types";

interface PresetSize {
  label: string;
  sub?: string;
  width: number;
  height: number;
}

const PRESETS: PresetSize[] = [
  { label: "240 × 320",  width: 240,  height: 320  },
  { label: "480 × 640",  sub: "Feature Phone", width: 480,  height: 640  },
  { label: "600 × 800",  width: 600,  height: 800  },
  { label: "750 × 1000", sub: "iPhone 6 to 8",  width: 750,  height: 1000 },
  { label: "768 × 1024", sub: "Old Android",    width: 768,  height: 1024 },
  { label: "960 × 1280", width: 960,  height: 1280 },
];

interface Props {
  open: boolean;
  image: ImageFile | null;
  onClose: () => void;
  onSaved: () => void;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function cropAndResize(
  src: string,
  pixelCrop: Area,
  outW: number,
  outH: number,
): Promise<Blob> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D canvas context");
  ctx.drawImage(
    img,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0, outW, outH,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
      "image/png",
    ),
  );
}

export default function CropResizeDialog({ open, image, onClose, onSaved }: Props) {
  const [imageUrl, setImageUrl] = useState<string>("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<PresetSize | null>(null);
  const [customW, setCustomW] = useState("512");
  const [customH, setCustomH] = useState("512");
  const [aspectLocked, setAspectLocked] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustom = selectedPreset === null;

  const outputWidth = isCustom
    ? Math.max(1, parseInt(customW, 10) || 0)
    : selectedPreset.width;
  const outputHeight = isCustom
    ? Math.max(1, parseInt(customH, 10) || 0)
    : selectedPreset.height;
  const aspectRatio = outputWidth > 0 && outputHeight > 0
    ? outputWidth / outputHeight
    : undefined;

  useEffect(() => {
    if (!open || !image) return;
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setSelectedPreset(PRESETS[4]); // default: 768×1024
    setCustomW("512");
    setCustomH("512");
    setAspectLocked(true);
    setError(null);
    setImageUrl(getFileUrl(image.path));
  }, [open, image]);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleCustomWChange = (val: string) => {
    if (!/^\d*$/.test(val)) return;
    setCustomW(val);
    if (aspectLocked) {
      const w = parseInt(val, 10);
      const oldW = parseInt(customW, 10);
      const h = parseInt(customH, 10);
      if (w > 0 && oldW > 0 && h > 0) {
        setCustomH(String(Math.round(w / (oldW / h))));
      }
    }
  };

  const handleCustomHChange = (val: string) => {
    if (!/^\d*$/.test(val)) return;
    setCustomH(val);
    if (aspectLocked) {
      const w = parseInt(customW, 10);
      const h = parseInt(val, 10);
      const oldH = parseInt(customH, 10);
      if (w > 0 && h > 0 && oldH > 0) {
        setCustomW(String(Math.round(h / (oldH / w))));
      }
    }
  };

  const handleSave = async () => {
    if (!image || !croppedAreaPixels || outputWidth <= 0 || outputHeight <= 0) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await cropAndResize(
        getFileUrl(image.path),
        croppedAreaPixels,
        outputWidth,
        outputHeight,
      );
      const dotIdx = image.filename.lastIndexOf(".");
      const base = dotIdx >= 0 ? image.filename.slice(0, dotIdx) : image.filename;
      const newName = `${base}_crop_${outputWidth}x${outputHeight}.png`;
      const file = new File([blob], newName, { type: "image/png" });
      const slashIdx = image.key.lastIndexOf("/");
      const folder = slashIdx >= 0 ? image.key.substring(0, slashIdx) : image.key;
      await uploadImage(file, folder);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save cropped image");
    } finally {
      setSaving(false);
    }
  };

  const canSave =
    !!croppedAreaPixels && outputWidth > 0 && outputHeight > 0 && !saving;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      {image && (
        <>
          <DialogTitle sx={{ pb: 1 }}>
            Crop & Resize
            <Typography variant="body2" color="text.secondary">
              {image.filename}
            </Typography>
          </DialogTitle>

          <DialogContent sx={{ pt: 1 }}>
            <Box
              sx={{
                display: "flex",
                gap: 2,
                flexDirection: { xs: "column", md: "row" },
              }}
            >
              {/* Crop area */}
              <Box
                sx={{
                  flex: 1,
                  minHeight: { xs: 280, md: 460 },
                  position: "relative",
                  bgcolor: "grey.900",
                  borderRadius: 1,
                  overflow: "hidden",
                }}
              >
                {imageUrl && (
                  <Cropper
                    image={imageUrl}
                    crop={crop}
                    zoom={zoom}
                    aspect={aspectRatio}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={onCropComplete}
                  />
                )}
              </Box>

              {/* Controls */}
              <Box sx={{ width: { xs: "100%", md: 260 }, flexShrink: 0 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Output Size
                </Typography>

                <List dense disablePadding sx={{ border: 1, borderColor: "divider", borderRadius: 1, mb: 1 }}>
                  {PRESETS.map((p) => (
                    <ListItemButton
                      key={p.label}
                      selected={selectedPreset?.label === p.label}
                      onClick={() => setSelectedPreset(p)}
                      sx={{ py: 0.5 }}
                    >
                      <ListItemText
                        primary={p.label}
                        secondary={p.sub}
                        primaryTypographyProps={{ variant: "body2" }}
                        secondaryTypographyProps={{ variant: "caption" }}
                      />
                    </ListItemButton>
                  ))}
                  <ListItemButton
                    selected={isCustom}
                    onClick={() => setSelectedPreset(null)}
                    sx={{ py: 0.5 }}
                  >
                    <ListItemText
                      primary="Custom"
                      primaryTypographyProps={{ variant: "body2" }}
                    />
                  </ListItemButton>
                </List>

                {isCustom && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                    <TextField
                      label="W"
                      size="small"
                      value={customW}
                      onChange={(e) => handleCustomWChange(e.target.value)}
                      sx={{ width: 80 }}
                      inputProps={{ inputMode: "numeric" }}
                    />
                    <IconButton
                      size="small"
                      onClick={() => setAspectLocked((v) => !v)}
                      title={aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
                    >
                      {aspectLocked ? <Lock fontSize="small" /> : <LockOpen fontSize="small" />}
                    </IconButton>
                    <TextField
                      label="H"
                      size="small"
                      value={customH}
                      onChange={(e) => handleCustomHChange(e.target.value)}
                      sx={{ width: 80 }}
                      inputProps={{ inputMode: "numeric" }}
                    />
                  </Box>
                )}

                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                  Zoom
                </Typography>
                <Slider
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  onChange={(_, v) => setZoom(v as number)}
                  size="small"
                  sx={{ mb: 1 }}
                />

                <Typography variant="body2" color="text.secondary">
                  Output: {outputWidth} × {outputHeight} px
                </Typography>

                {error && (
                  <Alert severity="error" sx={{ mt: 1.5 }}>
                    {error}
                  </Alert>
                )}
              </Box>
            </Box>
          </DialogContent>

          <DialogActions>
            <Button onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={!canSave}
              startIcon={saving ? <CircularProgress size={16} /> : <ContentCut />}
            >
              {saving ? "Saving..." : "Save as New Image"}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
