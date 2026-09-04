import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { Add, ContentCopy, DeleteOutline, Edit } from "@mui/icons-material";
import {
  createCharacter,
  createPose,
  deleteCharacter,
  deletePose,
  listLoras,
  listRecipes,
  ltxError,
  poseWarnings,
  TRIGGER_PLACEHOLDER,
  updateCharacter,
  updatePose,
} from "../api/ltx";
import type { Character, Pose, RecipeBook } from "../api/ltx";
import { overrideNumber } from "../lib/overrideValue";

/**
 * Authoring poses and characters.
 *
 * Recipes became rows (wanly-api#212) so they could change without a spreadsheet or a
 * migration; until this page existed the only way to add either was SQL. That bites
 * hardest on characters — a character is a LoRA plus a trigger, and it is what makes every
 * pose available to a newly trained LoRA. Training one and being unable to use it without
 * a database edit defeats the schema change.
 *
 * The prompt editor here shows the TEMPLATE, placeholder and all. That is deliberately the
 * opposite of RecipeForm, which shows the rendered prompt because that is what will be
 * generated. Here the author is editing the template itself, and hiding the placeholder
 * would mean editing around something invisible. The two are kept as separate components
 * rather than one with a `resolve` flag, because a flag is how they would quietly become
 * the same component again.
 */
/** Base models present on the 3090 as of 2026-09-03.
 *
 *  A hint list, not a constraint — the field is free text. These live as 46 GB files on the
 *  GPU box rather than in S3, and the engine binds to localhost, so nothing upstream can
 *  enumerate them; this has to be updated by hand when the set changes. A worker could
 *  report them through its heartbeat the way it now reports LoRAs, which would make this
 *  list real rather than remembered.
 */
const KNOWN_CHECKPOINTS = [
  "sulphur_dev_bf16",
  "10Eros_v1.5_bf16",
  "ltx-2.3-22b-dev",
  "ltx-2.3-22b-distilled-1.1",
];

export default function LoraRecipes() {
  const [book, setBook] = useState<RecipeBook | null>(null);
  const [loras, setLoras] = useState<string[]>([]);
  // Content LoRAs are a different shelf in the bucket and a different axis entirely:
  // character is WHO, content is WHAT IS HAPPENING. Fetched separately so a pose can never
  // be offered an identity LoRA, nor a character a motion one.
  const [contentLoras, setContentLoras] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const b = await listRecipes();
      setBook(b);
      const [chars, contents] = await Promise.all([
        listLoras(b, "character"),
        listLoras(b, "content"),
      ]);
      setLoras(chars);
      setContentLoras(contents);
      setError(null);
    } catch (e) {
      setError(ltxError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !book) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        LoRA Recipes
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Poses are character-agnostic — every pose is offered for every character, so adding
        a newly trained LoRA costs one character row and nothing else.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <PoseList book={book} contentLoras={contentLoras} onChanged={load} />
      <Divider sx={{ my: 4 }} />
      <CharacterList book={book} loras={loras} onChanged={load} />
    </Box>
  );
}

// ---------------------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------------------

