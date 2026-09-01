import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
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
  renderPrompt,
  TRIGGER_PLACEHOLDER,
  updateCharacter,
  updatePose,
} from "../api/ltx";
import type { Character, Pose, RecipeBook } from "../api/ltx";

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
export default function LoraRecipes() {
  const [book, setBook] = useState<RecipeBook | null>(null);
  const [loras, setLoras] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const b = await listRecipes();
      setBook(b);
      setLoras(await listLoras(b));
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

      <PoseList book={book} onChanged={load} />
      <Divider sx={{ my: 4 }} />
      <CharacterList book={book} loras={loras} onChanged={load} />
    </Box>
  );
}

// ---------------------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------------------

function PoseList({ book, onChanged }: { book: RecipeBook | null; onChanged: () => void }) {
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
  onClose,
  onSaved,
}: {
  pose: Pose | null;
  characters: Character[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // A duplicate arrives as a pose object with an empty id: same fields, but it must POST.
  const isNew = !pose?.id;
  const [name, setName] = useState(pose?.name ?? "");
  const [template, setTemplate] = useState(pose?.prompt_template ?? `${TRIGGER_PLACEHOLDER}, `);
  const [negative, setNegative] = useState(pose?.negative_prompt ?? "");
  const [frames, setFrames] = useState(pose?.frames ? String(pose.frames) : "");
  const [validated, setValidated] = useState(pose?.validated ?? false);
  const [previewChar, setPreviewChar] = useState(characters[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const warnings = useMemo(
    () => poseWarnings(template, characters),
    [template, characters],
  );
  const preview = useMemo(() => {
    const c = characters.find((x) => x.id === previewChar);
    return c ? renderPrompt(template, c.trigger) : template;
  }, [template, previewChar, characters]);

  const save = async () => {
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
        frames: frames.trim() ? Number(frames) : null,
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

          {characters.length > 0 && (
            <Box>
              <TextField
                select
                size="small"
                label="Preview as"
                value={previewChar}
                onChange={(e) => setPreviewChar(e.target.value)}
                sx={{ minWidth: 200, mb: 1 }}
              >
                {characters.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuItem>
                ))}
              </TextField>
              <Card variant="outlined" sx={{ p: 1.5, bgcolor: "action.hover" }}>
                <Typography variant="body2">{preview}</Typography>
              </Card>
            </Box>
          )}

          <TextField
            label="Negative prompt"
            value={negative}
            onChange={(e) => setNegative(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            helperText="Leave empty to use the global stack's negative."
          />
          <TextField
            label="Frames"
            value={frames}
            onChange={(e) => setFrames(e.target.value)}
            sx={{ maxWidth: 200 }}
            helperText="Empty = the stack's default."
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
    setSaving(true);
    setErr(null);
    try {
      if (isNew) {
        await createCharacter({
          name: name.trim(),
          char_lora: lora.trim(),
          // Absent means "no opinion" and the API defaults it to the name.
          trigger: trigger.trim() || null,
          strength_stage_1: Number(s1),
          strength_stage_2: Number(s2),
        });
      } else {
        await updateCharacter(character!.id, {
          name: name.trim(),
          char_lora: lora.trim(),
          // Only sent when non-empty: on update an absent trigger means "leave it alone",
          // and clearing it here must not silently rewrite it to the (possibly new) name.
          ...(trigger.trim() ? { trigger: trigger.trim() } : {}),
          strength_stage_1: Number(s1),
          strength_stage_2: Number(s2),
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
