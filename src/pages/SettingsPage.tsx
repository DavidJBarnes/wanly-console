import { Fragment, useEffect, useState } from "react";
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
import type { CaptionStyle, MotionStyle } from "../api/types";
import PromptTryPanel from "../components/PromptTryPanel";
import {
  hasUnsavedChange, isModified, keepsGrounding, lengthProblem, motionTemplateProblem,
  overrideToSave,
} from "../lib/captionPrompts";

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
    captionDraft,
    captionStylePrompts,
    motionStyle,
    motionInstruction,
    motionDraft,
    motionStylePrompts,
    motionTemplateDefault,
    motionPlaceholders,
    promptMaxLength,
    loaded,
    fetchSettings,
    saveSettings,
    setNegativePrompt,
    setCaptionStyle,
    setCaptionDraft,
    setMotionStyle,
    setMotionDraft,
  } = useSettingsStore();

  // The prompt editors (console#555). Defaults come from the API; see lib/captionPrompts.
  const captionDefault = captionStylePrompts[captionStyle] ?? "";
  const captionModified = isModified(captionDraft, captionDefault);
  const captionUnsaved = hasUnsavedChange(captionDraft, captionDefault, captionInstruction);
  const captionProblem = lengthProblem(captionDraft, promptMaxLength);
  const motionModified = isModified(motionDraft, motionTemplateDefault);
  const motionUnsaved = hasUnsavedChange(motionDraft, motionTemplateDefault, motionInstruction);
  const motionProblem =
    lengthProblem(motionDraft, promptMaxLength) ?? motionTemplateProblem(motionDraft);
  // An empty editor means the default template, which has {style}.
  const motionUsesStyle = !motionModified || motionDraft.includes("{style}");
  const promptsProblem = captionProblem || motionProblem
    ? "Fix the prompt errors above first." : null;
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
        // distinguishes that from undefined, which means "leave it alone". An editor still
        // holding the default sends "" too, so the default keeps tracking the API's.
        caption_instruction: overrideToSave(captionDraft, captionDefault),
        motion_style: motionStyle,
        motion_instruction: overrideToSave(motionDraft, motionTemplateDefault),
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
            disabled={captionModified}
            sx={{ minWidth: 260 }}
            helperText={
              captionModified
                ? "Ignored while the prompt below is modified. Reset it to use a preset."
                : "Longer is not automatically better — the description sits beside the recipe's own arc, and a long one can outweigh it."
            }
          >
            <MenuItem value="terse">Terse — about 25 words</MenuItem>
            <MenuItem value="standard">Standard — about 40 words (recommended)</MenuItem>
            <MenuItem value="rich">Rich — about 80 words</MenuItem>
            <MenuItem value="raw">Raw — the captioner&rsquo;s own voice, longest</MenuItem>
          </TextField>

          {/* Pre-filled with the text that is actually sent (console#555), so an edit starts
              from the real prompt rather than a blank box. */}
          <PromptEditorHeader
            title="Image caption prompt"
            modified={captionModified}
            unsaved={captionUnsaved}
            canReset={captionDraft !== captionDefault}
            onReset={() => setCaptionDraft(captionDefault)}
          />
          <TextField
            multiline
            size="small"
            minRows={3}
            maxRows={12}
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            error={!!captionProblem}
            sx={{ width: "100%", maxWidth: 900 }}
            slotProps={{ htmlInput: { "aria-label": "Image caption prompt" } }}
            helperText={
              captionProblem ??
              `${captionDraft.length}/${promptMaxLength}. ` +
                (captionModified
                  ? "Your prompt is used for every detail level. The presets also tell the captioner to ignore watermarks, on-image text and picture frames; keep that, or it will describe them."
                  : "The preset for this detail level. Edit it to write your own; empty means the preset.")
            }
          />
        </CardContent>
      </Card>

      {/* The motion half of a description (wanly-api#326): the frame read as the first
          frame of a 10-second clip, for what the video model should generate. */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            Motion descriptions
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Describing an image also produces a second paragraph: the frame read as the
            first frame of a ten-second clip &mdash; the action, its direction and rhythm,
            expression changes, and a soundscape. It is written from the same call and kept
            with the image. The capture style sets how the clip looks.
          </Typography>
          <TextField
            select
            size="small"
            label="Capture style"
            value={motionStyle}
            onChange={(e) => setMotionStyle(e.target.value as MotionStyle)}
            sx={{ minWidth: 260 }}
            helperText={
              !motionUsesStyle
                ? "Has no effect: the prompt below has no {style} placeholder."
                : "How the clip is shot. Fills {style} in the prompt below; the action is described first, the style is one sentence after it."
            }
          >
            <MenuItem value="handheld">Handheld — natural micro-shake (recommended)</MenuItem>
            <MenuItem value="amateur">Amateur — consumer-camera, no polish</MenuItem>
            <MenuItem value="cinematic">Cinematic — slow push-in, shallow depth</MenuItem>
            <MenuItem value="static">Static — tripod, no camera movement</MenuItem>
            <MenuItem value="none">None — say nothing about the camera</MenuItem>
          </TextField>

          {motionStylePrompts[motionStyle] && motionUsesStyle && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 1, maxWidth: 640, fontStyle: "italic" }}
            >
              {"{style}"} = {motionStylePrompts[motionStyle]}
            </Typography>
          )}

          <PromptEditorHeader
            title="Motion prompt"
            modified={motionModified}
            unsaved={motionUnsaved}
            canReset={motionDraft !== motionTemplateDefault}
            onReset={() => setMotionDraft(motionTemplateDefault)}
          />
          <TextField
            multiline
            size="small"
            minRows={6}
            maxRows={20}
            value={motionDraft}
            onChange={(e) => setMotionDraft(e.target.value)}
            error={!!motionProblem}
            sx={{ width: "100%", maxWidth: 900 }}
            slotProps={{ htmlInput: { "aria-label": "Motion prompt", spellCheck: false } }}
            helperText={
              motionProblem ??
              `${motionDraft.length}/${promptMaxLength}. ` +
                "The default bans 'remains still' hedging and asks for explicit direction and amplitude — without those the model describes a still photo."
            }
          />
          {!motionProblem && !keepsGrounding(motionDraft) && motionDraft.trim() && (
            <Alert severity="warning" sx={{ mt: 1, maxWidth: 900 }}>
              This prompt no longer includes the image caption, so the motion is not grounded
              on it: faces, wardrobe and pose can drift from what the caption says. Keep a{" "}
              <code>{"{#scene}…{/scene}"}</code> section to prevent that.
            </Alert>
          )}

          {/* The legend. From the API, so it cannot drift from what the renderer accepts. */}
          {Object.keys(motionPlaceholders).length > 0 && (
            <Box component="dl" sx={{ mt: 1.5, mb: 0, maxWidth: 900, display: "grid",
              gridTemplateColumns: "max-content 1fr", columnGap: 2, rowGap: 0.5 }}>
              {Object.entries(motionPlaceholders).map(([token, meaning]) => (
                <Fragment key={token}>
                  <Typography component="dt" variant="caption" sx={{ fontFamily: "monospace" }}>
                    {token}
                  </Typography>
                  <Typography component="dd" variant="caption" color="text.secondary" sx={{ m: 0 }}>
                    {meaning}
                  </Typography>
                </Fragment>
              ))}
            </Box>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            Both prompts are saved with Save at the bottom of the page.
          </Typography>
        </CardContent>
      </Card>

      <PromptTryPanel disabledReason={promptsProblem} />

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
                  disabled={saving || !!promptsProblem}
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

/** Title row of a prompt editor: the name, whether it differs from the default and from what
 *  is saved, and the way back to the default. */
function PromptEditorHeader({
  title, modified, unsaved, canReset, onReset,
}: {
  title: string; modified: boolean; unsaved: boolean; canReset: boolean; onReset: () => void;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2.5, mb: 1, flexWrap: "wrap", maxWidth: 900 }}>
      <Typography variant="subtitle2">{title}</Typography>
      {modified && <Chip label="Modified" size="small" color="warning" variant="outlined" />}
      {unsaved && <Chip label="Unsaved" size="small" color="info" variant="outlined" />}
      <Button size="small" onClick={onReset} disabled={!canReset} sx={{ ml: "auto" }}>
        Reset to default
      </Button>
    </Box>
  );
}
