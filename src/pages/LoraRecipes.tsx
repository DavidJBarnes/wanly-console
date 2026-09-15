import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
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
import { Link } from "react-router";
import {
  createBook,
  createCharacter,
  createPose,
  deleteBook,
  deleteCharacter,
  deletePose,
  listLoras,
  listCheckpoints,
  listRecipes,
  ltxError,
  poseWarnings,
  TRIGGER_PLACEHOLDER,
  updateBook,
  updateCharacter,
  updatePose,
  triggerPhrase,
} from "../api/ltx";
import type { Book, Character, ContentLora, Pose, RecipeCatalog } from "../api/ltx";
import type { Gender } from "../api/types";
import { getFileUrl } from "../api/client";
import { parseContentLoraStrength } from "../lib/contentLoraStrength";
import { overrideNumber } from "../lib/overrideValue";
import {
  initialNegativeOverride,
  negativeOverrideToSend,
} from "../lib/poseNegativeOverride";

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
/** Matches LtxRequest.loras' own max_length in the engine. Four LoRAs on one chain is
 *  already a lot of competition for the same weights as the character LoRA. */
const MAX_CONTENT_LORAS = 4;

/** A content LoRA while it is being EDITED. The strengths are the string the user is
 *  typing, not a number — parsing each keystroke ate the decimal point and made 0.6
 *  impossible to enter (console#419). Parsed once, on save. */
type ContentLoraDraft = { name: string; s1: string; s2: string };

export default function LoraRecipes() {
  const [catalog, setCatalog] = useState<RecipeCatalog | null>(null);
  // "" is "All books". The picker is a filter over the pose LIST, not a re-fetch: the
  // catalog already carries every pose with its book, and a pose must stay editable
  // regardless of which shelf it sits on.
  const [bookId, setBookId] = useState("");
  const [loras, setLoras] = useState<string[]>([]);
  // Content LoRAs are a different shelf in the bucket and a different axis entirely:
  // character is WHO, content is WHAT IS HAPPENING. Fetched separately so a pose can never
  // be offered an identity LoRA, nor a character a motion one.
  const [contentLoras, setContentLoras] = useState<string[]>([]);
  // Base models, from what live workers report. Not a constant: a checkpoint is a 46 GB
  // file on a GPU box, and which ones exist is a fact about the fleet rather than about
  // this code. See console#404.
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const b = await listRecipes();
      setCatalog(b);
      const [chars, contents] = await Promise.all([
        listLoras(b, "character"),
        listLoras(b, "content"),
      ]);
      setLoras(chars);
      setContentLoras(contents);
      try {
        setCheckpoints((await listCheckpoints()).checkpoints);
      } catch {
        // Non-fatal: the field falls back to "stack default" only, which is what every
        // existing pose already uses. A recipe page that will not load because the fleet is
        // down would be a worse outcome than a shorter dropdown.
        setCheckpoints([]);
      }
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

  if (loading && !catalog) {
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
        a newly trained LoRA costs one character row and nothing else. Poses are filed in
        Books, which is how poses trained on different base models are kept apart.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <BookManager
        books={catalog?.books ?? []}
        onChanged={load}
        selected={bookId}
        onSelect={setBookId}
      />
      <Divider sx={{ my: 4 }} />
      <PoseList
        catalog={catalog}
        bookId={bookId}
        contentLoras={contentLoras}
        checkpoints={checkpoints}
        onChanged={load}
      />
      <Divider sx={{ my: 4 }} />
      <CharacterList catalog={catalog} loras={loras} onChanged={load} />
    </Box>
  );
}

// ---------------------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------------------

/**
 * The shelves poses are filed on.
 *
 * A Book is not a character — it is the base-model family a pose was trained for, which is
 * why a pose belongs to exactly one. The dropdown is both the filter over the pose list and
 * the default for a new pose; the same control, because "which book am I looking at" and
 * "which book am I adding to" being different would be a trap.
 */
