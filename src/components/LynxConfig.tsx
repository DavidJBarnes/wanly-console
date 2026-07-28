import {
  Box,
  Slider,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { LYNX_ARMS, LYNX_DEFAULTS } from "../api/types";
import type { LynxSettings } from "../api/types";

/**
 * Lynx identity-preserving engine settings.
 *
 * Lynx runs Wan 2.1 T2V-14B with two adapters that re-assert identity at every
 * denoising step (unlike a character LoRA, which bakes it into the weights once):
 * an ID-adapter driven by an ArcFace embedding, and a Ref-adapter driven by dense
 * VAE features of the reference face.
 *
 * Note this is a text-to-video model conditioned on a subject image — NOT first-frame
 * i2v. The subject never appears as frame 0, which is why the image field is labelled
 * "subject image" rather than "starting image" when this engine is selected.
 */
export default function LynxConfig({
  value,
  onChange,
}: {
  value: LynxSettings;
  onChange: (next: LynxSettings) => void;
}) {
  const set = <K extends keyof LynxSettings>(key: K, v: LynxSettings[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Identity is re-applied at every denoising step from the subject image, rather than
        baked in like a character LoRA. Defaults are Kijai's reference values — treat them
        as a calibration starting point, not settled.
      </Typography>

      <Typography variant="subtitle2" gutterBottom>
        ID adapter strength (ip_scale): {value.ip_scale.toFixed(2)}
      </Typography>
      <Slider
        value={value.ip_scale}
        min={0}
        max={2}
        step={0.05}
        marks={[{ value: LYNX_DEFAULTS.ip_scale, label: "0.7" }]}
        onChange={(_, v) => set("ip_scale", v as number)}
        valueLabelDisplay="auto"
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        Controls <em>who the face is</em>. Pushing this high tends to freeze expression.
      </Typography>

      <Typography variant="subtitle2" gutterBottom>
        Reference adapter strength (ref_scale): {value.ref_scale.toFixed(2)}
      </Typography>
      <Slider
        value={value.ref_scale}
        min={0}
        max={2}
        step={0.05}
        marks={[{ value: LYNX_DEFAULTS.ref_scale, label: "0.6" }]}
        onChange={(_, v) => set("ref_scale", v as number)}
        valueLabelDisplay="auto"
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        Controls fine appearance — skin, hair, lighting. Too high drags the reference's own
        pose and lighting into the video.
      </Typography>

      <Typography variant="subtitle2" gutterBottom>
        Adapter arm
      </Typography>
      <ToggleButtonGroup
        value={value.arm}
        exclusive
        fullWidth
        size="small"
        onChange={(_, v) => v && set("arm", v as "lite" | "full")}
        sx={{ mb: 1 }}
      >
        <ToggleButton value="lite">{LYNX_ARMS.lite.label}</ToggleButton>
        <ToggleButton value="full">{LYNX_ARMS.full.label}</ToggleButton>
      </ToggleButtonGroup>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        {value.arm === "full"
          ? "Kijai's own note reports the full ip adapter as “very weak”. Kept as the A/B arm so it can be settled by measurement."
          : "Kijai's shipped combination (lite ip + full ref). The ip layers and resampler always switch together."}
      </Typography>

      <Typography variant="subtitle2" gutterBottom>
        Reference window: {value.start_percent.toFixed(2)} – {value.end_percent.toFixed(2)}
      </Typography>
      <Slider
        value={[value.start_percent, value.end_percent]}
        min={0}
        max={1}
        step={0.05}
        onChange={(_, v) => {
          const [start, end] = v as number[];
          onChange({ ...value, start_percent: start, end_percent: end });
        }}
        valueLabelDisplay="auto"
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        Fraction of the denoise over which the reference adapter applies. Narrowing the end
        (e.g. 0.60) frees the late steps from the reference — worth trying if identity holds
        but motion looks stiff.
      </Typography>

      <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
        <TextField
          label="Steps"
          type="number"
          size="small"
          value={value.steps}
          onChange={(e) => set("steps", parseInt(e.target.value, 10) || LYNX_DEFAULTS.steps)}
          fullWidth
        />
        <TextField
          label="CFG"
          type="number"
          size="small"
          value={value.cfg}
          onChange={(e) => set("cfg", parseFloat(e.target.value) || LYNX_DEFAULTS.cfg)}
          fullWidth
        />
        <TextField
          label="Shift"
          type="number"
          size="small"
          value={value.shift}
          onChange={(e) => set("shift", parseFloat(e.target.value) || LYNX_DEFAULTS.shift)}
          fullWidth
        />
      </Box>

      <TextField
        label="Reference blocks"
        size="small"
        fullWidth
        value={value.ref_blocks_to_use}
        onChange={(e) => set("ref_blocks_to_use", e.target.value)}
        placeholder="e.g. 0-20, 25, 35-39"
        helperText="Which DiT blocks receive the reference feature. Leave empty for all blocks."
      />
    </Box>
  );
}
