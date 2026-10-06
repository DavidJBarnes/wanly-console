import { useEffect, useRef, useState } from "react";
import CharacterAvatar from "./CharacterAvatar";
import { offeredCharacters } from "../lib/characterIcon";
import type { ReactNode } from "react";
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControlLabel, MenuItem, Radio, RadioGroup, Stack, TextField,
  ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import { CheckCircle, ErrorOutline, WarningAmber } from "@mui/icons-material";

import {
  createTrainingJob, listDatasets, listTrainingJobs, preflightTraining,
} from "../api/client";
import { listRecipes, triggerPhrase } from "../api/ltx";
import type { Character } from "../api/ltx";
import type {
  Dataset, PreflightItem, TrainingJob, TrainingPreflight,
} from "../api/types";
import NewCharacterDialog from "./NewCharacterDialog";
import {
  apiErrorText, BASE_CHECKPOINTS, SDXL_EPOCHS, SDXL_REPEATS, characterHasTrained, datasetsOwnedBy, defaultEpochsForSamples,
  defaultPairName, NUM_REPEATS, RECIPE_DEFAULTS,
  estimateRunMinutes, formatMinutes, formIncomplete, initialFromDataset, isPairCharacter, nextVersion,
  problemsFromError, runCharacter, stepsForSamples, stepsPerEpoch, trainingBody,
} from "../lib/trainingJob";
import type { TrainForm } from "../lib/trainingJob";

/** How long the form must sit still before it is re-checked. Long enough that typing a pair
 *  name is one request, short enough that the checklist feels attached to the form. */
const PREFLIGHT_DEBOUNCE_MS = 400;

/** The select value that opens the create form instead of choosing a character. */
const NEW_CHARACTER = "__new__";

/** Which field a character created from the dialog lands in. */
type NewCharacterSlot = "character" | "memberA" | "memberB";

const EMPTY: TrainForm = {
  mode: "solo", character: "", memberA: "", memberB: "", pairName: "", datasets: {},
  compositionId: null, allowNoComposition: false, allowLowScores: false, version: 1, steps: 0,
  publish: "final",
  ...RECIPE_DEFAULTS,
};

/**
 * Queue a character-LoRA training run (#454), made hard to get wrong (#537).
 *
 * WHAT CHANGED, AND WHY. This dialog used to take a free-text trigger, a per-run gender and
 * an open list of extra groups, and every one of those has been filled in wrong: David's face
 * trained under a different trigger in each pair, another person's images inside his solo
 * LoRA, pairs with no image of the two together, a pair run publishing over a solo row. So
 * the person now picks only what nobody else can — who, which set, how long — and the rest
 * comes from the registry and the datasets' owners.
 *
 * THE RULES ARE THE API'S. Every change is sent to POST /training/preflight, and the
 * checklist below is its answer verbatim; Train is enabled only while that answer is `ok` for
 * the form as it stands now. Nothing here re-implements a rule: a checklist that drifted from
 * the server would say green over a request that 422s, which is worse than no checklist.
 *
 * MOUNT IT ONLY WHILE OPEN. Its state is initialised once, from the props it first saw, so a
 * dialog left mounted with open=false carried the previous dataset's character and version
 * into the next one. The parents render it conditionally rather than passing `open`.
 */
