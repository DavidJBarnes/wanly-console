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
import type { FaceswapConfigState } from "../lib/faceswapPayload";

export type { FaceswapConfigState };
import type { FaceswapPreset } from "../api/types";
import {
  DEFAULT_FACESWAP_METHOD,
  DEFAULT_FACESWAP_FACES_INDEX,
  DEFAULT_FACESWAP_SOURCE_TYPE,
  DEFAULT_FACESWAP_FACES_ORDER,
  DEFAULT_FACESWAP_MODEL,
  DEFAULT_FACESWAP_PIXEL_BOOST,
  FACESWAP_MODELS,
  FACESWAP_PIXEL_BOOSTS,
} from "../constants";


export function defaultFaceswapState(overrides?: Partial<FaceswapConfigState>): FaceswapConfigState {
  return {
    enabled: false,
    method: DEFAULT_FACESWAP_METHOD,
    sourceType: DEFAULT_FACESWAP_SOURCE_TYPE,
    file: null,
    presetUri: null,
    facesIndex: DEFAULT_FACESWAP_FACES_INDEX,
    facesOrder: DEFAULT_FACESWAP_FACES_ORDER,
    model: DEFAULT_FACESWAP_MODEL,
    pixelBoost: DEFAULT_FACESWAP_PIXEL_BOOST,
    seedFaceswap: false,
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
        {/* Independent of the whole-video swap: re-anchoring only touches the single frame
            that seeds the next segment. Both switches share the face source picker below. */}
        <FormControlLabel
          control={
            <Switch
              checked={state.seedFaceswap}
              onChange={(e) => update({ seedFaceswap: e.target.checked })}
            />
          }
          label="Re-anchor continuation seed"
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: -0.5, mb: 1 }}>
          Faceswaps this segment's last frame to the face below before it seeds the next
          segment, so identity does not drift across a continuation. Does not alter the video
          itself. Falls back to the raw frame when no face is detected.
        </Typography>
        {state.enabled && state.seedFaceswap && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block", mb: 1 }}>
            Both are on. The whole-video swap already swaps the frame the next segment seeds
            from, so re-anchoring swaps an already-swapped face a second time — redundant, and
            it can soften the result. Re-anchor is meant for when the video swap is off.
          </Typography>
        )}
        {(state.enabled || state.seedFaceswap) && (
          <Box sx={{ mt: 1 }}>
            {/* Method and face selection apply to BOTH swaps: the seed re-anchor runs the
                same node stack on one still. With two people in frame, faces order/index is
                what stops the swap landing on the wrong face. */}
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
            {/* FaceFusion-only knobs. Neither moved identity or face detail in testing
                (inswapper_128@512 vs hyperswap_1c_256@256: 0.910 vs 0.908 identity, 177.1 vs
                176.5 detail) — exposed because they are the levers for speckling on off-axis
                faces, which no metric here can see. */}
            {state.method === "facefusion" && (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 1 }}>
                <TextField
                  label="Swapper Model"
                  select
                  size="small"
                  value={state.model}
                  onChange={(e) => update({ model: e.target.value })}
                  sx={{ flex: 1, minWidth: 160 }}
                >
                  {FACESWAP_MODELS.map((m) => (
                    <MenuItem key={m} value={m}>{m}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Pixel Boost"
                  select
                  size="small"
                  value={state.pixelBoost}
                  onChange={(e) => update({ pixelBoost: e.target.value })}
                  sx={{ flex: 1, minWidth: 120 }}
                >
                  {FACESWAP_PIXEL_BOOSTS.map((b) => (
                    <MenuItem key={b} value={b}>{b}</MenuItem>
                  ))}
                </TextField>
              </Box>
            )}
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
            {/* start_frame is the default, but it is disabled until a starting image exists.
                Say so rather than rendering an empty panel under a greyed-out selection. */}
            {state.sourceType === "start_frame" && (
              <Typography variant="caption" color={disableStartFrame ? "warning.main" : "text.secondary"}
                sx={{ display: "block", mb: 1 }}>
                {disableStartFrame
                  ? "Choose a starting image first — the swap uses it as the face."
                  : "Using the job's starting image as the face. This is what identity is scored against."}
              </Typography>
            )}
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
        {state.enabled ? `ON — ${state.method}` : state.seedFaceswap ? "seed re-anchor only" : "OFF"}
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
