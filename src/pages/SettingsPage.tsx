import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import TagChip from "../components/TagChip";
import ActionTagRow from "../components/ActionTagRow";
import { ACTION_GROUP, PERSON_GROUP } from "../lib/tagGroups";
import { useTagStore } from "../stores/tagStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { CaptionStyle } from "../api/types";
import PromptTryPanel from "../components/PromptTryPanel";
import { STAGE2_SIGMAS_PRESETS, stage2SigmasProblem } from "../lib/stage2Sigmas";
import {
  hasUnsavedChange, isModified, lengthProblem, overrideToSave,
} from "../lib/captionPrompts";

export default function SettingsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { titleTags1, titleTags2, loading, fetchTags, addTag, removeTag, setDescription } =
    useTagStore();
  const [input1, setInput1] = useState("");
  const [input2, setInput2] = useState("");
  const {
    negativePrompt,
    captionStyle,
    captionInstruction,
    captionDraft,
    captionStylePrompts,
    promptMaxLength,
    loaded,
    fetchSettings,
    saveSettings,
    setNegativePrompt,
    stage2Sigmas,
    stage2SigmasDefault,
    setStage2Sigmas,
    saveStage2Sigmas,
    setCaptionStyle,
    setCaptionDraft,
    segmentQueuePosition,
    saveQueuePosition,
  } = useSettingsStore();

  // The prompt editor (console#555). Defaults come from the API; see lib/captionPrompts.
  const captionDefault = captionStylePrompts[captionStyle] ?? "";
  const captionModified = isModified(captionDraft, captionDefault);
  const captionUnsaved = hasUnsavedChange(captionDraft, captionDefault, captionInstruction);
  const captionProblem = lengthProblem(captionDraft, promptMaxLength);
  const promptsProblem = captionProblem ? "Fix the prompt errors above first." : null;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const sigmasProblem = stage2SigmasProblem(stage2Sigmas);
  const [sigmasSaving, setSigmasSaving] = useState(false);
  const [sigmasSaved, setSigmasSaved] = useState(false);
  const [sigmasError, setSigmasError] = useState<string | null>(null);
  const [queueSaving, setQueueSaving] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  useEffect(() => {
    fetchTags();
    fetchSettings();
  }, [fetchTags, fetchSettings]);

  const handleAdd1 = () => {
    addTag(input1, PERSON_GROUP);
    setInput1("");
  };

  const handleAdd2 = () => {
    addTag(input2, ACTION_GROUP);
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

  // Saved on its own: this card's Save must not also commit unsaved edits in the others.
  const handleSaveSigmas = async () => {
    setSigmasSaving(true);
    setSigmasSaved(false);
    setSigmasError(null);
    try {
      await saveStage2Sigmas(stage2Sigmas);
      setSigmasSaved(true);
    } catch (err) {
      setSigmasError(err instanceof Error ? err.message : "Failed to save. Please try again.");
    } finally {
      setSigmasSaving(false);
    }
  };

  const handleQueueToggle = async (bottom: boolean) => {
    setQueueSaving(true);
    setQueueError(null);
    try {
      await saveQueuePosition(bottom ? "bottom" : "top");
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Failed to save. Please try again.");
    } finally {
      setQueueSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Settings
      </Typography>
      {/* wanly-api#471. Saves on toggle rather than with the page's Save button: it is a
          switch, not a draft, and it changes what the workers do next. */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            Queue
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={segmentQueuePosition === "bottom"}
                onChange={(e) => handleQueueToggle(e.target.checked)}
                disabled={!loaded || queueSaving}
              />
            }
            label="Send newly queued segments to the bottom of the queue"
          />
          <Typography variant="body2" color="text.secondary">
            {segmentQueuePosition === "bottom"
              ? "On: queuing a segment (next segment, re-roll, retry) moves its job behind every other job, so other jobs run first."
              : "Off: a queued segment keeps its job's place, so a job already under way runs ahead of jobs queued after it."}
          </Typography>
          {queueError && (
            <Alert severity="error" sx={{ mt: 1 }} onClose={() => setQueueError(null)}>
              {queueError}
            </Alert>
          )}
        </CardContent>
      </Card>
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
            {/* Person tags (group 1): who is in the image. */}
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Person tags
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
                  <TagChip
                    key={tag.id}
                    label={tag.name}
                    onDelete={() => removeTag(tag.id)}
                    size="small"
                  />
                ))}
              </Box>
            </Box>

            {/* Action tags (group 2): what is happening. Each has a description -- the "what
                happens" prompt Enhance prompt sends with the image (wanly-api#486). */}
            <Box sx={{ flex: 2 }}>
              <Typography variant="subtitle2">
                Action tags
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
                A description says what happens in a clip, in a sentence. Enhance prompt sends
                the image with the descriptions of all its Action tags, and the enhancer writes
                the video prompt from them. A tag with no description is not sent.
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
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {titleTags2.map((tag) => (
                  <ActionTagRow
                    key={`${tag.id}:${tag.description ?? ""}`}
                    tag={tag}
                    onDelete={() => removeTag(tag.id)}
                    onSave={(d) => setDescription(tag.id, d)}
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
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            The prompt is saved with Save at the bottom of the page.
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

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            Stage 2 sigmas
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The noise schedule for the refining pass, on every LTX render claimed after saving.
            Only the first value really matters: it is how much stage 2 may redraw. Stage 1 renders
            at half resolution; stage 2 adds noise up to the first value and cleans it back down,
            one step per remaining value. More redrawing adds detail but is where invented hands
            and arms creep in. Each value must be lower than the last, ending at 0.
          </Typography>
          <Table size="small" sx={{ mb: 1, maxWidth: 760 }}>
            <TableHead>
              <TableRow>
                <TableCell>Setting</TableCell>
                <TableCell>Values</TableCell>
                <TableCell>What to expect</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {STAGE2_SIGMAS_PRESETS.map((p) => (
                <TableRow key={p.name}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{p.value}</TableCell>
                  <TableCell>{p.expect}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      disabled={!loaded || stage2Sigmas === p.value}
                      onClick={() => {
                        setStage2Sigmas(p.value);
                        setSigmasSaved(false);
                      }}
                    >
                      Use
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            To test: render 2 or 3 start images that have produced bad limbs, at least twice per
            setting (seeds vary a lot). If the bad limbs fade as the first value drops, stage 2 was
            inventing them; if they survive Low, they come from stage 1 and these values will not
            fix them. This is global, so every LTX segment claimed after Save uses it: reset when
            done testing. Each job's page shows the values its segments ran with.
          </Typography>
          {!loaded ? (
            <Box sx={{ textAlign: "center", py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <>
              <TextField
                label="Sigmas"
                size="small"
                value={stage2Sigmas}
                onChange={(e) => {
                  setStage2Sigmas(e.target.value);
                  setSigmasSaved(false);
                }}
                error={!!sigmasProblem}
                helperText={sigmasProblem ?? `Default: ${stage2SigmasDefault}`}
                sx={{ mt: 1, width: "100%", maxWidth: 500 }}
              />
              <Box sx={{ mt: 2 }}>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleSaveSigmas}
                  disabled={sigmasSaving || !!sigmasProblem}
                >
                  {sigmasSaving ? "Saving..." : "Save"}
                </Button>
                <Button
                  size="small"
                  sx={{ ml: 1 }}
                  onClick={() => {
                    setStage2Sigmas(stage2SigmasDefault);
                    setSigmasSaved(false);
                  }}
                  disabled={stage2Sigmas === stage2SigmasDefault}
                >
                  Reset to default
                </Button>
                {sigmasSaved && (
                  <Alert severity="success" sx={{ mt: 1 }}>
                    Saved
                  </Alert>
                )}
                {sigmasError && (
                  <Alert severity="error" sx={{ mt: 1 }} onClose={() => setSigmasError(null)}>
                    {sigmasError}
                  </Alert>
                )}
              </Box>
            </>
          )}
        </CardContent>
      </Card>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 0.5 }}>
            Tools
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Experiments and diagnostics that open outside the main console.
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
            <Button variant="outlined" component={RouterLink} to="/holo/face-spike">
              AR face spike
            </Button>
            <Typography variant="body2" color="text.secondary">
              Quest 3 only. Detects a mannequin's face through the passthrough camera and pins a
              placeholder oval on it (console#730).
            </Typography>
          </Box>
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
