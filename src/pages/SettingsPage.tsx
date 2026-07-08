import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useTagStore } from "../stores/tagStore";
import { useSettingsStore } from "../stores/settingsStore";

export default function SettingsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { titleTags1, titleTags2, loading, fetchTags, addTag, removeTag } =
    useTagStore();
  const [input1, setInput1] = useState("");
  const [input2, setInput2] = useState("");
  const {
    defaultLightx2vHigh,
    defaultLightx2vLow,
    defaultCfgHigh,
    defaultCfgLow,
    defaultStepsTotal,
    defaultHighNoiseSteps,
    defaultFlowShift,
    negativePrompt,
    loaded,
    fetchSettings,
    saveSettings,
    setDefaultLightx2vHigh,
    setDefaultLightx2vLow,
    setDefaultCfgHigh,
    setDefaultCfgLow,
    setDefaultStepsTotal,
    setDefaultHighNoiseSteps,
    setDefaultFlowShift,
    setNegativePrompt,
  } = useSettingsStore();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetchTags();
    fetchSettings();
  }, [fetchTags, fetchSettings]);

  const handleAdd1 = () => {
    addTag(input1, 1);
    setInput1("");
  };

  const handleAdd2 = () => {
    addTag(input2, 2);
    setInput2("");
  };

  const handleSaveDefaults = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await saveSettings({
        lightx2v_strength_high: parseFloat(defaultLightx2vHigh) || 2.0,
        lightx2v_strength_low: parseFloat(defaultLightx2vLow) || 1.0,
        cfg_high: parseFloat(defaultCfgHigh) || 1,
        cfg_low: parseFloat(defaultCfgLow) || 1,
        steps_total: parseInt(defaultStepsTotal, 10) || 4,
        high_noise_steps: parseInt(defaultHighNoiseSteps, 10) || 2,
        flow_shift: parseFloat(defaultFlowShift) || 5,
        negative_prompt: negativePrompt,
      });
      setSaved(true);
    } catch (err) {
      console.error("Failed to save app settings:", err);
      const message =
        err instanceof Error ? err.message : "Failed to save settings. Please try again.";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Settings
      </Typography>
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Tags
          </Typography>
          {loading && titleTags1.length === 0 && titleTags2.length === 0 && (
            <Box sx={{ textAlign: "center", py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          <Box
            sx={{
              display: "flex",
              flexDirection: isMobile ? "column" : "row",
              gap: 3,
            }}
          >
            {/* Title Tag 1 */}
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Title Tag 1
              </Typography>
              <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
                <TextField
                  size="small"
                  placeholder="Add tag..."
                  value={input1}
                  onChange={(e) => setInput1(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAdd1();
                    }
                  }}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleAdd1}
                  disabled={!input1.trim()}
                >
                  Add
                </Button>
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {titleTags1.map((tag) => (
                  <Chip
                    key={tag.id}
                    label={tag.name}
                    onDelete={() => removeTag(tag.id)}
                    size="small"
                  />
                ))}
              </Box>
            </Box>

            {/* Title Tag 2 */}
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Title Tag 2
              </Typography>
              <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
                <TextField
                  size="small"
                  placeholder="Add tag..."
                  value={input2}
                  onChange={(e) => setInput2(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAdd2();
                    }
                  }}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleAdd2}
                  disabled={!input2.trim()}
                >
                  Add
                </Button>
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {titleTags2.map((tag) => (
                  <Chip
                    key={tag.id}
                    label={tag.name}
                    onDelete={() => removeTag(tag.id)}
                    size="small"
                  />
                ))}
              </Box>
            </Box>
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Job Defaults
          </Typography>
          {!loaded ? (
            <Box sx={{ textAlign: "center", py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <>
              <Box sx={{ display: "flex", gap: 2, maxWidth: 500, flexWrap: "wrap" }}>
                <TextField
                  label="LightX2V High"
                  type="number"
                  size="small"
                  value={defaultLightx2vHigh}
                  onChange={(e) => setDefaultLightx2vHigh(e.target.value)}
                  slotProps={{ htmlInput: { step: 0.1, min: 0 } }}
                  helperText="Range: 1.0–5.6"
                  sx={{ flex: 1, minWidth: 110 }}
                />
                <TextField
                  label="LightX2V Low"
                  type="number"
                  size="small"
                  value={defaultLightx2vLow}
                  onChange={(e) => setDefaultLightx2vLow(e.target.value)}
                  slotProps={{ htmlInput: { step: 0.1, min: 0 } }}
                  helperText="Range: 1.0–2.0"
                  sx={{ flex: 1, minWidth: 110 }}
                />
              </Box>
              <Box sx={{ display: "flex", gap: 2, maxWidth: 500, mt: 2, flexWrap: "wrap" }}>
                <TextField
                  label="CFG High"
                  type="number"
                  size="small"
                  value={defaultCfgHigh}
                  onChange={(e) => setDefaultCfgHigh(e.target.value)}
                  slotProps={{ htmlInput: { step: 0.5, min: 0 } }}
                  helperText="High noise sampler"
                  sx={{ flex: 1, minWidth: 110 }}
                />
                <TextField
                  label="CFG Low"
                  type="number"
                  size="small"
                  value={defaultCfgLow}
                  onChange={(e) => setDefaultCfgLow(e.target.value)}
                  slotProps={{ htmlInput: { step: 0.5, min: 0 } }}
                  helperText="Low noise sampler"
                  sx={{ flex: 1, minWidth: 110 }}
                />
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 2 }}>
                <TextField
                  label="Steps Total"
                  type="number"
                  size="small"
                  value={defaultStepsTotal}
                  onChange={(e) => setDefaultStepsTotal(e.target.value)}
                  slotProps={{ htmlInput: { step: 1, min: 1 } }}
                  helperText="Total sampler steps"
                  sx={{ flex: 1, minWidth: 110 }}
                />
                <TextField
                  label="High-Noise Steps"
                  type="number"
                  size="small"
                  value={defaultHighNoiseSteps}
                  onChange={(e) => setDefaultHighNoiseSteps(e.target.value)}
                  slotProps={{ htmlInput: { step: 1, min: 0 } }}
                  helperText="High/low split boundary"
                  sx={{ flex: 1, minWidth: 110 }}
                />
                <TextField
                  label="Flow Shift"
                  type="number"
                  size="small"
                  value={defaultFlowShift}
                  onChange={(e) => setDefaultFlowShift(e.target.value)}
                  slotProps={{ htmlInput: { step: 0.5, min: 1 } }}
                  helperText="Motion schedule shift"
                  sx={{ flex: 1, minWidth: 110 }}
                />
              </Box>
              <TextField
                label="Negative Prompt"
                size="small"
                multiline
                minRows={3}
                maxRows={8}
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                helperText="Sent as negative conditioning to ComfyUI"
                sx={{ mt: 2, width: "100%", maxWidth: 500 }}
              />
              <Box sx={{ mt: 2 }}>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleSaveDefaults}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save Defaults"}
                </Button>
                {saved && (
                  <Alert severity="success" sx={{ mt: 1 }}>
                    Defaults saved
                  </Alert>
                )}
                {saveError && (
                  <Alert severity="error" sx={{ mt: 1 }} onClose={() => setSaveError(null)}>
                    {saveError}
                  </Alert>
                )}
              </Box>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