function BookManager({
  books,
  onChanged,
  selected,
  onSelect,
}: {
  books: Book[];
  onChanged: () => void;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [editing, setEditing] = useState<Book | "new" | null>(null);
  const [confirm, setConfirm] = useState<Book | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const open = (b: Book | "new") => {
    setErr(null);
    if (b === "new") {
      setName("");
      setDescription("");
    } else {
      setName(b.name);
      setDescription(b.description ?? "");
    }
    setEditing(b);
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const draft = { name: name.trim(), description: description.trim() || undefined };
      if (editing === "new") await createBook(draft);
      else if (editing) await updateBook(editing.id, draft);
      setEditing(null);
      onChanged();
    } catch (e) {
      setErr(ltxError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteBook(confirm.id);
      if (selected === confirm.id) onSelect("");
      setConfirm(null);
      onChanged();
    } catch (e) {
      // A non-empty book is refused by the API (409). That is the right place for the
      // check — the count here could be a version stale by one render.
      setErr(ltxError(e));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Books
        </Typography>
        <TextField
          select
          size="small"
          label="Filter"
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">All books</MenuItem>
          {books.map((b) => (
            <MenuItem key={b.id} value={b.id}>
              {b.name} ({b.recipe_count})
            </MenuItem>
          ))}
        </TextField>
        <Button startIcon={<Add />} variant="outlined" onClick={() => open("new")}>
          Add book
        </Button>
      </Stack>

      {err && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr(null)}>
          {err}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
        {books.map((b) => (
          <Card key={b.id} sx={{ p: 1 }} variant="outlined">
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2">{b.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {b.recipe_count} {b.recipe_count === 1 ? "pose" : "poses"}
                  {b.description ? ` · ${b.description}` : ""}
                </Typography>
              </Box>
              <Tooltip title="Edit">
                <IconButton size="small" onClick={() => open(b)}>
                  <Edit fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip
                title={b.recipe_count > 0 ? "Move or delete its poses first" : "Delete"}
              >
                <span>
                  <IconButton
                    size="small"
                    disabled={b.recipe_count > 0}
                    onClick={() => setConfirm(b)}
                  >
                    <DeleteOutline fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Card>
        ))}
        {books.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No books yet.
          </Typography>
        )}
      </Stack>

      <Dialog open={!!editing} onClose={() => setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>{editing === "new" ? "New book" : `Edit ${name}`}</DialogTitle>
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
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              helperText="Optional — which base model or dataset this shelf is for."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="contained" disabled={busy || !name.trim()} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)}>
        <DialogTitle>Delete {confirm?.name}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Renders already produced keep working — a segment records what it ran, so history
            does not depend on this book still existing.
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

// ---------------------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------------------

function PoseList({
  catalog,
  bookId,
  contentLoras,
  checkpoints,
  onChanged,
}: {
  catalog: RecipeCatalog | null;
  bookId: string;
  contentLoras: string[];
  checkpoints: string[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Pose | "new" | null>(null);
  const [confirm, setConfirm] = useState<Pose | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const allPoses = catalog?.poses ?? [];
  const poses = bookId ? allPoses.filter((p) => p.book_id === bookId) : allPoses;
  const bookName = catalog?.books.find((b) => b.id === bookId)?.name;

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
                  {!bookId && (
                    <Chip size="small" variant="outlined" label={p.book_name} />
                  )}
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
            {bookId ? `No poses in ${bookName ?? "this book"} yet.` : "No poses yet."}
          </Typography>
        )}
      </Stack>

      {editing && (
        <PoseDialog
          pose={editing === "new" ? null : editing}
          defaultNegative={catalog?.default_negative_prompt ?? ""}
          characters={catalog?.characters ?? []}
          books={catalog?.books ?? []}
          defaultBookId={bookId}
          contentLoras={contentLoras}
          checkpoints={checkpoints}
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
  defaultNegative,
  characters,
  books,
  defaultBookId,
  contentLoras: contentLorasAvailable,
  checkpoints,
  onClose,
  onSaved,
}: {
  pose: Pose | null;
  /** What a pose with no override renders with — the Settings negative prompt. Shown as
   *  the field's placeholder, never as its value. */
  defaultNegative: string;
  characters: Character[];
  books: Book[];
  /** Which book a NEW pose lands in. An existing pose keeps its own; the dialog's field is
   *  only a default, so a pose edited from an "All books" view is never silently moved. */
  defaultBookId: string;
  contentLoras: string[];
  checkpoints: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // A duplicate arrives as a pose object with an empty id: same fields, but it must POST.
  const isNew = !pose?.id;
  const [name, setName] = useState(pose?.name ?? "");
  // A duplicate carries the source pose's book_id, so it lands on the same shelf; a
  // brand-new pose lands wherever the list is currently filtered to.
  const [bookId, setBookId] = useState(pose?.book_id || defaultBookId);
  const [template, setTemplate] = useState(pose?.prompt_template ?? `${TRIGGER_PLACEHOLDER}, `);
  // The pose's OWN override, not the resolved value. Binding to the resolved one is what
  // pinned every pose in production to a copy of the default: the box came up pre-filled
  // with it, save wrote it back as an override, and the Settings negative prompt could
  // then never apply to anything (console#430). Empty means "inherit", and the default is
  // shown as the placeholder so that is visible without being typed in.
  const [negative, setNegative] = useState(initialNegativeOverride(pose));
  const [frames, setFrames] = useState(pose?.frames ? String(pose.frames) : "");
  // Empty string means "use the stack's value". "0" is a real setting and must survive,
  // so this is deliberately not `pose?.img_compression ? ... : ""`.
  const [imgCompression, setImgCompression] = useState(
    pose?.img_compression != null ? String(pose.img_compression) : "",
  );
  // Content LoRAs, in application order. They stack (console#410): motion, act and framing
  // are separable and a pose may want several. Order is part of the configuration — the same
  // LoRAs applied in a different order render differently — so this is a list, not a set,
  // and adding appends rather than sorting.
  const [contentLoras, setContentLoras] = useState<ContentLoraDraft[]>(
    pose?.content_loras?.length
      ? pose.content_loras.map((c) => ({ name: c.name, s1: String(c.s1), s2: String(c.s2) }))
      : [],
  );

  // 0.6 is what the engine applied before any of this was configurable, so a LoRA added and
  // left alone renders at the strength the validated graph already used. That is what keeps
  // four LoRAs from being eight decisions.
  const addContentLora = (name: string) =>
    setContentLoras((cur) =>
      cur.length >= MAX_CONTENT_LORAS ? cur : [...cur, { name, s1: "0.6", s2: "0.6" }]);

  const updateContentLora = (i: number, patch: Partial<ContentLoraDraft>) =>
    setContentLoras((cur) => cur.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  // Removing shifts everything after it up, which changes the chain — that is correct and
  // is also how order is edited, since there is no drag-to-reorder.
  const removeContentLora = (i: number) =>
    setContentLoras((cur) => cur.filter((_, j) => j !== i));

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
    if (!bookId) {
      setErr("Pick a book for this pose. Books are how poses trained on different base models are kept apart.");
      return;
    }
    // The typed strings become numbers here, once, and a bad one names its LoRA rather
    // than being sent on. parseContentLoraStrength holds the engine's 0-2 bound, which it
    // otherwise enforces with a 422 ten minutes into a claimed segment.
    const resolved: ContentLora[] = [];
    for (const c of contentLoras) {
      const s1 = parseContentLoraStrength(c.s1);
      const s2 = parseContentLoraStrength(c.s2);
      if (s1 === null || s2 === null) {
        const label = s1 === null ? "stage 1" : "stage 2";
        setErr(`${c.name} ${label} strength must be a number between 0 and 2.`);
        return;
      }
      resolved.push({ name: c.name, s1, s2 });
    }
    setSaving(true);
    setErr(null);
    try {
      const draft = {
        name: name.trim(),
        book_id: bookId,
        prompt_template: template,
        // "" is the user clearing an override, which means "use the Settings default".
        // Sending "" instead would store an empty negative prompt, which is a different
        // and much worse thing.
        negative_prompt: negativeOverrideToSend(negative),
        frames: overrideNumber(frames),
        img_compression: overrideNumber(imgCompression),
        // Sent even when empty: [] is how the LoRAs are CLEARED, and the API distinguishes
        // that from undefined, which means "leave them alone".
        content_loras: resolved,
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
          <Stack direction="row" spacing={2}>
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              autoFocus
            />
            <TextField
              select
              label="Book"
              value={bookId}
              onChange={(e) => setBookId(e.target.value)}
              sx={{ minWidth: 220 }}
              helperText="Names are unique within a book."
            >
              {books.map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            label="Prompt template"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            fullWidth
            multiline
            minRows={4}
            helperText={`${TRIGGER_PLACEHOLDER} is replaced with the character's trigger phrase — a joint LoRA carries every identity in it. The scene text names who is who. This box shows the template, not the result.`}
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
            placeholder={defaultNegative}
            fullWidth
            multiline
            minRows={2}
            helperText="Empty inherits the default from Settings, shown greyed out above."
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

          {/* Content LoRAs are the POSE's — motion and act — chained AHEAD of the
              character LoRA, which is identity. Two different axes, so this list is filtered
              to the bucket's content/ shelf and can never offer a character. They stack, and
              the order shown is the order applied. */}
          <Divider textAlign="left" sx={{ pt: 1 }}>
            <Typography variant="overline" color="text.secondary">
              Content LoRAs
            </Typography>
          </Divider>

          {contentLoras.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              None. Most poses have none — the recipe renders on the base model plus the
              character LoRA.
            </Typography>
          )}

          {contentLoras.map((c, i) => (
            <Stack key={`${c.name}-${i}`} direction="row" spacing={1.5} alignItems="center"
                   useFlexGap flexWrap="wrap">
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 18 }}>
                {i + 1}
              </Typography>
              <Typography variant="body2" sx={{ flex: "1 1 220px", minWidth: 160 }} noWrap>
                {c.name}
              </Typography>
              <TextField
                label="Stage 1" size="small" sx={{ width: 110 }}
                value={c.s1}
                onChange={(e) => updateContentLora(i, { s1: e.target.value })}
                slotProps={{ htmlInput: { inputMode: "decimal" } }}
              />
              <TextField
                label="Stage 2" size="small" sx={{ width: 110 }}
                value={c.s2}
                onChange={(e) => updateContentLora(i, { s2: e.target.value })}
                slotProps={{ htmlInput: { inputMode: "decimal" } }}
              />
              <IconButton size="small" onClick={() => removeContentLora(i)} aria-label="remove">
                <DeleteOutline fontSize="small" />
              </IconButton>
            </Stack>
          ))}

          {/* Adding appends, because insertion order IS application order. Reordering means
              removing and re-adding, which is deterministic and needs no extra UI. */}
          <TextField
            select
            size="small"
            label={contentLoras.length >= MAX_CONTENT_LORAS
              ? `Limit of ${MAX_CONTENT_LORAS} reached`
              : "Add a content LoRA"}
            value=""
            disabled={contentLoras.length >= MAX_CONTENT_LORAS}
            onChange={(e) => e.target.value && addContentLora(e.target.value)}
            sx={{ maxWidth: 420 }}
            helperText="Applied in the order listed, ahead of the character LoRA. Strengths default to 0.6 — what the engine used before this was adjustable."
          >
            {contentLoras.length === 0 && contentLorasAvailable.length === 0 && (
              <MenuItem value="" disabled><em>None in the bucket</em></MenuItem>
            )}
            {contentLorasAvailable.map((l) => (
              <MenuItem key={l} value={l}>{l}</MenuItem>
            ))}
          </TextField>

          {/* Base model. A real dropdown, from what live workers report through their
              heartbeats — the engine binds to localhost so nothing upstream can enumerate
              these, and a hand-maintained list would drift from the boxes it describes. */}
          <TextField
            select
            label="Base model"
            value={checkpoints.includes(checkpoint) ? checkpoint : ""}
            onChange={(e) => setCheckpoint(e.target.value)}
            fullWidth
            sx={{ maxWidth: 640 }}
            helperText="Stack default is 10Eros_v1.5_bf16. Character LoRAs were trained against sulphur, so on any other base — the default included — a LoRA can fuse nothing at all and the render comes back without the character; check the segment log for 'fuses N/M weights'."
          >
            <MenuItem value="">
              <em>Stack default</em>
            </MenuItem>
            {checkpoints.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>

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
  catalog,
  loras,
  onChanged,
}: {
  catalog: RecipeCatalog | null;
  loras: string[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Character | "new" | null>(null);
  const [confirm, setConfirm] = useState<Character | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const characters = catalog?.characters ?? [];

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
              {/* The anchor image of the dataset that trained it, when a run set one. */}
              <Avatar
                src={c.image_uri ? getFileUrl(c.image_uri) : undefined}
                variant="rounded"
                sx={{ width: 48, height: 48 }}
              >
                {c.name.slice(0, 1).toUpperCase()}
              </Avatar>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="subtitle2">{c.name}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {c.char_lora} · renders “{triggerPhrase(c)}” · stage 1 {c.strength_stage_1} ·
                  stage 2 {c.strength_stage_2}
                </Typography>
                {c.trained_from && c.trained_from.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    Trained from:{" "}
                    {c.trained_from.map((d, i) => (
                      <span key={i}>
                        {i > 0 && " · "}
                        {d.dataset_id
                          ? <Link to={`/datasets?dataset=${d.dataset_id}`}
                              style={{ color: "inherit" }}>
                              {d.name ?? "unnamed"} ({d.count})
                            </Link>
                          : `${d.name ?? "ad-hoc"} (${d.count})`}
                      </span>
                    ))}
                  </Typography>
                )}
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
  // "" is "none": the row's gender is cleared, and the bare trigger renders as it did
  // before console#487.
  const [gender, setGender] = useState<"" | Gender>(character?.gender ?? "");
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
          gender: gender || null,
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
          // Always sent: unlike the trigger, "" here is a real answer (clear it).
          gender: gender || null,
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
          <TextField
            select
            label="Gender"
            value={gender}
            onChange={(e) => setGender(e.target.value as "" | Gender)}
            fullWidth
            helperText={
              `The word the LoRA's caption bound the trigger to. Every pose renders ` +
              `“${(trigger.trim() || name.trim() || "trigger")}${gender ? `, ${gender}` : ""}” ` +
              `— match what trained, or the identity is only half named.`
            }
          >
            <MenuItem value=""><em>None — bare trigger</em></MenuItem>
            <MenuItem value="woman">woman</MenuItem>
            <MenuItem value="man">man</MenuItem>
            <MenuItem value="person">person</MenuItem>
          </TextField>
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
