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
    negativePrompt,
    loaded,
    fetchSettings,
    saveSettings,
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
      await saveSettings({ negative_prompt: negativePrompt });
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
