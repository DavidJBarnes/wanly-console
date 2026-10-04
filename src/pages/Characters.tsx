import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Avatar, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, IconButton, MenuItem, Stack, TextField, Tooltip,
  Typography,
} from "@mui/material";
import { Add, AutoAwesome, DeleteOutline, Edit } from "@mui/icons-material";
import { Link } from "react-router";

import {
  checkCharacterProvenance, createCharacter, deleteCharacter, getLoraProvenance, listLoras,
  listRecipes, ltxError, setDefaultCharacter, TRIGGER_PLACEHOLDER, updateCharacter,
} from "../api/ltx";
import type { Character } from "../api/ltx";
import type { Gender } from "../api/types";
import { getFileUrl } from "../api/client";
import DefaultStar from "../components/DefaultStar";
import PickFromRepoDialog from "../components/PickFromRepoDialog";
import SheetBuilderDialog from "../components/SheetBuilderDialog";
import { SheetPreview, SheetViewerDialog } from "../components/SheetPreview";
import {
  draftFor, draftMessage, fillPhrase, formError, formFor, formIsDraft, hasLora, identityBadges,
  isDraft, referenceMode, sheetSizeWarning, type CharacterForm,
} from "../lib/characterIdentity";
import { characterHasTrained } from "../lib/trainingJob";
import {
  applyProvenance, autoFillOf, describeFix, fixPatch, mismatchLabel, NO_AUTOFILL,
  provenanceHint, type AutoFill, type CharacterProvenance, type LoraProvenance,
  type ProvenanceMismatch,
} from "../lib/loraProvenance";

/**
 * Characters (console#579, epic #581): who a render is of.
 *
 * A character used to be "a LoRA plus a trigger", and lived at the bottom of LoRA Recipes.
 * Phase 0 (wanly-gpu-docker#155) showed a 1536x1024 character sheet, conditioned into the
 * render, holding identity better than the LoRA alone -- so a character is now a LoRA, a
 * character sheet, or both, and it gets its own page. Poses stay in LoRA Recipes.
 *
 * Or, for now, NEITHER (console#592): a DRAFT, saved with just a name so Build sheet -- which
 * works on an existing character -- can make its first sheet. A draft cannot render.
 */
