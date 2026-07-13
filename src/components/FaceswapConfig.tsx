import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Box,
  Typography,
  Button,
  TextField,
  MenuItem,
  Switch,
  FormControlLabel,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { ExpandMore } from "@mui/icons-material";
import { getFileUrl } from "../api/client";
import type { FaceswapPreset } from "../api/types";
import {
  DEFAULT_FACESWAP_METHOD,
  DEFAULT_FACESWAP_FACES_INDEX,
  DEFAULT_FACESWAP_FACES_ORDER,
} from "../constants";

export interface FaceswapConfigState {
  enabled: boolean;
  method: string;
  sourceType: "upload" | "preset" | "start_frame";
  file: File | null;
  presetUri: string | null;
  facesIndex: string;
  facesOrder: string;
}

export function defaultFaceswapState(overrides?: Partial<FaceswapConfigState>): FaceswapConfigState {
  return {
    enabled: false,
    method: DEFAULT_FACESWAP_METHOD,
    sourceType: "upload",
    file: null,
    presetUri: null,
    facesIndex: DEFAULT_FACESWAP_FACES_INDEX,
    facesOrder: DEFAULT_FACESWAP_FACES_ORDER,
    ...overrides,
  };
}

interface FaceswapConfigProps {
  state: FaceswapConfigState;
  onChange: (state: FaceswapConfigState) => void;
  presets: FaceswapPreset[];
  accordionSx?: object;
  defaultExpanded?: boolean;
  disableStartFrame?: boolean;
  existingImageName?: string | null;
  /** Render the controls inline (a labelled section) instead of wrapped in an Accordion. */
  inline?: boolean;
}

export default function FaceswapConfig({
  state,
  onChange,
  presets,
  accordionSx,
  defaultExpanded = false,
  disableStartFrame = false,
  existingImageName,
  inline = false,
}: FaceswapConfigProps) {
  const update = (patch: Partial<FaceswapConfigState>) =>
    onChange({ ...state, ...patch });

  const body = (
    <>
        <FormControlLabel
          control={
            <Switch
              checked={state.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
          }
          label="Enable Faceswap"
        />
        {state.enabled && (
          <Box sx={{ mt: 1 }}>
            <TextField
              label="Method"
              select
              size="small"
              fullWidth
              value={state.method}
              onChange={(e) => update({ method: e.target.value })}
              sx={{ mb: 1 }}
            >
              <MenuItem value="reactor">ReActor</MenuItem>
              <MenuItem value="facefusion">FaceFusion</MenuItem>
            </TextField>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 1 }}>
              <TextField
                label="Faces Index"
                size="small"
                value={state.facesIndex}
                onChange={(e) => update({ facesIndex: e.target.value })}
                sx={{ flex: 1, minWidth: 120 }}
              />
              <TextField
                label="Faces Order"
                size="small"
                select
                value={state.facesOrder}
                onChange={(e) => update({ facesOrder: e.target.value })}
                sx={{ flex: 1, minWidth: 120 }}
              >
                <MenuItem value="left-right">Left → Right</MenuItem>
                <MenuItem value="right-left">Right → Left</MenuItem>
                <MenuItem value="top-bottom">Top → Bottom</MenuItem>
                <MenuItem value="bottom-top">Bottom → Top</MenuItem>
                <MenuItem value="large-small">Large → Small</MenuItem>
                <MenuItem value="small-large">Small → Large</MenuItem>
              </TextField>
            </Box>
            <ToggleButtonGroup
              value={state.sourceType}
              exclusive
              onChange={(_e, v) => {
                if (v === null) return;
                const patch: Partial<FaceswapConfigState> = { sourceType: v };
                if (v !== "upload") patch.file = null;
                if (v !== "preset") patch.presetUri = null;
                update(patch);
              }}
              size="small"
              fullWidth
              sx={{ mb: 1 }}
            >
              <ToggleButton value="upload">Upload</ToggleButton>
              <ToggleButton value="preset">Preset</ToggleButton>
              <ToggleButton value="start_frame" disabled={disableStartFrame}>
                Start Frame
              </ToggleButton>
            </ToggleButtonGroup>
            {state.sourceType === "upload" && (
              <>
                <Button variant="outlined" size="small" component="label">
                  {state.file
                    ? state.file.name
                    : existingImageName
                      ? `Re-using: ${existingImageName}`
                      : "Choose Faceswap Image"}
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    onChange={(e) => update({ file: e.target.files?.[0] ?? null })}
                  />
                </Button>
                {state.file && existingImageName && (
                  <Button
                    size="small"
                    sx={{ ml: 1 }}
                    onClick={() => update({ file: null })}
                  >
                    Reset to existing
                  </Button>
                )}
              </>
            )}
            {state.sourceType === "preset" && (
              <TextField
                label="Preset Face"
                select
                size="small"
                fullWidth
                value={state.presetUri ?? ""}
                onChange={(e) => update({ presetUri: e.target.value || null })}
              >
                {presets.map((p) => (
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
    </>
  );

  const header = (
    <Typography variant="subtitle2">
      Faceswap
      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
        {state.enabled ? `ON — ${state.method}` : "OFF"}
      </Typography>
    </Typography>
  );

  if (inline) {
    return (
      <Box>
        <Box sx={{ mb: 1 }}>{header}</Box>
        {body}
      </Box>
    );
  }

  return (
    <Accordion defaultExpanded={defaultExpanded} disableGutters sx={accordionSx}>
      <AccordionSummary expandIcon={<ExpandMore />}>{header}</AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>{body}</AccordionDetails>
    </Accordion>
  );
}
