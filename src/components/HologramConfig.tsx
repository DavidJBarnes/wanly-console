import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { HologramRequest } from "../api/types";

export default function HologramConfig({
  open,
  onClose,
  onSubmit,
  busy,
  initialFlavor = "2d_matte",
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: HologramRequest) => void;
  busy?: boolean;
  initialFlavor?: string;
}) {
  const [height, setHeight] = useState(1.7);
  const [keyColor, setKeyColor] = useState("0x00b140");
  const [flavor, setFlavor] = useState(initialFlavor);

  // Reflect the current hologram's flavor each time the dialog opens (e.g. "Remake…").
  useEffect(() => {
    if (open) setFlavor(initialFlavor);
  }, [open, initialFlavor]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Make Hologram</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Matte this clip’s subject and pack it as a color+alpha hologram you can place life-size
          in your room on the Quest 3. Green-screen clips are chroma-keyed; any other background is
          matted automatically (RVM).
        </Typography>
        <Typography variant="subtitle2" gutterBottom>Flavor</Typography>
        <ToggleButtonGroup
          value={flavor}
          exclusive
          fullWidth
          size="small"
          onChange={(_, v) => v && setFlavor(v)}
          sx={{ mb: 1 }}
        >
          <ToggleButton value="2d_matte">2D Matte (flat)</ToggleButton>
          <ToggleButton value="2.5d_depth">2.5D Depth (parallax)</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {flavor === "2.5d_depth"
            ? "Adds head-motion parallax + volume via a depth-displaced mesh (front-view only; 3090-only, slower to build)."
            : "Flat photoreal standee — fastest, works from every angle but reads flat when you move."}
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
          helperText="Only used for green-screen clips (e.g. 0x00b140). Other backgrounds are matted automatically."
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => onSubmit({ subject_height_m: height, key_color: keyColor, flavor })}
        >
          {busy ? "Starting…" : "Make Hologram"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
