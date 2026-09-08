import { useEffect, useState } from "react";
import {
  Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography,
} from "@mui/material";

import { createTrainingJob, listTrainingJobs } from "../api/client";
import { listRecipes } from "../api/ltx";
import type { Character } from "../api/ltx";
import type { TrainingJob } from "../api/types";
import {
  apiErrorText, canTrain, characterProblem, defaultCharacterFor, defaultLoraName,
  loraFilename, loraNameProblem, nameNeedsSanitising, nextVersion,
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
  const [character, setCharacter] = useState(defaultCharacterFor(defaultCharacter ?? ""));
  const [trigger, setTrigger] = useState("");
  const [triggerTouched, setTriggerTouched] = useState(false);
  const [loraName, setLoraName] = useState("");
  const [loraNameTouched, setLoraNameTouched] = useState(false);
  const [version, setVersion] = useState(1);
  const [versionTouched, setVersionTouched] = useState(false);
  const [caption, setCaption] = useState("");
  const [steps, setSteps] = useState(1200);
  const [publish, setPublish] = useState<"final" | "all">("final");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // What exists already, so the dialog can offer the real character names — `p@y`, not a
  // retyped `pay` that would create a second character row — and default the version to the
  // next one rather than to 1.
  useEffect(() => {
    listRecipes().then((b) => setCharacters(b.characters)).catch(() => {});
    listTrainingJobs().then(setJobs).catch(() => {});
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

  const eligible = canTrain(imageKeys);
  const nameProblem = characterProblem(character.trim());
  const fileProblem = loraNameProblem(loraName.trim());
  const known = characters.find((c) => c.name.toLowerCase() === character.trim().toLowerCase());
  const epochs = Math.max(1, Math.floor(steps / Math.max(1, imageKeys.length * 10)));

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const job = await createTrainingJob({
        // The known row's exact spelling, so the finished LoRA lands on it rather than on a
        // new character that differs by case.
        character: known?.name ?? character.trim(),
        trigger: trigger.trim(), version, steps,
        lora_name: loraName.trim() || defaultLoraName(character),
        caption: caption || null,
        publish,
        // A dataset reference when there is one, so the run records where its images came
        // from; a bare list otherwise, for an ad-hoc selection in the Image Repo.
        ...(datasetId ? { dataset_id: datasetId } : { dataset_images: imageKeys }),
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
            helperText="What the captions say and a prompt types. May differ from the name."
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
              label="Steps"
              type="number"
              value={steps}
              onChange={(e) => setSteps(parseInt(e.target.value) || 1200)}
              helperText={`~${epochs} epochs over ${imageKeys.length} images`}
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

          <TextField
            label="Caption (optional)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={`${trigger || "trigger"}, woman`}
            helperText={
              "Applied to every image. Captions bind whatever they do not name — one caption " +
              "over close-ups makes the trigger carry close-up framing as part of its identity."
            }
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!eligible.ok || busy || nameProblem !== null || fileProblem !== null || !trigger.trim()}
          onClick={submit}
        >
          {busy ? "Queueing…" : "Queue training"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