export default function TrainLoraDialog({
  dataset, onClose, onQueued,
}: {
  /** The dataset it was opened from, if any: a character set opens Solo on its owner, a
   *  composition set opens Pair on its pair. */
  dataset?: Dataset;
  onClose: () => void;
  onQueued: (id: string) => void;
}) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [form, setForm] = useState<TrainForm>(EMPTY);
  // Defaults follow the form until the user EDITS them — tracked as a touch, because "still
  // equal to the default" stops being true the moment the default moves.
  const [pairNameTouched, setPairNameTouched] = useState(false);
  const [versionTouched, setVersionTouched] = useState(false);
  const [epochs, setEpochs] = useState<number | null>(null);
  const [newCharFor, setNewCharFor] = useState<NewCharacterSlot | null>(null);

  const [preflight, setPreflight] = useState<TrainingPreflight | null>(null);
  // The body the preflight above answered. Train needs it to equal the body as it is NOW —
  // an `ok` for the form of half a second ago is not an `ok`.
  const [checkedKey, setCheckedKey] = useState("");
  // Both keyed by the body they are about, for the same reason as checkedKey: an error or a
  // refusal for a form that has since changed says nothing about this one.
  const [preflightError, setPreflightError] = useState({ key: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitProblems, setSubmitProblems] =
    useState<{ key: string; items: PreflightItem[] }>({ key: "", items: [] });

  const patch = (p: Partial<TrainForm>) => setForm((f) => ({ ...f, ...p }));

  const loadCharacters = () =>
    listRecipes().then((b) => { setCharacters(b.characters); return b.characters; });

  useEffect(() => {
    listTrainingJobs().then(setJobs).catch(() => {});
    listDatasets().then(setDatasets).catch(() => {});
    // Seeded once the registry is in: a composition set's members come from its pair row,
    // and names take the registry's spelling so the chosen set is keyed the way the select
    // reads it.
    listRecipes().then((b) => {
      setCharacters(b.characters);
      const seed = initialFromDataset(dataset, b.characters);
      const canon = (n: string | undefined) =>
        n ? (b.characters.find((c) => c.name.toLowerCase() === n.toLowerCase())?.name ?? n) : n;
      const character = canon(seed.character);
      setForm((f) => ({
        ...f, ...seed,
        ...(character !== undefined ? { character } : {}),
        ...(seed.memberA !== undefined ? { memberA: canon(seed.memberA) ?? "" } : {}),
        ...(seed.memberB !== undefined ? { memberB: canon(seed.memberB) ?? "" } : {}),
        ...(seed.datasets && character ? { datasets: { [character]: dataset!.id } } : {}),
      }));
      // A composition set names its pair; that name is the owner, not a default to replace.
      if (seed.pairName) setPairNameTouched(true);
    }).catch(() => {});
  }, [dataset]);

  const solos = characters.filter((c) => !isPairCharacter(c))
    .sort((a, b) => a.name.localeCompare(b.name));
  const byName = (n: string) =>
    characters.find((c) => c.name.toLowerCase() === n.trim().toLowerCase());

  // ---- Derived: everything below follows the form, so nothing here can go stale. ----
  const pairName = pairNameTouched
    ? form.pairName
    : form.memberA && form.memberB ? defaultPairName(form.memberA, form.memberB) : "";
  const sdxl = form.arch === "sdxl";
  const mode = form.mode;
  const members = mode === "solo" ? [form.character] : [form.memberA, form.memberB];
  const ownedBy = (name: string) => datasetsOwnedBy(datasets, "character", name);
  // A member with exactly one set gets it without asking; with several, the choice is made
  // explicitly. With none, the select says so and preflight refuses.
  const chosenDatasets: Record<string, string> = {};
  for (const m of members.filter(Boolean)) {
    const owned = ownedBy(m);
    const picked = form.datasets[m];
    const id = picked && owned.some((d) => d.id === picked) ? picked
      : owned.length === 1 ? owned[0].id : undefined;
    if (id) chosenDatasets[m] = id;
  }
  const compositions = mode === "pair" && pairName
    ? datasetsOwnedBy(datasets, "composition", pairName) : [];
  const compositionId = form.compositionId && compositions.some((d) => d.id === form.compositionId)
    ? form.compositionId
    : compositions.length === 1 ? compositions[0].id : null;

  const who = runCharacter({ ...form, mode, pairName });
  const version = versionTouched ? form.version : nextVersion(who, jobs, characters, form.arch);
  // The epoch length is the server's once it has answered — regularization and pair groups
  // make it more than images x 10. Before that, the character images at the recipe's repeats.
  const estimateImages = Object.values(chosenDatasets)
    .reduce((n, id) => n + (datasets.find((d) => d.id === id)?.images.length ?? 0), 0);
  const samplesPerEpoch = preflight?.samples_per_epoch || stepsPerEpoch(estimateImages, form.arch);
  const epochsShown = epochs ?? (sdxl ? SDXL_EPOCHS : defaultEpochsForSamples(samplesPerEpoch));
  const steps = stepsForSamples(epochsShown, samplesPerEpoch);

  const effective: TrainForm = {
    ...form, mode, pairName, datasets: chosenDatasets, compositionId, version, steps,
  };
  const incomplete = formIncomplete(effective);
  const body = trainingBody(effective);
  const bodyKey = JSON.stringify(body);
  const current = !incomplete && checkedKey === bodyKey ? preflight : null;
  const failed = !incomplete && preflightError.key === bodyKey ? preflightError.message : "";
  const checking = !incomplete && checkedKey !== bodyKey && !failed;
  const refused = submitProblems.key === bodyKey ? submitProblems.items : [];

  // Debounced preflight. A counter rather than an abort: an answer that arrives after a newer
  // request was sent is simply dropped, whatever order the network returns them in.
  const seq = useRef(0);
  // Bumped to ask again about an unchanged form — after a refusal, when the fix was made
  // somewhere else (captions finished on the Datasets page).
  const [recheck, setRecheck] = useState(0);
  useEffect(() => {
    if (incomplete) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      preflightTraining(JSON.parse(bodyKey))
        .then((r) => {
          if (seq.current !== mine) return;
          setPreflight(r);
          setCheckedKey(bodyKey);
          setPreflightError({ key: "", message: "" });
        })
        .catch((e: unknown) => {
          if (seq.current !== mine) return;
          setPreflightError({ key: bodyKey, message: apiErrorText(e, "the pre-flight check failed") });
        });
    }, PREFLIGHT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [bodyKey, incomplete, recheck]);

  const submit = async () => {
    setBusy(true);
    setError("");
    setSubmitProblems({ key: "", items: [] });
    try {
      const job = await createTrainingJob(body);
      onQueued(job.id);
      onClose();
    } catch (e: unknown) {
      // The world changed between the check and the click (a caption deleted, a job took
      // the set): show the server's list, the same shape as the checklist.
      const problems = problemsFromError(e);
      if (problems) setSubmitProblems({ key: bodyKey, items: problems });
      else setError(apiErrorText(e, "could not queue the job"));
    } finally {
      setBusy(false);
    }
  };

  /** A character select over the solo registry, with "New character…" at the bottom. */
  const characterSelect = (
    slot: NewCharacterSlot, label: string, value: string, onPick: (name: string) => void,
    exclude?: string,
  ) => {
    const c = value ? byName(value) : undefined;
    return (
      <TextField
        select
        label={label}
        value={c ? c.name : ""}
        onChange={(e) => {
          if (e.target.value === NEW_CHARACTER) setNewCharFor(slot);
          else onPick(e.target.value);
        }}
        helperText={c
          ? `Captions start “${triggerPhrase(c)}, …”` + (characterHasTrained(c) ? "" : " — not trained yet")
          : value ? `“${value}” is not a registered character` : " "}
        error={Boolean(value) && !c}
        fullWidth
      >
        {offeredCharacters(solos, value).filter((s) => s.name !== exclude).map((s) => (
          <MenuItem key={s.id} value={s.name}>
            <Stack direction="row" spacing={1} alignItems="center">
              <CharacterAvatar character={s} name={s.name} />
              <span>{s.name}</span>
            </Stack>
          </MenuItem>
        ))}
        <Divider />
        <MenuItem value={NEW_CHARACTER}><em>New character…</em></MenuItem>
      </TextField>
    );
  };

  /** The character-dataset select for one member. */
  const datasetSelect = (member: string) => {
    const owned = ownedBy(member);
    const id = chosenDatasets[member] ?? "";
    const images = datasets.find((d) => d.id === id)?.images.length;
    return (
      <TextField
        select
        label={mode === "pair" ? `${member}'s dataset` : "Dataset"}
        value={id}
        onChange={(e) => patch({ datasets: { ...form.datasets, [member]: e.target.value } })}
        error={owned.length === 0}
        helperText={owned.length === 0
          ? `No dataset is owned by ${member}. On the Datasets page, set one's kind to `
            + `Character and its owner to ${member}.`
          : images !== undefined ? `${images} images` : "Pick one — more than one set is owned by "
            + member}
        disabled={owned.length === 0}
        fullWidth
      >
        {owned.map((d) => (
          <MenuItem key={d.id} value={d.id}>{d.name} ({d.images.length})</MenuItem>
        ))}
      </TextField>
    );
  };

  const pairRow = byName(pairName);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Train a character LoRA</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <ToggleButtonGroup
            exclusive
            size="small"
            value={form.arch}
            // The epoch default differs (12 for SDXL), so a typed count does not carry over.
            onChange={(_e, v) => { if (v) { patch({ arch: v }); setEpochs(null); } }}
          >
            <ToggleButton value="ltx">LTX — video</ToggleButton>
            <ToggleButton value="sdxl">SDXL — start images</ToggleButton>
          </ToggleButtonGroup>

          <ToggleButtonGroup
            exclusive
            size="small"
            value={form.mode}
            onChange={(_e, v) => { if (v) patch({ mode: v }); }}
          >
            <ToggleButton value="solo">Solo — one person</ToggleButton>
            <ToggleButton value="pair">Pair — two people together</ToggleButton>
          </ToggleButtonGroup>

          {mode === "solo" ? (
            <>
              {characterSelect("character", "Character", form.character,
                (name) => patch({ character: name }))}
              {form.character && byName(form.character) && datasetSelect(byName(form.character)!.name)}
            </>
          ) : (
            <>
              <Box sx={{ display: "flex", gap: 2 }}>
                {characterSelect("memberA", "First person", form.memberA,
                  (name) => patch({ memberA: name }), form.memberB)}
                {characterSelect("memberB", "Second person", form.memberB,
                  (name) => patch({ memberB: name }), form.memberA)}
              </Box>
              <TextField
                label="Pair name"
                value={pairName}
                onChange={(e) => { setPairNameTouched(true); patch({ pairName: e.target.value }); }}
                helperText={pairRow && isPairCharacter(pairRow)
                  ? `Retrains the pair ${pairRow.name}. It publishes to the pair's own row — never `
                    + "to either person's."
                  : "The pair's own character row. Its composition dataset must be owned by "
                    + "exactly this name."}
                fullWidth
              />
              {form.memberA && byName(form.memberA) && datasetSelect(byName(form.memberA)!.name)}
              {form.memberB && byName(form.memberB) && datasetSelect(byName(form.memberB)!.name)}
              {pairName && (compositions.length > 0 ? (
                <TextField
                  select
                  label="Both in frame (composition)"
                  value={compositionId ?? ""}
                  onChange={(e) => patch({ compositionId: e.target.value || null })}
                  helperText="Frames with both people in them — what teaches the model they are two faces."
                  fullWidth
                >
                  {compositions.map((d) => (
                    <MenuItem key={d.id} value={d.id}>{d.name} ({d.images.length})</MenuItem>
                  ))}
                </TextField>
              ) : (
                <Alert severity="error">
                  No composition dataset is owned by <strong>{pairName}</strong>. Without
                  images of both people in one frame the model learns two faces that never
                  meet, and they blend when prompted together. Make one on the Datasets page:
                  kind Composition, owner {pairName}.
                  <FormControlLabel
                    sx={{ display: "flex", mt: 1 }}
                    control={
                      <Checkbox
                        size="small"
                        checked={form.allowNoComposition}
                        onChange={(e) => patch({ allowNoComposition: e.target.checked })}
                      />
                    }
                    label="Train without both-in-frame images (faces may blend)"
                  />
                </Alert>
              ))}
            </>
          )}

          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              label="Version"
              type="number"
              value={version}
              onChange={(e) => {
                setVersionTouched(true);
                patch({ version: Math.max(1, parseInt(e.target.value) || 1) });
              }}
              helperText={versionTouched ? " " : version > 1 ? "next after what exists" : "first"}
              sx={{ width: 140 }}
            />
            <TextField
              label="Epochs"
              type="number"
              value={epochsShown}
              onChange={(e) => setEpochs(Math.max(1, parseInt(e.target.value) || 1))}
              helperText={`${steps} steps (${samplesPerEpoch} samples an epoch × ${epochsShown}), `
                + `each image seen ${current?.passes_per_image
                  ?? epochsShown * (sdxl ? SDXL_REPEATS : NUM_REPEATS)}× — `
                // All-in, from this arch's recent runs (console#602): drain, caching, training
                // and the upload -- when the LoRA is downloadable, not just the steps.
                + `about ${formatMinutes(estimateRunMinutes(form.arch, steps, form.publish, jobs))} `
                + `until downloadable (3090, from recent runs), one checkpoint per epoch. `
                + (sdxl ? `aio used ${SDXL_EPOCHS} epochs.` : `Kelly-2000 v5 used ~30×.`)}
              slotProps={{ htmlInput: { min: 1 } }}
              sx={{ flex: 1 }}
            />
          </Box>

          {sdxl ? (
          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>Recipe</Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              The aio recipe, as k3lly_aio was trained: BigaspV2Lustify, rank 128/64, 8 repeats,
              no regularization. The trainer captions every image with WD14 tags, trigger
              first — the dataset's captions are not used. The LoRA is not published to the
              character; download it from the run for A1111.
              {mode === "pair" && (
                <> A pair trains each trigger beside its class tag (<code>d@vid, 1boy</code>,{" "}
                  <code>k3lly, 1girl</code>) plus the both-in-frame set, so prompt both
                  triggers with <code>1girl, 1boy</code> in A1111.</>
              )}
            </Typography>
          </Box>
          ) : (
          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>Recipe</Typography>
            <TextField
              select
              fullWidth
              size="small"
              label="Base model"
              value={form.baseCheckpoint}
              onChange={(e) => patch({ baseCheckpoint: e.target.value })}
              helperText="What the LoRA trains against. Renders use the render checkpoint either way."
            >
              {BASE_CHECKPOINTS.map((b) => (
                <MenuItem key={b.value} value={b.value}>{b.label}</MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              sx={{ mt: 1 }}
              control={
                <Checkbox
                  size="small"
                  checked={form.regularization}
                  onChange={(e) => patch({ regularization: e.target.checked })}
                />
              }
              label="Regularization pool (generic man/woman images)"
            />
            <Typography variant="caption" color="text.secondary" component="div">
              Off in Kelly-2000 v5's recipe. Off keeps identity strongest; "man"/"woman" in
              prompts may drift toward these people.
            </Typography>
            <RadioGroup
              row
              value={form.captionMode}
              onChange={(e) => patch({ captionMode: e.target.value as TrainForm["captionMode"] })}
            >
              <FormControlLabel value="per_image" control={<Radio size="small" />}
                label="Dataset captions (blank = bare trigger)" />
              <FormControlLabel value="trigger_only" control={<Radio size="small" />}
                label="Bare trigger only" />
            </RadioGroup>
          </Box>
          )}

          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>Upload</Typography>
            <RadioGroup
              row
              value={form.publish}
              onChange={(e) => patch({ publish: e.target.value as "final" | "all" })}
            >
              <FormControlLabel value="final" control={<Radio size="small" />} label="Final checkpoint only" />
              <FormControlLabel value="all" control={<Radio size="small" />} label="Every epoch" />
            </RadioGroup>
            <Typography variant="caption" color="text.secondary">
              Every epoch stays on the trainer either way and can be uploaded later from the
              run. A checkpoint takes about {sdxl ? 25 : 18} minutes to upload.
            </Typography>
          </Box>

          <Divider />
          <PreflightPanel
            incomplete={incomplete}
            checking={checking}
            error={failed}
            preflight={current}
            submitProblems={refused}
            allowLowScores={form.allowLowScores}
            onAllowLowScores={(v) => patch({ allowLowScores: v })}
            onRecheck={() => {
              setSubmitProblems({ key: "", items: [] });
              setCheckedKey("");
              setRecheck((n) => n + 1);
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={busy || !current?.ok || refused.length > 0}
          onClick={submit}
        >
          {busy ? "Queueing…" : "Queue training"}
        </Button>
      </DialogActions>

      {newCharFor && (
        <NewCharacterDialog
          onClose={() => setNewCharFor(null)}
          onCreated={(c) => {
            // In the list at once, so the select can show it before the re-read lands.
            setCharacters((prev) => [...prev, c]);
            patch({ [newCharFor]: c.name } as Partial<TrainForm>);
            loadCharacters().catch(() => {});
          }}
        />
      )}
    </Dialog>
  );
}

/**
 * The server's answer, rendered: problems (blocking) in red, warnings in amber, then every
 * group the run will train — regularization pools included, which the API adds on its own
 * and which cannot be removed — each with a few of its final captions.
 */
function PreflightPanel({
  incomplete, checking, error, preflight, submitProblems, onRecheck, allowLowScores,
  onAllowLowScores,
}: {
  incomplete: string | null;
  checking: boolean;
  error: string;
  preflight: TrainingPreflight | null;
  submitProblems: PreflightItem[];
  onRecheck: () => void;
  allowLowScores: boolean;
  onAllowLowScores: (v: boolean) => void;
}) {
  const row = (icon: ReactNode, text: string, key: string) => (
    <Box key={key} sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
      {icon}
      <Typography variant="body2">{text}</Typography>
    </Box>
  );
  const problems = [...submitProblems, ...(preflight?.problems ?? [])];

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="subtitle2">Pre-flight</Typography>
        {checking && <CircularProgress size={14} />}
        <Box sx={{ flexGrow: 1 }} />
        {(submitProblems.length > 0 || error) && (
          <Button size="small" onClick={onRecheck}>Check again</Button>
        )}
      </Box>
      {incomplete && (
        <Typography variant="body2" color="text.secondary">To check: {incomplete}.</Typography>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {problems.map((p, i) =>
        row(<ErrorOutline color="error" fontSize="small" />, p.message, `p${i}-${p.code}`))}
      {preflight?.warnings.map((w, i) =>
        row(<WarningAmber color="warning" fontSize="small" />, w.message, `w${i}-${w.code}`))}
      {/* The floor exists to catch bad faceswaps; real profiles and face-filling selfies fail
          it too (console#575). Shown while the question is live, ticked or not. */}
      {(problems.some((p) => p.code === "score_below_floor")
        || preflight?.warnings.some((w) => w.code === "score_below_floor_allowed")) && (
        <FormControlLabel
          sx={{ ml: 3 }}
          control={
            <Checkbox
              size="small"
              checked={allowLowScores}
              onChange={(e) => onAllowLowScores(e.target.checked)}
            />
          }
          label="These are verified real photos of this person (profiles and close-ups score low)"
        />
      )}
      {preflight?.ok && problems.length === 0 && row(
        <CheckCircle color="success" fontSize="small" />,
        `Ready: ${preflight.steps} steps, ${preflight.samples_per_epoch} samples an epoch, `
          + `each image seen ${preflight.passes_per_image}×.`,
        "ok",
      )}

      {preflight && preflight.groups.length > 0 && (
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          {preflight.groups.map((g, i) => (
            <Box key={`${g.kind}-${g.dataset_id ?? i}`}
              sx={{ pl: 1, borderLeft: 2, borderColor: "divider" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {g.kind === "regularization"
                    ? `Regularization · ${g.dataset_name ?? "pool"}`
                    : `${g.character ?? "?"} · ${g.dataset_name ?? "?"}`}
                </Typography>
                <Chip size="small" variant="outlined" label={g.kind} />
                {g.kind === "regularization" && (
                  <Chip size="small" color="info" variant="outlined" label="added automatically" />
                )}
                <Typography variant="caption" color="text.secondary">
                  {g.images} images × {g.num_repeats} repeats
                </Typography>
              </Box>
              {g.sample_captions.map((c, j) => (
                <Typography key={j} variant="caption" component="div"
                  sx={{ fontFamily: "monospace", color: "text.secondary", mt: 0.25 }}>
                  {c}
                </Typography>
              ))}
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
