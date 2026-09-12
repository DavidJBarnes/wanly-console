import { useEffect, useState } from "react";
import {
  Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography,
} from "@mui/material";

import { createTrainingJob, listDatasets, listTrainingJobs } from "../api/client";
import { listRecipes } from "../api/ltx";
import type { Character } from "../api/ltx";
import type { Dataset, TrainingJob } from "../api/types";
import {
  apiErrorText, canTrain, characterProblem, defaultCharacterFor, defaultEpochs,
  defaultLoraName, estimatedMinutes, loraFilename, loraNameProblem, nameNeedsSanitising,
  nextVersion, stepsForEpochs, stepsPerEpoch,
} from "../lib/trainingJob";

/** The trainer's total-step ceiling (mirrors wanly-api's TrainingCreate.steps). */
const STEP_CAP = 30000;

/** An extra training group (wanly-api#102, #106).
 *
 *  "identity" is another character's set — its caption is "<trigger>, <gender>", the same
 *  shape group 0 uses. "composition" is frames containing BOTH characters, captioned with
 *  both triggers; that is the group that teaches the model the identities appear TOGETHER,
 *  which solo sets alone cannot. */
type ExtraGroup = {
  kind: "identity" | "composition";
  character: string;
  datasetId: string | null;
  gender: "" | "woman" | "man" | "person";
  caption: string;
};

/**
 * Queue a character-LoRA training run from the images selected in the repo (#454).
 *
 * The rules it enforces are in src/lib/trainingJob.ts, because vite's test config is node-env
 * and pure-logic only — anything with a right answer has to live outside a component to be
 * covered at all.
 *
 * MOUNT IT ONLY WHILE OPEN. Its state is initialised once, from the props it first saw, so a
 * dialog left mounted with open=false carried the previous dataset's character and version
 * into the next one. The parents render it conditionally rather than passing `open`.
 */
