import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Card, CardActionArea, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControlLabel, MenuItem, Stack, Switch, TextField,
  Tooltip, Typography,
} from "@mui/material";
import { Add, Star } from "@mui/icons-material";
import { Link, useNavigate } from "react-router";

import {
  checkCharacterProvenance, createCharacter, getLoraProvenance,
  listRecipes, ltxError, TRIGGER_PLACEHOLDER, updateCharacter,
} from "../api/ltx";
import type { Character } from "../api/ltx";
import type { Gender } from "../api/types";
import { getFileUrl, listDatasets } from "../api/client";
import type { Dataset } from "../api/types";
import NewCharacterDialog from "../components/NewCharacterDialog";
import PickFromRepoDialog from "../components/PickFromRepoDialog";
import { characterPicture } from "../lib/characterPage";
import {
  draftFor, fillPhrase, formError, formFor, formIsDraft, hasLora, identityBadges,
  isDraft, sheetSizeWarning, type CharacterForm,
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
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  // Where each character's trigger/gender disagree with how its LoRA trained (console#596).
  const [checks, setChecks] = useState<Record<string, CharacterProvenance>>({});
  const [fixing, setFixing] = useState<{ c: Character; ms: ProvenanceMismatch[] } | null>(null);
  // Every set, once (wanly-api#452): a character's anchor is its card picture, and sets with
  // no character are listed under the grid so nothing is unreachable.
  const [sets, setSets] = useState<Dataset[]>([]);
  const navigate = useNavigate();
  // New character = the character AND its (empty) dataset, one step (wanly-api#452).
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const b = await listRecipes();
      setCharacters(b.characters ?? []);
      setError(null);
      // Advisory, so a failure here never hides the list: no badges is the fallback.
      checkCharacterProvenance()
        .then((rows) => setChecks(Object.fromEntries(rows.map((r) => [r.id, r]))))
        .catch(() => setChecks({}));
    } catch (e) {
      setError(ltxError(e));
    }
  }, []);

  // The first read: the same as load(), with every state change after an await.
  useEffect(() => {
    let live = true;
    listRecipes()
      .then((b) => { if (live) { setCharacters(b.characters ?? []); setError(null); } })
      .catch((e) => { if (live) setError(ltxError(e)); });
    checkCharacterProvenance()
      .then((rows) => { if (live) setChecks(Object.fromEntries(rows.map((r) => [r.id, r]))); })
      .catch(() => { if (live) setChecks({}); });
    listDatasets().then((d) => { if (live) setSets(d); }).catch(() => { if (live) setSets([]); });
    return () => { live = false; };
  }, []);


  const own = (d: Dataset) => d.kind === "character" || d.kind === "composition";
  const anchorOf = new Map(sets.filter((d) => own(d) && d.anchor_uri && d.character)
    .map((d) => [d.character as string, d.anchor_uri as string]));
  const registered = new Set((characters ?? []).map((c) => c.name));
  const loose = sets.filter((d) => !own(d) || !d.character || !registered.has(d.character));
  const hiddenCount = (characters ?? []).filter((c) => c.hidden).length;
  const shown = (characters ?? []).filter((c) => showHidden || !c.hidden);

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
        <Button startIcon={<Add />} variant="contained" onClick={() => setCreating(true)}>
          New character
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

      <FormControlLabel
        sx={{ mb: 1 }}
        control={<Switch size="small" checked={showHidden}
                         onChange={(e) => setShowHidden(e.target.checked)} />}
        label={`Show hidden (${hiddenCount})`}
      />

      {/* A grid of cards, each led by the character's icon (console#616). Everything else --
          the sheet, Build sheet, versions, hide -- is in the character's own card. */}
      <Box sx={{ display: "grid", gap: 2,
                 gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
        {shown.map((c) => {
          const badges = identityBadges(c);
          const ms = checks[c.id]?.mismatches ?? [];
          return (
            <Card key={c.id} variant="outlined" sx={{ opacity: c.hidden ? 0.55 : 1 }}>
              <CardActionArea onClick={() => navigate(`/characters/${encodeURIComponent(c.name)}`)}>
                <CharacterHero character={c} anchor={anchorOf.get(c.name) ?? null} />
                <Box sx={{ p: 1.25 }}>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Typography variant="subtitle1" noWrap sx={{ flexGrow: 1 }}>{c.name}</Typography>
                    {c.is_default && (
                      <Tooltip title="Default character"><Star fontSize="small" color="warning" /></Tooltip>
                    )}
                  </Stack>
                  <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
                    {badges.map((b) => (
                      <Chip key={b} size="small" label={b} variant="outlined"
                            color={b === "LoRA" ? "primary" : "secondary"} />
                    ))}
                    {isDraft(c) && (
                      <Chip size="small" label="Draft" color="warning" variant="outlined" />
                    )}
                    {ms.length > 0 && (
                      <Chip size="small" label="trigger mismatch" color="warning" />
                    )}
                    {c.hidden && <Chip size="small" label="Hidden" />}
                  </Stack>
                </Box>
              </CardActionArea>
              {ms.length > 0 && (
                <Box sx={{ px: 1.25, pb: 1 }}>
                  <Button size="small" color="warning" onClick={() => setFixing({ c, ms })}>
                    Use trained values
                  </Button>
                </Box>
              )}
            </Card>
          );
        })}
      </Box>
      {loose.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="subtitle1">Datasets without a character ({loose.length})</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Unassigned sets and regularization pools. Give one an owner on its page to make it
            that character's dataset.
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {loose.map((d) => (
              <Chip key={d.id} clickable component={Link} to={`/datasets/${d.id}`}
                    label={`${d.name} · ${d.images.length}`} variant="outlined" />
            ))}
          </Stack>
        </Box>
      )}
      {characters?.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No characters yet — add one with a LoRA, a character sheet, or both, or just a
          name and build its sheet from its card.
        </Typography>
      )}



      {creating && (
        <NewCharacterDialog
          createSet
          allowPair
          onClose={() => setCreating(false)}
          onCreated={(c) => navigate(`/characters/${encodeURIComponent(c.name)}?tab=images`)}
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

export function CharacterDialog({
  character, loras, check, onFixed, onClose, onSaved,
}: {
  character: Character | null;
  loras: string[];
  /** This character's provenance check, if its LoRA has one (console#596). */
  check?: CharacterProvenance;
  onFixed: () => void;
  onClose: () => void;
  onSaved: (c: Character) => void;
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

  const save = async () => {
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
      onSaved(saved);
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
                ? "Save it, then Build sheet in its card makes its first sheet from one photo of her."
                : "A pair renders with its joint LoRA alone (never a member's sheet or face): attach one."}
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
            {/* Build sheet lives in the character's card, and only there (console#616). */}
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

/** The top of a grid card (console#616): the character's icon, big and square. */
function CharacterHero({ character, anchor = null }: { character: Character; anchor?: string | null }) {
  // A hand-chosen icon wins; then the anchor of the character's dataset (wanly-api#452: the
  // anchor stands for the set, and the set is the character's); then the old fallbacks.
  const uri = characterPicture(character, anchor);
  return uri ? (
    <Box component="img" loading="lazy" src={getFileUrl(uri)} alt={character.name}
         sx={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
  ) : (
    <Box sx={{ width: "100%", aspectRatio: "1 / 1", display: "flex", alignItems: "center",
               justifyContent: "center", bgcolor: "action.hover" }}>
      <Typography variant="h2" color="text.secondary">{character.name.slice(0, 1).toUpperCase()}</Typography>
    </Box>
  );
}
