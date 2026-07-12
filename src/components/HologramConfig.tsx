import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Slider,
  Typography,
} from "@mui/material";
import type { HologramRequest } from "../api/types";

export default function HologramConfig({
  open,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: HologramRequest) => void;
  busy?: boolean;
}) {
  const [height, setHeight] = useState(1.7);
  const [keyColor, setKeyColor] = useState("0x00b140");

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Make Hologram</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Matte this clip’s subject off its (green) background and pack it as a color+alpha
          hologram you can place life-size in your room on the Quest 3.
        </Typography>
        <Typography gutterBottom>Subject height: {height.toFixed(2)} m</Typography>
        <Slider
          value={height}
          min={0.3}
          max={2.5}
          step={0.05}
          onChange={(_, v) => setHeight(v as number)}
          valueLabelDisplay="auto"
        />
        <TextField
          label="Key color"
          value={keyColor}
          onChange={(e) => setKeyColor(e.target.value)}
          fullWidth
          size="small"
          sx={{ mt: 2 }}
          helperText="Hex like 0x00b140 — the background the clip was generated on."
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => onSubmit({ subject_height_m: height, key_color: keyColor })}
        >
          {busy ? "Starting…" : "Make Hologram"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