export default function TrainLoraDialog({
  imageKeys, datasetId, defaultCharacter, onClose, onQueued,
}: {
  /** s3:// URIs, in order. Used for the eligibility check and, when there is no dataset, as
   *  the payload. */
  imageKeys: string[];
  /** When set, the job references the dataset instead of an inline list — so the run records
   *  which dataset it came from rather than an anonymous snapshot of URIs. */
  datasetId?: string;
  /** Usually the dataset's name. Made rule-safe here, because "Test faces" is a fine dataset
   *  name and an impossible character name. */
  defaultCharacter?: string;
  onClose: () => void;
  onQueued: (id: string) => void;
}) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [character, setCharacter] = useState(defaultCharacterFor(defaultCharacter ?? ""));
  const [trigger, setTrigger] = useState("");
  const [triggerTouched, setTriggerTouched] = useState(false);
  const [loraName, setLoraName] = useState("");
  const [loraNameTouched, setLoraNameTouched] = useState(false);
  const [version, setVersion] = useState(1);
  const [versionTouched, setVersionTouched] = useState(false);
  const [gender, setGender] = useState<"" | "woman" | "man" | "person">("");
  // Epochs, not steps: "how many passes over each image" is the question a person asks,
  // and a whole number of them puts the last epoch checkpoint on the final step. The default
  // is the recipe's proven 1200 steps expressed for this set's size.
  const [epochs, setEpochs] = useState(defaultEpochs(imageKeys.length));
  const [publish, setPublish] = useState<"final" | "all">("final");
  // ---- Additional groups (wanly-api#102, #106): one LoRA trained on several datasets at
  // once. An IDENTITY group is another character's set; a COMPOSITION group is frames
  // containing BOTH characters, captioned with both triggers -- the group that teaches the
  // model they appear together (#106), which solo sets alone cannot. NOT a way to stack
  // LoRAs, which is what recipes already do and what loses both faces.
  const [groups, setGroups] = useState<ExtraGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // What exists already, so the dialog can offer the real character names — `p@y`, not a
  // retyped `pay` that would create a second character row — and default the version to the
  // next one rather than to 1.
  useEffect(() => {
    listRecipes().then((b) => setCharacters(b.characters)).catch(() => {});
    listTrainingJobs().then(setJobs).catch(() => {});
    listDatasets().then(setDatasets).catch(() => {});
  }, []);

  // The trigger and the filename follow the character until the user EDITS them -- tracked
  // as a touch, not as "still empty": the dataset name pre-fills both, so "still empty" was
  // never true, and retyping the character left the filename as the dataset's name. An
  // existing character also lends its trigger, which may differ from its name.
  useEffect(() => {
    const known = characters.find((c) => c.name.toLowerCase() === character.trim().toLowerCase());
    if (!triggerTouched) setTrigger(known?.trigger ?? character);
    if (!loraNameTouched) setLoraName(defaultLoraName(character));
  }, [character, characters, triggerTouched, loraNameTouched]);

  useEffect(() => {
    if (!versionTouched) setVersion(nextVersion(character, jobs, characters));
  }, [character, jobs, characters, versionTouched]);

  // A group's trigger follows its character — an existing character lends its trigger, the
  // same rule group 0 uses. Deliberately NOT editable: the registry owns the token pair,
  // and a hand-typed token that differs from the caption would bind the face to nothing.
  const groupTrigger = (g: ExtraGroup): string => {
    const known = characters.find(
      (c) => c.name.toLowerCase() === g.character.trim().toLowerCase());
    return known?.trigger ?? g.character.trim();
  };
  // What the composition caption defaults to: every identity pair in the run, joined the
  // way the published trigger phrase is. The user can edit it.
  const identityPairs = (): string[] => {
    const pairs: string[] = [];
    const add = (t: string, gen: string) => {
      if (!t) return;
      const p = gen ? `${t}, ${gen}` : t;
      if (!pairs.includes(p)) pairs.push(p);
    };
    add(trigger.trim(), gender);
    for (const g of groups) {
      if (g.kind === "identity") add(groupTrigger(g), g.gender);
    }
    return pairs;
  };
  const setGroup = (i: number, patch: Partial<ExtraGroup>) =>
    setGroups((prev) => prev.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const addGroup = (kind: ExtraGroup["kind"]) =>
    setGroups((prev) => [...prev, {
      kind, character: "", datasetId: null, gender: "",
      caption: kind === "composition" ? identityPairs().join(" and ") : "",
    }]);

  const eligible = canTrain(imageKeys);
  const nameProblem = characterProblem(character.trim());
  const fileProblem = loraNameProblem(loraName.trim());
  const known = characters.find((c) => c.name.toLowerCase() === character.trim().toLowerCase());
  const steps = stepsForEpochs(epochs, imageKeys.length);
  // A joint run's steps are the TOTAL across every dataset: the Epochs field means whole
  // passes over EVERY image — the same semantics as a single run, no scaling surprise. The
  // The step cap bites sooner with more groups, so the helper states the max that fits.
  const groupImages = groups.reduce(
    (n, g) => n + (datasets.find((d) => d.id === g.datasetId)?.images.length ?? 0), 0);
  const jointImages = imageKeys.length + groupImages;
  const jointSteps = stepsForEpochs(epochs, jointImages);
  const maxJointEpochs = Math.max(1, Math.floor(STEP_CAP / stepsPerEpoch(jointImages)));
  const isJoint = groups.length > 0;
  // A group is unusable without a dataset, and an identity group also needs a character
  // and a gender; a composition group needs its caption. The API refuses all three, so the
  // button says so first rather than round-tripping to a 422.
  const groupsProblem = groups.some((g) => !g.datasetId
    || (g.kind === "identity"
      ? (!g.character.trim() || g.gender === "")
      : !g.caption.trim()));
  const stepsProblem = (isJoint ? jointSteps : steps) > STEP_CAP
    ? `${isJoint ? jointSteps : steps} steps is over the ${STEP_CAP} the trainer accepts — at most ` +
      `${maxJointEpochs} epoch${maxJointEpochs === 1 ? "" : "s"} over ${jointImages} images`
    : null;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const job = await createTrainingJob({
        // The known row's exact spelling, so the finished LoRA lands on it rather than on a
        // new character that differs by case.
        character: known?.name ?? character.trim(),
        trigger: trigger.trim(), version, steps: jointSteps,
        lora_name: loraName.trim() || defaultLoraName(character),
        gender: gender || undefined,
        publish,
        // A dataset reference when there is one, so the run records where its images came
        // from; a bare list otherwise, for an ad-hoc selection in the Image Repo.
        ...(datasetId ? { dataset_id: datasetId } : { dataset_images: imageKeys }),
        // EVERY GROUP OR NONE: the API refuses a group with a trigger but no images, or a
        // composition group with no caption — both build a half-configured dataset silently.
        ...(groups.length ? {
          identities: groups.map((g) => g.kind === "identity" ? {
            character: characters.find(
              (c) => c.name.toLowerCase() === g.character.trim().toLowerCase())?.name
              ?? g.character.trim(),
            trigger: groupTrigger(g),
            gender: g.gender || undefined,
            dataset_id: g.datasetId ?? undefined,
          } : {
            // No trigger: the caption names the people in the frames.
            caption: g.caption.trim(),
            dataset_id: g.datasetId ?? undefined,
          }),
        } : {}),
      });
      onQueued(job.id);
      onClose();
    } catch (e: unknown) {
      setError(apiErrorText(e, "could not queue the job"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Train a character LoRA</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {!eligible.ok && <Alert severity="error">{eligible.reason}</Alert>}
          {eligible.warning && <Alert severity="warning">{eligible.warning}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}

          <Typography variant="body2" color="text.secondary">
            {imageKeys.length} selected image{imageKeys.length === 1 ? "" : "s"}.
          </Typography>

          <Autocomplete
            freeSolo
            options={characters.map((c) => c.name)}
            inputValue={character}
            onInputChange={(_e, v) => setCharacter(v)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Character"
                error={character !== "" && nameProblem !== null}
                helperText={
                  nameProblem && character !== ""
                    ? nameProblem
                    : known
                      ? `Retrains ${known.name}: when this run finishes, its LoRA replaces `
                        + `${known.char_lora}.`
                      : "A new character. Pick an existing one from the list to retrain it."
                }
                autoFocus
                fullWidth
              />
            )}
          />
          <TextField
            label="Trigger"
            value={trigger}
            onChange={(e) => { setTriggerTouched(true); setTrigger(e.target.value); }}
            helperText="The word a prompt types to get this face. It goes into every training caption."
            fullWidth
          />
          <TextField
            label="LoRA filename"
            value={loraName}
            onChange={(e) => { setLoraNameTouched(true); setLoraName(e.target.value); }}
            error={fileProblem !== null}
            helperText={
              fileProblem
                ?? (nameNeedsSanitising(character)
                  ? `A LoRA is served over HTTP, so the filename cannot hold every character ` +
                    `the name can. Installs as ${loraFilename(loraName || "lora", version)}`
                  : `Installs as ${loraFilename(loraName || "lora", version)}`)
            }
            fullWidth
          />

          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              label="Version"
              type="number"
              value={version}
              onChange={(e) => {
                setVersionTouched(true);
                setVersion(Math.max(1, parseInt(e.target.value) || 1));
              }}
              helperText={versionTouched ? " " : known || version > 1 ? "next after what exists" : "first"}
              sx={{ width: 140 }}
            />
            <TextField
              label="Epochs"
              type="number"
              value={epochs}
              onChange={(e) => setEpochs(Math.max(1, parseInt(e.target.value) || 1))}
              error={stepsProblem !== null}
              helperText={
                stepsProblem
                  ?? (isJoint
                    ? `${jointSteps} steps (${jointImages} images across every group × ${epochs} epochs) — ` +
                      `about ${estimatedMinutes(jointSteps)} min on the 3090, one checkpoint per epoch`
                    : `${steps} steps (${imageKeys.length} images × 10 repeats × ${epochs}) — ` +
                      `about ${estimatedMinutes(steps)} min on the 3090, one checkpoint per epoch`)
              }
              slotProps={{ htmlInput: { min: 1 } }}
              sx={{ flex: 1 }}
            />
          </Box>

          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>Upload</Typography>
            <RadioGroup
              row
              value={publish}
              onChange={(e) => setPublish(e.target.value as "final" | "all")}
            >
              <FormControlLabel value="final" control={<Radio size="small" />} label="Final checkpoint only" />
              <FormControlLabel value="all" control={<Radio size="small" />} label="Every epoch" />
            </RadioGroup>
            <Typography variant="caption" color="text.secondary">
              Every epoch stays on the trainer either way and can be uploaded later from the
              run. A checkpoint takes about 18 minutes to upload.
            </Typography>
          </Box>

          <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
            <TextField
              select
              label="Gender"
              value={gender}
              onChange={(e) => setGender(e.target.value as typeof gender)}
              error={gender === ""}
              helperText={gender === "" ? "Required." : " "}
              sx={{ width: 160 }}
            >
              <MenuItem value="woman">woman</MenuItem>
              <MenuItem value="man">man</MenuItem>
              <MenuItem value="person">person</MenuItem>
            </TextField>
            <Alert severity={gender ? "info" : "warning"} sx={{ flex: 1 }}>
              Every image will be captioned exactly{" "}
              <strong>“{trigger.trim() || "trigger"}, {gender || "…"}”</strong>. The trigger
              is what a prompt types to get this face; the gender is what the model binds it
              to. Nothing else goes in the caption.
            </Alert>
          </Box>

          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Additional groups — train ONE LoRA on more datasets
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              An <strong>identity</strong> group is another character's set. A{" "}
              <strong>together</strong> group is frames containing BOTH characters, captioned
              with both triggers — that is what teaches the model the two faces appear in
              the same shot, which solo sets alone cannot. Not a way to stack two existing
              LoRAs; recipes already do that.
            </Typography>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button size="small" variant="outlined" onClick={() => addGroup("identity")}>
                Add identity
              </Button>
              <Button size="small" variant="outlined" onClick={() => addGroup("composition")}>
                Add together (both in frame)
              </Button>
            </Box>
          </Box>

          {groups.map((g, i) => {
            const gKnown = characters.find(
              (c) => c.name.toLowerCase() === g.character.trim().toLowerCase());
            const gImages = datasets.find((d) => d.id === g.datasetId)?.images.length;
            const gTrigger = groupTrigger(g);
            return (
              <Stack key={i} spacing={2} sx={{ pl: 1, borderLeft: 2, borderColor: "divider" }}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Typography variant="subtitle2">
                    {g.kind === "identity" ? `Identity ${i + 2}` : `Together ${i + 1}`}
                  </Typography>
                  <Button size="small" color="inherit"
                    onClick={() => setGroups((prev) => prev.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </Box>

                {g.kind === "identity" && (
                  <Autocomplete
                    freeSolo
                    options={characters.map((c) => c.name)}
                    inputValue={g.character}
                    onInputChange={(_e, v) => setGroup(i, { character: v })}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Character"
                        helperText={gKnown
                          ? `Its trigger is “${gKnown.trigger}”.`
                          : "An existing character; its registry trigger is used."}
                        fullWidth
                      />
                    )}
                  />
                )}

                <TextField
                  select
                  label="Dataset"
                  value={g.datasetId ?? ""}
                  onChange={(e) => setGroup(i, { datasetId: e.target.value || null })}
                  helperText={
                    g.datasetId
                      ? `${gImages ?? "?"} images`
                      : "This group's images. NOT the same dataset as another group — one file cannot carry two captions."
                  }
                  fullWidth
                >
                  {datasets.filter((d) => d.id !== datasetId
                    && !groups.some((o, j) => j !== i && o.datasetId === d.id)).map((d) => (
                    <MenuItem key={d.id} value={d.id}>{d.name} ({d.images.length})</MenuItem>
                  ))}
                </TextField>

                {g.kind === "identity" ? (
                  <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
                    <TextField
                      select
                      label="Gender"
                      value={g.gender}
                      onChange={(e) => setGroup(i, { gender: e.target.value as ExtraGroup["gender"] })}
                      error={g.gender === ""}
                      helperText={g.gender === "" ? "Required." : " "}
                      sx={{ width: 160 }}
                    >
                      <MenuItem value="woman">woman</MenuItem>
                      <MenuItem value="man">man</MenuItem>
                      <MenuItem value="person">person</MenuItem>
                    </TextField>
                    <Alert severity={g.gender ? "info" : "warning"} sx={{ flex: 1 }}>
                      Captioned exactly{" "}
                      <strong>“{gTrigger || "trigger"}, {g.gender || "…"}”</strong> — its own
                      pair, never another group's.
                    </Alert>
                  </Box>
                ) : (
                  <TextField
                    label="Caption"
                    value={g.caption}
                    onChange={(e) => setGroup(i, { caption: e.target.value })}
                    error={!g.caption.trim()}
                    helperText={
                      g.caption.trim()
                        ? "Every image in this group is captioned exactly this."
                        : "Name both people, e.g. “p@yton, woman and d@vid, man” — with no trigger this caption is the only thing that names them."
                    }
                    multiline
                    minRows={2}
                    fullWidth
                  />
                )}
              </Stack>
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!eligible.ok || busy || nameProblem !== null || fileProblem !== null
            || stepsProblem !== null || groupsProblem || !trigger.trim() || gender === ""}
          onClick={submit}
        >
          {busy ? "Queueing…" : "Queue training"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
