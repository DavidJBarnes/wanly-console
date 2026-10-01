import { useCallback, useEffect, useState } from "react";
import {
  Alert, Avatar, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, IconButton, MenuItem, Stack, TextField, Tooltip,
  Typography,
} from "@mui/material";
import { Add, AutoAwesome, DeleteOutline, Edit } from "@mui/icons-material";
import { Link } from "react-router";

import {
  createCharacter, deleteCharacter, listLoras, listRecipes, ltxError, setDefaultCharacter,
  TRIGGER_PLACEHOLDER, updateCharacter,
} from "../api/ltx";
import type { Character } from "../api/ltx";
import type { Gender } from "../api/types";
import { getFileUrl } from "../api/client";
import DefaultStar from "../components/DefaultStar";
import PickFromRepoDialog from "../components/PickFromRepoDialog";
import SheetBuilderDialog from "../components/SheetBuilderDialog";
import {
  draftFor, fillPhrase, formError, formFor, hasLora, identityBadges, referenceMode,
  sheetSizeWarning, type CharacterForm,
} from "../lib/characterIdentity";
import { characterHasTrained } from "../lib/trainingJob";

/**
 * Characters (console#579, epic #581): who a render is of.
 *
 * A character used to be "a LoRA plus a trigger", and lived at the bottom of LoRA Recipes.
 * Phase 0 (wanly-gpu-docker#155) showed a 1536x1024 character sheet, conditioned into the
 * render, holding identity better than the LoRA alone -- so a character is now a LoRA, a
 * character sheet, or both, and it gets its own page. Poses stay in LoRA Recipes.
 */
export default function Characters() {
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [loras, setLoras] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Character | "new" | null>(null);
  const [confirm, setConfirm] = useState<Character | null>(null);
  const [building, setBuilding] = useState<Character | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const b = await listRecipes();
      setCharacters(b.characters ?? []);
      setLoras(await listLoras(b, "character"));
      setError(null);
    } catch (e) {
      setError(ltxError(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleDefault = async (c: Character) => {
    try {
      await setDefaultCharacter(c.id, !c.is_default);
      await load();
    } catch (e) {
      setError(ltxError(e));
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await deleteCharacter(confirm.id);
      setConfirm(null);
      await load();
    } catch (e) {
      setError(ltxError(e));
    } finally {
      setBusy(false);
    }
  };

  if (characters === null && !error) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          Characters ({characters?.length ?? 0})
        </Typography>
        <Button startIcon={<Add />} variant="outlined" onClick={() => setEditing("new")}>
          Add character
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        A character is a LoRA, a character sheet, or both. The sheet (a 1536×1024 turnaround
        from the Image Repo, or built here from a real face photo with Build sheet) is
        conditioned into every render of the character and held identity better than the LoRA
        alone in testing; it adds about a third to render time.
        Every pose in <Link to="/lora-recipes">LoRA Recipes</Link> works for every character.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
      )}

      <Stack spacing={1}>
        {(characters ?? []).map((c) => {
          const badges = identityBadges(c);
          const thumb = c.sheet_uri ?? c.image_uri ?? c.face_ref_uri;
          return (
            <Card key={c.id} sx={{ p: 1.5 }} variant="outlined">
              <Stack direction="row" alignItems="center" spacing={2}>
                <Avatar src={thumb ? getFileUrl(thumb) : undefined} variant="rounded"
                        sx={{ width: c.sheet_uri ? 72 : 48, height: 48 }}>
                  {c.name.slice(0, 1).toUpperCase()}
                </Avatar>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="subtitle2">{c.name}</Typography>
                    {badges.map((b) => (
                      <Chip key={b} size="small" label={b} variant="outlined"
                            color={b === "LoRA" ? "primary" : "secondary"} />
                    ))}
                    {badges.length === 0 && (
                      <Chip size="small" label="not trained yet" variant="outlined" />
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {hasLora(c.char_lora)
                      ? `${c.char_lora} @ ${c.strength_stage_1}/${c.strength_stage_2} · `
                      : ""}
                    {fillPhrase(c)
                      ? `${TRIGGER_PLACEHOLDER} renders “${fillPhrase(c)}”`
                      : `${TRIGGER_PLACEHOLDER} is dropped (no trigger or description)`}
                    {referenceMode(c) === "face" ? " · renders with the face reference" : ""}
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
                <DefaultStar isDefault={!!c.is_default} what="character"
                             onToggle={() => toggleDefault(c)} />
                {(c.kind ?? "solo") !== "pair" && (
                  <Tooltip title={c.sheet_uri ? "Build a new sheet from a face photo"
                    : "Build a sheet from a face photo"}>
                    <Button size="small" startIcon={<AutoAwesome fontSize="small" />}
                            onClick={() => setBuilding(c)}>
                      Build sheet
                    </Button>
                  </Tooltip>
                )}
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
          );
        })}
        {characters?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No characters yet — add one with a LoRA, a character sheet, or both.
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
            void load();
          }}
        />
      )}

      {building && (
        <SheetBuilderDialog
          character={building}
          onClose={() => setBuilding(null)}
          onSaved={(c) => {
            setBuilding(c);
            void load();
          }}
        />
      )}

      <Dialog open={!!confirm} onClose={() => setConfirm(null)}>
        <DialogTitle>Delete {confirm?.name}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Poses are not affected — they belong to every character. Renders already produced
            keep working, and the LoRA and the sheet stay where they are.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button color="error" disabled={busy} onClick={remove}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/** A picked reference image: full size by default (a sheet has to be READ to be checked),
 *  with its measured size and, for a sheet, the layout warning. */