export default function Characters() {
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [loras, setLoras] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Character | "new" | null>(null);
  const [confirm, setConfirm] = useState<Character | null>(null);
  const [building, setBuilding] = useState<Character | null>(null);
  const [viewing, setViewing] = useState<Character | null>(null);
  const [busy, setBusy] = useState(false);
  // Where each character's trigger/gender disagree with how its LoRA trained (console#596).
  const [checks, setChecks] = useState<Record<string, CharacterProvenance>>({});
  const [fixing, setFixing] = useState<{ c: Character; ms: ProvenanceMismatch[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await listRecipes();
      setCharacters(b.characters ?? []);
      setLoras(await listLoras(b, "character"));
      setError(null);
      // Advisory, so a failure here never hides the list: no badges is the fallback.
      checkCharacterProvenance()
        .then((rows) => setChecks(Object.fromEntries(rows.map((r) => [r.id, r]))))
        .catch(() => setChecks({}));
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
        from the Image Repo, or built here from one photo of her with Build sheet) is
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
          const check = checks[c.id];
          const ms = check?.mismatches ?? [];
          const thumb = c.sheet_uri ?? c.image_uri ?? c.face_ref_uri;
          return (
            <Card key={c.id} sx={{ p: 1.5 }} variant="outlined">
              <Stack direction="row" alignItems="center" spacing={2}>
                {c.sheet_uri ? (
                  // The sheet is what the character renders with: big enough to recognise,
                  // and a click opens it (console#598).
                  <Tooltip title="View sheet">
                    <Box sx={{ width: 144, flexShrink: 0 }}>
                      <SheetPreview uri={c.sheet_uri} alt={`${c.name} sheet`} labels={false}
                                    onClick={() => setViewing(c)} />
                    </Box>
                  </Tooltip>
                ) : (
                  <Avatar src={thumb ? getFileUrl(thumb) : undefined} variant="rounded"
                          sx={{ width: 48, height: 48 }}>
                    {c.name.slice(0, 1).toUpperCase()}
                  </Avatar>
                )}
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="subtitle2">{c.name}</Typography>
                    {badges.map((b) => (
                      <Chip key={b} size="small" label={b} variant="outlined"
                            color={b === "LoRA" ? "primary" : "secondary"} />
                    ))}
                    {isDraft(c, characters ?? []) && (
                      <Tooltip title={draftMessage(c.name)}>
                        <Chip size="small" label="Draft: needs a LoRA or a sheet"
                              color="warning" variant="outlined" />
                      </Tooltip>
                    )}
                    {ms.map((m) => (
                      <Tooltip key={m.field}
                               title={`Stored: ${m.stored ?? "none"} · ${provenanceHint(check.provenance) ?? ""}. Click to use the trained values.`}>
                        <Chip size="small" color="warning" label={mismatchLabel(m)}
                              onClick={() => setFixing({ c, ms })} />
                      </Tooltip>
                    ))}
                    {ms.length > 0 && (
                      <Button size="small" color="warning" onClick={() => setFixing({ c, ms })}>
                        Use trained values
                      </Button>
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
                  <Tooltip title={c.sheet_uri
                    ? "See every sheet saved for her, switch between them, or build a new one"
                    : "Build a sheet from one photo of her"}>
                    <Button size="small" startIcon={<AutoAwesome fontSize="small" />}
                            onClick={() => setBuilding(c)}>
                      {c.sheet_uri ? "Sheets" : "Build sheet"}
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
            No characters yet — add one with a LoRA, a character sheet, or both, or just a
            name and build its sheet.
          </Typography>
        )}
      </Stack>

      {editing && (
        <CharacterDialog
          character={editing === "new" ? null : editing}
          loras={loras}
          check={editing === "new" ? undefined : checks[editing.id]}
          onFixed={() => void load()}
          onClose={() => setEditing(null)}
          onSaved={(c, buildSheet) => {
            setEditing(null);
            // "Save & build sheet" on a new draft (console#592): straight on to its first sheet.
            if (buildSheet) setBuilding(c);
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

      {viewing?.sheet_uri && (
        <SheetViewerDialog
          uri={viewing.sheet_uri}
          title={`${viewing.name} — character sheet`}
          subtitle={`${viewing.sheet_uri.split("/").pop()}${referenceMode(viewing) === "face"
            ? " · not used: renders with the face reference" : ""}`}
          onClose={() => setViewing(null)}
          actions={
            <>
              {(viewing.kind ?? "solo") !== "pair" && (
                <Button startIcon={<AutoAwesome fontSize="small" />}
                        onClick={() => { setBuilding(viewing); setViewing(null); }}>
                  Sheets & build new
                </Button>
              )}
              <Button startIcon={<Edit fontSize="small" />}
                      onClick={() => { setEditing(viewing); setViewing(null); }}>
                Edit character
              </Button>
            </>
          }
        />
      )}

      {fixing && (
        <UseTrainedDialog
          character={fixing.c} mismatches={fixing.ms}
          onClose={() => setFixing(null)}
          onFixed={() => {
            setFixing(null);
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

/** Confirm, then write the trained trigger/gender over a character's stored ones
 *  (console#596). Never automatic: each fix is a click and a confirm. */
function UseTrainedDialog({
  character, mismatches, onClose, onFixed,
}: {
  character: Character;
  mismatches: ProvenanceMismatch[];
  onClose: () => void;
  onFixed: (c: Character) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const apply = async () => {
    setSaving(true);
    setErr(null);
    try {
      onFixed(await updateCharacter(character.id, fixPatch(mismatches)));
    } catch (e) {
      setErr(ltxError(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onClose={onClose}>
      <DialogTitle>Use the trained values for {character.name}?</DialogTitle>
      <DialogContent>
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <Typography variant="body2">
          Its LoRA trained on different words than the character stores. This changes{" "}
          {describeFix(mismatches)}, so every pose renders {TRIGGER_PLACEHOLDER} the way the
          LoRA learned it.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="warning" disabled={saving} onClick={() => void apply()}>
          {saving ? "Saving…" : "Use trained values"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** A picked reference image, with its measured size and, for a sheet, the layout warning.
 *  Fit / Actual size toggles between the whole image and every pixel. */
function ReferenceImage({
  uri, sheet, onRemove,
}: { uri: string; sheet: boolean; onRemove: () => void }) {
  const [size, setSize] = useState<{ uri: string; w: number; h: number } | null>(null);
  // A sheet opens fitted to the dialog, so it reads as a whole (console#598); a face
  // reference opens at actual size.
  const [fit, setFit] = useState(sheet);
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
  character, loras, check, onFixed, onClose, onSaved,
}: {
  character: Character | null;
  loras: string[];
  /** This character's provenance check, if its LoRA has one (console#596). */
  check?: CharacterProvenance;
  onFixed: () => void;
  onClose: () => void;
  onSaved: (c: Character, buildSheet: boolean) => void;
}) {
  const isNew = !character;
  // Once a character has trained, its trigger and gender are what the LoRA learned: another
  // trigger would name nothing, and the API refuses the change (#537).
  const locked = !isNew && characterHasTrained(character!);
  const [form, setForm] = useState<CharacterForm>(() => formFor(character));
  const [picking, setPicking] = useState<"sheet" | "face" | null>(null);
  const [building, setBuilding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<CharacterForm>) => setForm((f) => ({ ...f, ...patch }));
  // How the picked LoRA trained (console#596), and what the last auto-fill wrote, so a
  // later pick replaces only its own values and never something typed.
  const [prov, setProv] = useState<LoraProvenance | null>(null);
  const [fixOpen, setFixOpen] = useState(false);
  const [fixed, setFixed] = useState(false);
  const autoRef = useRef<AutoFill>(NO_AUTOFILL);
  const seqRef = useRef(0);
  const initialLora = character?.char_lora && hasLora(character.char_lora)
    ? character.char_lora : null;
  useEffect(() => {
    if (!initialLora) return;
    let live = true;
    getLoraProvenance(initialLora).then((p) => { if (live) setProv(p); }).catch(() => {});
    return () => { live = false; };
  }, [initialLora]);

  const pickLora = async (lora: string) => {
    set({ lora });
    const seq = ++seqRef.current;
    let p: LoraProvenance | null = null;
    if (lora) {
      try {
        p = await getLoraProvenance(lora);
      } catch {
        p = null;
      }
    }
    if (seq !== seqRef.current) return; // a later pick won
    setProv(p);
    // A trained character's trigger and gender are locked: nothing to fill.
    if (locked) return;
    const last = autoRef.current;
    autoRef.current = autoFillOf(p);
    setForm((f) => ({ ...f, ...applyProvenance(f, p, last) }));
  };
  const sameLora = (a: string, b: string) =>
    a.trim().replace(/\.safetensors$/i, "") === b.trim().replace(/\.safetensors$/i, "");
  const mismatches = !fixed && check && sameLora(form.lora, check.char_lora)
    ? check.mismatches : [];
  const hint = form.lora ? provenanceHint(prov) : null;
  const withLora = form.lora.trim() !== "";
  const problem = formError(form);
  // Neither a LoRA nor a sheet: saved as a DRAFT (console#592). Fine -- it is how a new
  // character gets to Build sheet -- but it cannot render until it has one.
  const draft = formIsDraft(form);
  const canBuild = (character?.kind ?? "solo") !== "pair";

  const save = async (buildSheet = false) => {
    if (problem) {
      setErr(problem);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const body = draftFor(form, character, locked);
      const saved = isNew
        ? await createCharacter({ name: form.name.trim(), ...body })
        : await updateCharacter(character!.id, body);
      onSaved(saved, buildSheet);
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
          {draft && (
            <Alert severity="warning">
              No LoRA and no character sheet: this saves as a <b>draft</b>, which cannot render
              until it has one. {canBuild
                ? "Save & build sheet makes its first sheet from one photo of her."
                : "A pair renders with its first member's sheet, or attach a joint LoRA."}
            </Alert>
          )}

          <Divider textAlign="left"><Typography variant="overline">LoRA (optional)</Typography></Divider>
          <TextField
            select={loras.length > 0} label="Character LoRA" value={form.lora} fullWidth
            onChange={(e) => void pickLora(e.target.value)}
            helperText={hint
              ? (hint.startsWith("from") ? `Trigger and gender ${hint}.` : hint)
              : "The LoRA file name, without .safetensors. None: the character sheet carries the identity alone."}
          >
            <MenuItem value=""><em>None — no LoRA</em></MenuItem>
            {loras.map((l) => <MenuItem key={l} value={l}>{l}</MenuItem>)}
          </TextField>
          {mismatches.length > 0 && (
            <Alert severity="warning" action={
              <Button color="inherit" size="small" onClick={() => setFixOpen(true)}>
                Use trained values
              </Button>
            }>
              {mismatches.map(mismatchLabel).join(" · ")}
              {" "}(stored: {mismatches.map((m) => m.stored ?? "none").join(", ")};{" "}
              {provenanceHint(check!.provenance)}).
            </Alert>
          )}
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
              helperText={locked ? "Fixed by training."
                : withLora ? "The word the LoRA's caption bound the trigger to."
                  : "Sets Build sheet's pronoun; also what a later LoRA's captions bind to."}
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
          {form.sheetUri && (
            <ReferenceImage uri={form.sheetUri} sheet
                            onRemove={() => set({ sheetUri: "",
                              identityMode: form.identityMode === "sheet" ? "" : form.identityMode })} />
          )}
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
            {canBuild && (
              // An existing character builds in place and the approved sheet lands in this
              // form; a new one has to be saved first, as Build sheet works on a saved
              // character (console#592, #598).
              <Button variant={form.sheetUri ? "text" : "contained"}
                      startIcon={<AutoAwesome fontSize="small" />}
                      disabled={saving || (isNew && problem !== null)}
                      onClick={() => (isNew ? void save(true) : setBuilding(true))}>
                {form.sheetUri ? "Sheets & build new" : isNew ? "Save & build sheet" : "Build sheet"}
              </Button>
            )}
            <Button variant={form.sheetUri ? "text" : "outlined"} onClick={() => setPicking("sheet")}>
              {form.sheetUri ? "Replace from the Image Repo" : "Choose sheet from the Image Repo"}
            </Button>
            {!form.sheetUri && (
              <Typography variant="caption" color="text.secondary">
                A 1536×1024 turnaround. Dress it in the start frame's outfit: in wide shots the
                body the model invents takes the sheet's clothes.
              </Typography>
            )}
          </Stack>

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
        {draft && canBuild && (
          <Button variant="outlined" startIcon={<AutoAwesome fontSize="small" />}
                  disabled={saving || problem !== null} onClick={() => void save(true)}>
            Save & build sheet
          </Button>
        )}
        <Button variant="contained" disabled={saving || problem !== null}
                onClick={() => void save()}>
          {saving ? "Saving…" : draft ? "Save draft" : "Save"}
        </Button>
      </DialogActions>

      {fixOpen && character && (
        <UseTrainedDialog
          character={character} mismatches={mismatches}
          onClose={() => setFixOpen(false)}
          onFixed={(c) => {
            setFixOpen(false);
            setFixed(true);
            set({ trigger: c.trigger ?? "", gender: c.gender ?? "" });
            onFixed();
          }}
        />
      )}

      {building && character && (
        <SheetBuilderDialog
          character={{ ...character, sheet_uri: form.sheetUri || null }}
          onClose={() => setBuilding(false)}
          // The API has already saved it as the character's sheet; the form follows, so a
          // later Save keeps it rather than writing the old one back.
          onSaved={(c) => {
            set({ sheetUri: c.sheet_uri ?? "" });
            onFixed();
          }}
        />
      )}

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
