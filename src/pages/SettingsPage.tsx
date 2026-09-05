import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  MenuItem,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useTagStore } from "../stores/tagStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { CaptionStyle } from "../api/types";

export default function SettingsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { titleTags1, titleTags2, loading, fetchTags, addTag, removeTag } =
    useTagStore();
  const [input1, setInput1] = useState("");
  const [input2, setInput2] = useState("");
  const {
    negativePrompt,
    captionStyle,
    captionInstruction,
    captionStylePrompts,
    loaded,
    fetchSettings,
    saveSettings,
    setNegativePrompt,
    setCaptionStyle,
    setCaptionInstruction,
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

  const handleSaveSettings = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await saveSettings({
        negative_prompt: negativePrompt,
        caption_style: captionStyle,
        // Sent even when empty: "" is how a custom instruction is CLEARED, and the API
        // distinguishes that from undefined, which means "leave it alone".
        caption_instruction: captionInstruction,
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

      {/* Start-frame descriptions. A recipe can carry <SCENE>, which is replaced at
          submission with a description of the frame the segment actually starts on — see
          console#405. These settings control how much the captioner says. */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            Start-frame descriptions
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A recipe containing <code>&lt;SCENE&gt;</code> has it replaced with a description
            of that segment&rsquo;s start frame. Recipes are written to fit any character and
            any frame, so their own scene wording is a guess; this replaces it with what the
            image actually shows. The arc &mdash; what happens &mdash; is left untouched.
          </Typography>
          <TextField
            select
            size="small"
            label="Detail level"
            value={captionStyle}
            onChange={(e) => setCaptionStyle(e.target.value as CaptionStyle)}
            disabled={!!captionInstruction.trim()}
            sx={{ minWidth: 260 }}
            helperText={
              captionInstruction.trim()
                ? "Ignored while a custom instruction is set"
                : "Longer is not automatically better — the description sits beside the recipe's own arc, and a long one can outweigh it."
            }
          >
            <MenuItem value="terse">Terse — about 25 words</MenuItem>
            <MenuItem value="standard">Standard — about 40 words (recommended)</MenuItem>
            <MenuItem value="rich">Rich — about 80 words</MenuItem>
            <MenuItem value="raw">Raw — the captioner&rsquo;s own voice, longest</MenuItem>
          </TextField>

          {/* Shown rather than described: "rich" means nothing until you can see that it
              asks for hair, hands and lighting. */}
          {captionStylePrompts[captionStyle] && !captionInstruction.trim() && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 1, maxWidth: 640, fontStyle: "italic" }}
            >
              Asks for: {captionStylePrompts[captionStyle]}
            </Typography>
          )}

          <TextField
            label="Custom instruction (optional)"
            size="small"
            multiline
            minRows={2}
            maxRows={6}
            value={captionInstruction}
            onChange={(e) => setCaptionInstruction(e.target.value)}
            sx={{ mt: 2, width: "100%", maxWidth: 640 }}
            helperText={
              "Overrides the detail level entirely. Leave empty to use the preset. " +
              "Note the presets also tell the captioner to ignore watermarks, on-image text " +
              "and picture frames — worth repeating here, or it will describe them."
            }
          />
        </CardContent>
      </Card>

      {/* Was "Job Defaults", which described a WAN 2.2-era card holding seven generation
          parameters — cfg high/low, lightx2v strengths, steps, flow shift. Those settings
          are gone with WAN, and the fields that referenced them were removed in console#390.
          What remains is one global: the negative prompt every segment falls back to.
          Named for what it is rather than for what used to be here. */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            Negative prompt
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The default for every render. A pose can override it, and most do not — so in
            practice this is what a render uses. Leave it empty and the built-in negative
            applies instead; clearing the box does not render without one.
          </Typography>
          {!loaded ? (
            <Box sx={{ textAlign: "center", py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <>
              <TextField
                label="Applied when a pose sets none"
                size="small"
                multiline
                minRows={3}
                maxRows={8}
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                helperText="Sent as negative conditioning to the engine"
                sx={{ mt: 2, width: "100%", maxWidth: 500 }}
              />
              <Box sx={{ mt: 2 }}>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleSaveSettings}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save"}
                </Button>
                {saved && (
                  <Alert severity="success" sx={{ mt: 1 }}>
                    Saved
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
