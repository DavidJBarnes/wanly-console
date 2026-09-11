import { useEffect, useState } from "react";
import {
  Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, MenuItem, Radio, RadioGroup, Stack, Switch, TextField, Typography,
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
  // ---- Dual character (wanly-api#102): a JOINT run, one LoRA trained on both characters'
  // datasets at once. This is the structural fix for two-identity interference (R2: no
  // strength setting recovers two-char identity) — NOT a way to stack two LoRAs, which is
  // what recipes already do and which is exactly what loses both faces.
  const [dual, setDual] = useState(false);
  const [character2, setCharacter2] = useState("");
  const [gender2, setGender2] = useState<"" | "woman" | "man" | "person">("");
  const [dataset2Id, setDataset2Id] = useState<string | null>(null);
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

  // The second trigger follows the second character — an existing character lends its
  // trigger, the same rule group 0 uses. Deliberately NOT editable here: the registry
  // owns the token pair, and a hand-typed token that differs from the caption would bind
  // the face to nothing.
  const known2 = characters.find((c) => c.name.toLowerCase() === character2.trim().toLowerCase());
  const trigger2 = known2?.trigger ?? character2;

  const eligible = canTrain(imageKeys);
  const nameProblem = characterProblem(character.trim());
  const fileProblem = loraNameProblem(loraName.trim());
  const known = characters.find((c) => c.name.toLowerCase() === character.trim().toLowerCase());
  const steps = stepsForEpochs(epochs, imageKeys.length);
  // A joint run's steps are the TOTAL across both datasets: the Epochs field means whole
  // passes over EVERY image in both sets — the same semantics as a single run, no scaling
  // surprise. 5 epochs over 105 joint images is 5250 steps. The cap bites sooner than a
  // single run does, so the helper states the max that fits.
  const jointImages = imageKeys.length + (datasets.find((d) => d.id === dataset2Id)?.images.length ?? 0);
  const jointSteps = stepsForEpochs(epochs, jointImages);
  const maxJointEpochs = Math.max(1, Math.floor(6000 / stepsPerEpoch(jointImages)));
  const stepsProblem = (dual ? jointSteps : steps) > 6000
    ? `${dual ? jointSteps : steps} steps is over the 6000 the trainer accepts — at most ` +
      `${maxJointEpochs} epoch${maxJointEpochs === 1 ? "" : "s"} over ${jointImages} joint images`
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
        // ALL FIELDS OR NONE: the API refuses a half-given second identity, because a
        // trigger with no images builds a half-configured dataset silently.
        ...(dual && known2 ? {
          second_character: known2.name,
          second_trigger: trigger2.trim(),
          second_gender: (gender2 || undefined),
          second_dataset_id: dataset2Id ?? undefined,
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
                  ?? (dual
                    ? `${jointSteps} steps (${jointImages} images across both datasets × ${epochs} epochs) — ` +
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
            <FormControlLabel
              control={<Switch size="small" checked={dual}
                onChange={(e) => {
                  const on = e.target.checked;
                  setDual(on);
                  // Turning dual on shrinks how far the epoch count goes: the steps are
                  // the TOTAL across both datasets, and the 6000-step cap bites sooner.
                  // Clamp the default so the button survives the toggle (the proven ~5
                  // passes over a 105-164 image joint set does not fit; fewer does).
                  if (on) {
                    const ji = imageKeys.length
                      + (datasets.find((d) => d.id === dataset2Id)?.images.length ?? 0);
                    const maxE = Math.max(1, Math.floor(6000 / stepsPerEpoch(ji)));
                    setEpochs((prev) => Math.min(prev, maxE));
                  }
                }} />}
              label={
                <Typography variant="body2">
                  Dual character — train ONE LoRA on a second identity's dataset too
                </Typography>
              }
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              For shots where two recurring characters share the frame: the joint LoRA
              learns both identities TOGETHER, which is the fix for the identity loss two
              stacked LoRAs show (each works alone, both together lose both faces). Not a
              way to stack two existing LoRAs — recipes already do that.
            </Typography>
          </Box>

          {dual && (
            <Stack spacing={2} sx={{ pl: 1, borderLeft: 2, borderColor: "divider" }}>
              <Autocomplete
                freeSolo
                options={characters.map((c) => c.name)}
                inputValue={character2}
                onInputChange={(_e, v) => setCharacter2(v)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Second character"
                    helperText={known2
                      ? ` joint LoRA learns ${known2.name} too.`
                      : "The second identity. Pick an existing character."}
                    fullWidth
                  />
                )}
              />
              <TextField
                select
                label="Second dataset"
                value={dataset2Id ?? ""}
                onChange={(e) => {
                  setDataset2Id(e.target.value || null);
                }}
                helperText={
                  dataset2Id
                    ? `${datasets.find((d) => d.id === dataset2Id)?.images.length ?? "?"} images`
                    : "The second identity's images. NOT the same dataset as above — one file cannot caption two triggers."
                }
                fullWidth
              >
                {datasets.filter((d) => d.id !== datasetId).map((d) => (
                  <MenuItem key={d.id} value={d.id}>{d.name} ({d.images.length})</MenuItem>
                ))}
              </TextField>
              <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
                <TextField
                  select
                  label="Second gender"
                  value={gender2}
                  onChange={(e) => setGender2(e.target.value as typeof gender2)}
                  sx={{ width: 160 }}
                >
                  <MenuItem value="woman">woman</MenuItem>
                  <MenuItem value="man">man</MenuItem>
                  <MenuItem value="person">person</MenuItem>
                </TextField>
                <Alert severity={gender2 ? "info" : "warning"} sx={{ flex: 1 }}>
                  The second dataset's images are captioned exactly{" "}
                  <strong>“{trigger2.trim() || "trigger2"}, {gender2 || "…"}”</strong> —
                  its own pair, never group one's.
                </Alert>
              </Box>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!eligible.ok || busy || nameProblem !== null || fileProblem !== null
            || stepsProblem !== null || !trigger.trim() || gender === ""}
          onClick={submit}
        >
          {busy ? "Queueing…" : "Queue training"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