function ReferenceImage({
  uri, sheet, onRemove,
}: { uri: string; sheet: boolean; onRemove: () => void }) {
  const [size, setSize] = useState<{ uri: string; w: number; h: number } | null>(null);
  const [fit, setFit] = useState(false);
  const measured = size && size.uri === uri ? size : null;
  const warning = sheet && measured ? sheetSizeWarning(measured.w, measured.h) : null;
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }} noWrap>
          {uri.split("/").pop()}
          {measured ? ` — ${measured.w}×${measured.h}` : ""}
        </Typography>
        <Button size="small" onClick={() => setFit((f) => !f)}>
          {fit ? "Actual size" : "Fit"}
        </Button>
        <Button size="small" href={getFileUrl(uri)} target="_blank" rel="noreferrer">
          Open
        </Button>
        <Button size="small" color="error" onClick={onRemove}>Remove</Button>
      </Stack>
      {warning && <Alert severity="warning" sx={{ py: 0 }}>{warning}</Alert>}
      <Box sx={{ overflow: "auto", maxHeight: "60vh", border: 1, borderColor: "divider",
                 borderRadius: 1, bgcolor: "action.hover" }}>
        <img
          src={getFileUrl(uri)}
          alt={sheet ? "character sheet" : "face reference"}
          onLoad={(e) => setSize({ uri, w: e.currentTarget.naturalWidth,
                                   h: e.currentTarget.naturalHeight })}
          style={{ display: "block", maxWidth: fit ? "100%" : "none" }}
        />
      </Box>
    </Stack>
  );
}