function PoseList({
  book,
  contentLoras,
  onChanged,
}: {
  book: RecipeBook | null;
  contentLoras: string[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Pose | "new" | null>(null);
  const [confirm, setConfirm] = useState<Pose | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const poses = book?.poses ?? [];

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await deletePose(confirm.id);
      setConfirm(null);
      onChanged();
    } catch (e) {
      setErr(ltxError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Poses ({poses.length})
        </Typography>
        <Button startIcon={<Add />} variant="outlined" onClick={() => setEditing("new")}>
          Add pose
        </Button>
      </Stack>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr(null)}>
          {err}
        </Alert>
      )}

      <Stack spacing={1}>
        {poses.map((p) => (
          <Card key={p.id} sx={{ p: 1.5 }} variant="outlined">
            <Stack direction="row" alignItems="flex-start" spacing={1}>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="subtitle2">{p.name}</Typography>
                  {p.validated && <Chip size="small" color="success" label="validated" />}
                  {!p.prompt_template.includes(TRIGGER_PLACEHOLDER) && (
                    <Tooltip title="This pose never names the subject">
                      <Chip size="small" color="warning" label={`no ${TRIGGER_PLACEHOLDER}`} />
                    </Tooltip>
                  )}
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {p.prompt_template}
                </Typography>
              </Box>
              <Tooltip title="Edit">
                <IconButton size="small" onClick={() => setEditing(p)}>
                  <Edit fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Duplicate">
                <IconButton
                  size="small"
                  onClick={() => setEditing({ ...p, id: "", name: `${p.name} copy` })}
                >
                  <ContentCopy fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <IconButton size="small" onClick={() => setConfirm(p)}>
                  <DeleteOutline fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Card>
        ))}
        {poses.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No poses yet.
          </Typography>
        )}
      </Stack>

      {editing && (
        <PoseDialog
          pose={editing === "new" ? null : editing}
          characters={book?.characters ?? []}
          contentLoras={contentLoras}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}

      <Dialog open={!!confirm} onClose={() => setConfirm(null)}>
        <DialogTitle>Delete {confirm?.name}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Renders already produced keep working — a segment records what it ran, so
            history does not depend on this pose still existing.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button color="error" disabled={busy} onClick={remove}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function PoseDialog({
  pose,
  characters,
  contentLoras,
  onClose,
  onSaved,
}: {
  pose: Pose | null;
  characters: Character[];
  contentLoras: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // A duplicate arrives as a pose object with an empty id: same fields, but it must POST.
  const isNew = !pose?.id;
  const [name, setName] = useState(pose?.name ?? "");
  const [template, setTemplate] = useState(pose?.prompt_template ?? `${TRIGGER_PLACEHOLDER}, `);
  const [negative, setNegative] = useState(pose?.negative_prompt ?? "");
  const [frames, setFrames] = useState(pose?.frames ? String(pose.frames) : "");
  // Empty string means "use the stack's value". "0" is a real setting and must survive,
  // so this is deliberately not `pose?.img_compression ? ... : ""`.
  const [imgCompression, setImgCompression] = useState(
    pose?.img_compression != null ? String(pose.img_compression) : "",
  );
  // The pose's content LoRA. "" means "use the stack's value", which is "none" — the same
  // empty-means-inherit convention as frames and img_compression above. The stack resolves
  // it before it reaches here, so a pose with no override arrives as "none".
  const [contentLora, setContentLora] = useState(
    pose?.content_lora && pose.content_lora !== "none" ? pose.content_lora : "",
  );
  // Empty means the stack's 0.6. "0" is a real setting — LoRA loaded, no weight, which is
  // how you measure its contribution — so this is not `pose?.content_s1 ? ... : ""`.
  const [contentS1, setContentS1] = useState(
    pose?.content_s1 != null ? String(pose.content_s1) : "",
  );
  const [contentS2, setContentS2] = useState(
    pose?.content_s2 != null ? String(pose.content_s2) : "",
  );
  // "" means "use the stack's base model", the same empty-means-inherit convention as the
  // fields above. The stack resolves it before it arrives, so a pose with no override shows
  // the stack's value and clearing the field restores it.
  const [checkpoint, setCheckpoint] = useState(pose?.checkpoint ?? "");
  const [validated, setValidated] = useState(pose?.validated ?? false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const warnings = useMemo(
    () => poseWarnings(template, characters),
    [template, characters],
  );

  const save = async () => {
    // Bounded at 2 to match the engine, which rejects anything higher with a 422 — ten
    // minutes into a claimed segment, not here. Blank is fine and means "use the stack".
    for (const [label, raw] of [["Stage 1", contentS1], ["Stage 2", contentS2]] as const) {
      if (!raw.trim()) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 2) {
        setErr(`Content LoRA ${label} strength must be a number between 0 and 2.`);
        return;
      }
    }
    setSaving(true);
    setErr(null);
    try {
      const draft = {
        name: name.trim(),
        prompt_template: template,
        // "" is the user clearing an override, which means "use the stack's negative".
        // Sending "" instead would store an empty negative prompt, which is a different
        // and much worse thing.
        negative_prompt: negative.trim() || null,
        frames: overrideNumber(frames),
        img_compression: overrideNumber(imgCompression),
        // "" clears the override and the pose falls back to the stack, which is "none".
        // `.trim() ?` is safe for the strengths for the same reason it is for
        // img_compression: "0" is a non-empty string, so a deliberate 0 survives.
        content_lora: contentLora.trim() || null,
        content_s1: overrideNumber(contentS1),
        content_s2: overrideNumber(contentS2),
        checkpoint: checkpoint.trim() || null,
        validated,
      };
      if (isNew) await createPose(draft);
      else await updatePose(pose!.id, draft);
      onSaved();
    } catch (e) {
      setErr(ltxError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>{isNew ? "New pose" : `Edit ${pose?.name}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {err && <Alert severity="error">{err}</Alert>}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            autoFocus
          />
          <TextField
            label="Prompt template"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            fullWidth
            multiline
            minRows={4}
            helperText={`${TRIGGER_PLACEHOLDER} is replaced with the character's trigger word. This box shows the template, not the result.`}
          />

          {warnings.map((w) => (
            <Alert key={w} severity="warning">
              {w}
            </Alert>
          ))}

          <TextField
            label="Negative prompt"
            value={negative}
            onChange={(e) => setNegative(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            helperText="Leave empty to use the global stack's negative."
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Frames"
              value={frames}
              onChange={(e) => setFrames(e.target.value)}
              sx={{ maxWidth: 200 }}
              helperText="Empty = the stack's default."
            />
            <TextField
              label="Image compression"
              value={imgCompression}
              onChange={(e) => setImgCompression(e.target.value)}
              sx={{ maxWidth: 260 }}
              helperText="Video CRF for the start frame, 0–51. Empty = the stack's value (18). Lower holds the start frame longer; 0 skips the encode entirely."
            />
          </Stack>

          {/* The content LoRA is the POSE's — motion and act — and is chained AHEAD of the
              character LoRA, which is identity. Two different axes, so this list is filtered
              to the bucket's content/ shelf and can never offer a character. */}
          <Divider textAlign="left" sx={{ pt: 1 }}>
            <Typography variant="overline" color="text.secondary">
              Content LoRA
            </Typography>
          </Divider>
          <TextField
            select={contentLoras.length > 0}
            label="Content LoRA"
            value={contentLora}
            onChange={(e) => setContentLora(e.target.value)}
            fullWidth
            helperText="Motion or act for this pose, chained ahead of the character LoRA. Empty = none, which is what every pose does today."
          >
            {/* An explicit way back to "no content LoRA" — a select with no empty option
                cannot be cleared once something is chosen. */}
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
            {contentLoras.map((l) => (
              <MenuItem key={l} value={l}>
                {l}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Content stage 1"
              value={contentS1}
              onChange={(e) => setContentS1(e.target.value)}
              disabled={!contentLora}
              sx={{ maxWidth: 200 }}
              helperText="Empty = 0.6. Shape and motion"
            />
            <TextField
              label="Content stage 2"
              value={contentS2}
              onChange={(e) => setContentS2(e.target.value)}
              disabled={!contentLora}
              sx={{ maxWidth: 200 }}
              helperText="Empty = 0.6. Detail"
            />
          </Stack>

          {/* Base model. Free text with suggestions rather than a fixed list: the
              checkpoints are 46 GB files on the GPU box, not in S3, and the engine binds
              to localhost so the API cannot enumerate them. The engine validates the name
              and fails loudly if it is wrong, so a typo costs a clear error rather than a
              bad render. */}
          <Autocomplete
            freeSolo
            options={KNOWN_CHECKPOINTS}
            value={checkpoint}
            onInputChange={(_, v) => setCheckpoint(v)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Base model"
                helperText="Empty = the stack's default (sulphur_dev_bf16). Character LoRAs were trained against sulphur — on another base a LoRA can fuse nothing at all and the render comes back without the character. Check the segment log for 'fuses N/M weights'."
              />
            )}
            sx={{ maxWidth: 640 }}
          />

          <FormControlLabel
            control={
              <Checkbox checked={validated} onChange={(e) => setValidated(e.target.checked)} />
            }
            label="Validated — this prompt produces what it claims"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving || !name.trim() || !template.trim()} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------------------

function CharacterList({
  book,
  loras,
  onChanged,
}: {
  book: RecipeBook | null;
  loras: string[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Character | "new" | null>(null);
  const [confirm, setConfirm] = useState<Character | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const characters = book?.characters ?? [];

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await deleteCharacter(confirm.id);
      setConfirm(null);
      onChanged();
    } catch (e) {
      setErr(ltxError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Characters ({characters.length})
        </Typography>
        <Button startIcon={<Add />} variant="outlined" onClick={() => setEditing("new")}>
          Add character
        </Button>
      </Stack>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr(null)}>
          {err}
        </Alert>
      )}

      <Stack spacing={1}>
        {characters.map((c) => (
          <Card key={c.id} sx={{ p: 1.5 }} variant="outlined">
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="subtitle2">{c.name}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {c.char_lora} · trigger “{c.trigger}” · stage 1 {c.strength_stage_1} ·
                  stage 2 {c.strength_stage_2}
                </Typography>
              </Box>
              <Tooltip title="Edit">
                <IconButton size="small" onClick={() => setEditing(c)}>
                  <Edit fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <IconButton size="small" onClick={() => setConfirm(c)}>
                  <DeleteOutline fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Card>
        ))}
        {characters.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No characters yet — a character is a LoRA plus a trigger word.
          </Typography>
        )}
      </Stack>

      {editing && (
        <CharacterDialog
          character={editing === "new" ? null : editing}
          loras={loras}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}

      <Dialog open={!!confirm} onClose={() => setConfirm(null)}>
        <DialogTitle>Delete {confirm?.name}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Poses are not affected — they belong to every character, not this one. Renders
            already produced keep working.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button color="error" disabled={busy} onClick={remove}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function CharacterDialog({
  character,
  loras,
  onClose,
  onSaved,
}: {
  character: Character | null;
  loras: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !character;
  const [name, setName] = useState(character?.name ?? "");
  const [lora, setLora] = useState(character?.char_lora ?? "");
  const [trigger, setTrigger] = useState(character?.trigger ?? "");
  const [s1, setS1] = useState(String(character?.strength_stage_1 ?? 0.8));
  const [s2, setS2] = useState(String(character?.strength_stage_2 ?? 1.5));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    // Number("") is 0, and a strength of 0 is a LoRA that is loaded and does nothing: the
    // render succeeds, costs its full ten minutes, and comes back as the base model with
    // none of the character in it. That reads as "the LoRA is bad", not "the field was
    // blank", so it is caught here rather than left to look like a training problem.
    const n1 = Number(s1);
    const n2 = Number(s2);
    if (!Number.isFinite(n1) || !Number.isFinite(n2) || n1 <= 0 || n2 <= 0) {
      setErr("Both strengths must be numbers greater than 0.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      if (isNew) {
        await createCharacter({
          name: name.trim(),
          char_lora: lora.trim(),
          // Absent means "no opinion" and the API defaults it to the name.
          trigger: trigger.trim() || null,
          strength_stage_1: n1,
          strength_stage_2: n2,
        });
      } else {
        await updateCharacter(character!.id, {
          name: name.trim(),
          char_lora: lora.trim(),
          // Only sent when non-empty: on update an absent trigger means "leave it alone",
          // and clearing it here must not silently rewrite it to the (possibly new) name.
          ...(trigger.trim() ? { trigger: trigger.trim() } : {}),
          strength_stage_1: n1,
          strength_stage_2: n2,
        });
      }
      onSaved();
    } catch (e) {
      setErr(ltxError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>{isNew ? "New character" : `Edit ${character?.name}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {err && <Alert severity="error">{err}</Alert>}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            autoFocus
          />
          <TextField
            select={loras.length > 0}
            label="Character LoRA"
            value={lora}
            onChange={(e) => setLora(e.target.value)}
            fullWidth
            helperText="The LoRA file name, without .safetensors."
          >
            {loras.map((l) => (
              <MenuItem key={l} value={l}>
                {l}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Trigger"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            fullWidth
            helperText={
              isNew
                ? `Fills every pose's ${TRIGGER_PLACEHOLDER}. Empty defaults to the name.`
                : `Fills every pose's ${TRIGGER_PLACEHOLDER}. Left empty, it is kept as it is.`
            }
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Strength stage 1"
              value={s1}
              onChange={(e) => setS1(e.target.value)}
              helperText="Body and anatomy"
            />
            <TextField
              label="Strength stage 2"
              value={s2}
              onChange={(e) => setS2(e.target.value)}
              helperText="Resolves the face"
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            0.8 / 1.5 is the validated pair. The stages are not interchangeable: stage 1
            generates at half size from noise, stage 2 refines the upscaled latent.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving || !name.trim() || !lora.trim()}
          onClick={save}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