function CharacterDialog({
  character, loras, onClose, onSaved,
}: {
  character: Character | null;
  loras: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !character;
  // Once a character has trained, its trigger and gender are what the LoRA learned: another
  // trigger would name nothing, and the API refuses the change (#537).
  const locked = !isNew && characterHasTrained(character!);
  const [form, setForm] = useState<CharacterForm>(() => formFor(character));
  const [picking, setPicking] = useState<"sheet" | "face" | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<CharacterForm>) => setForm((f) => ({ ...f, ...patch }));
  const withLora = form.lora.trim() !== "";
  const problem = formError(form, character);

  const save = async () => {
    if (problem) {
      setErr(problem);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const draft = draftFor(form, character, locked);
      if (isNew) await createCharacter({ name: form.name.trim(), ...draft });
      else await updateCharacter(character!.id, draft);
      onSaved();
    } catch (e) {
      setErr(ltxError(e));
    } finally {
      setSaving(false);
    }
  };

  // What <TRIGGER> will render as, live.
  const preview = fillPhrase({
    trigger: form.trigger.trim() || (withLora && isNew ? form.name.trim() : null),
    gender: form.gender || null,
    description: form.description,
  });

  return (
    <Dialog open fullWidth maxWidth="lg" onClose={onClose}>
      <DialogTitle>{isNew ? "New character" : `Edit ${character?.name}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {err && <Alert severity="error">{err}</Alert>}
          <TextField label="Name" value={form.name} autoFocus fullWidth
                     onChange={(e) => set({ name: e.target.value })} />

          <Divider textAlign="left"><Typography variant="overline">LoRA (optional)</Typography></Divider>
          <TextField
            select={loras.length > 0} label="Character LoRA" value={form.lora} fullWidth
            onChange={(e) => set({ lora: e.target.value })}
            helperText="The LoRA file name, without .safetensors. None: the character sheet carries the identity alone."
          >
            <MenuItem value=""><em>None — no LoRA</em></MenuItem>
            {loras.map((l) => <MenuItem key={l} value={l}>{l}</MenuItem>)}
          </TextField>
          <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
            <TextField
              label="Trigger" value={form.trigger} disabled={locked}
              sx={{ flex: "2 1 220px" }}
              onChange={(e) => set({ trigger: e.target.value })}
              helperText={locked
                ? "Fixed: this character has trained, and its LoRA learned this trigger."
                : withLora
                  ? (isNew ? "Empty defaults to the name." : "Left empty, it is kept as it is.")
                  : "Only for a LoRA — a sheet-only character has no caption to match."}
            />
            <TextField
              select label="Gender" value={form.gender} disabled={locked}
              sx={{ flex: "1 1 160px" }}
              onChange={(e) => set({ gender: e.target.value as "" | Gender })}
              helperText={locked ? "Fixed by training." : "The word the LoRA's caption bound the trigger to."}
            >
              <MenuItem value=""><em>None — bare trigger</em></MenuItem>
              <MenuItem value="woman">woman</MenuItem>
              <MenuItem value="man">man</MenuItem>
              <MenuItem value="person">person</MenuItem>
            </TextField>
          </Stack>
          {withLora && (
            <Stack direction="row" spacing={2}>
              <TextField label="Strength stage 1" value={form.s1}
                         onChange={(e) => set({ s1: e.target.value })}
                         helperText="Body and anatomy" />
              <TextField label="Strength stage 2" value={form.s2}
                         onChange={(e) => set({ s2: e.target.value })}
                         helperText="Resolves the face. 0.8 / 1.5 is the validated pair." />
            </Stack>
          )}

          <Divider textAlign="left"><Typography variant="overline">Character sheet (optional)</Typography></Divider>
          {form.sheetUri ? (
            <ReferenceImage uri={form.sheetUri} sheet
                            onRemove={() => set({ sheetUri: "",
                              identityMode: form.identityMode === "sheet" ? "" : form.identityMode })} />
          ) : (
            <Box>
              <Button variant="outlined" onClick={() => setPicking("sheet")}>
                Choose sheet from the Image Repo
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                A 1536×1024 turnaround. Dress it in the start frame's outfit: in wide shots the
                body the model invents takes the sheet's clothes.
              </Typography>
            </Box>
          )}

          <Divider textAlign="left"><Typography variant="overline">Face reference (optional)</Typography></Divider>
          {form.faceRefUri ? (
            <ReferenceImage uri={form.faceRefUri} sheet={false}
                            onRemove={() => set({ faceRefUri: "",
                              identityMode: form.identityMode === "face" ? "" : form.identityMode })} />
          ) : (
            <Box>
              <Button variant="outlined" size="small" onClick={() => setPicking("face")}>
                Choose face from the Image Repo
              </Button>
            </Box>
          )}
          {form.sheetUri && form.faceRefUri && (
            <TextField
              select label="Renders with" value={form.identityMode || "sheet"}
              onChange={(e) => set({ identityMode: e.target.value as "sheet" | "face" })}
              helperText="One reference per render. The sheet held identity best in testing."
            >
              <MenuItem value="sheet">Character sheet</MenuItem>
              <MenuItem value="face">Face reference</MenuItem>
            </TextField>
          )}

          {(!form.trigger.trim() || !withLora) && (
            <TextField
              label="Description (optional)" value={form.description} fullWidth
              inputProps={{ maxLength: 255 }}
              onChange={(e) => set({ description: e.target.value })}
              helperText={`Fills ${TRIGGER_PLACEHOLDER} when there is no trigger, e.g. “a woman with auburn hair”. Empty: the placeholder is left out.`}
            />
          )}
          <Typography variant="caption" color="text.secondary">
            Every pose renders {TRIGGER_PLACEHOLDER} as{" "}
            {preview ? `“${preview}”` : "nothing (it is dropped)"}.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        {problem && !err && (
          <Typography variant="caption" color="text.secondary" sx={{ mr: "auto", ml: 2 }}>
            {problem}
          </Typography>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving || problem !== null} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>

      {picking && (
        <PickFromRepoDialog
          title={picking === "sheet" ? "Choose a character sheet" : "Choose a face reference"}
          onClose={() => setPicking(null)}
          onPick={(path) => {
            set(picking === "sheet" ? { sheetUri: path } : { faceRefUri: path });
            setPicking(null);
          }}
        />
      )}
    </Dialog>
  );
}
