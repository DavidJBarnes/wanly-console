import { useState } from "react";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField,
} from "@mui/material";

import { createCharacter, ltxError } from "../api/ltx";
import type { Character } from "../api/ltx";
import type { RegClass } from "../api/types";
import { characterProblem } from "../lib/trainingJob";

/**
 * Register a character before it has trained (wanly-console#537): name, trigger, gender.
 *
 * THE ONLY PLACE A TRIGGER OR GENDER IS TYPED. They used to be free text on every run, and
 * David's face ended up under a different trigger in each pair LoRA. Now they are written
 * once, here, and every run reads them from the registry; once the character has trained
 * the API refuses to change them.
 *
 * Woman or man only: those are the classes a regularization pool exists for, and a solo run
 * needs the pool of its gender.
 */
export default function NewCharacterDialog({
  onClose, onCreated, initialName = "",
}: {
  onClose: () => void;
  onCreated: (c: Character) => void;
  initialName?: string;
}) {
  const [name, setName] = useState(initialName);
  const [trigger, setTrigger] = useState("");
  const [gender, setGender] = useState<"" | RegClass>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const nameProblem = characterProblem(name.trim());
  // A comma would split the trigger inside "<trigger>, <gender>, <caption>" — the one
  // structural rule about a trigger that needs no data to check.
  const triggerProblem = !trigger.trim() ? "required"
    : trigger.includes(",") ? "no commas — the caption is comma-separated" : null;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const c = await createCharacter({
        name: name.trim(), trigger: trigger.trim(), gender: gender as RegClass, kind: "solo",
      });
      onCreated(c);
      onClose();
    } catch (e) {
      setError(ltxError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New character</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={name !== "" && nameProblem !== null}
            helperText={(name !== "" && nameProblem) || "One person, e.g. Kelly-2026."}
            autoFocus
            fullWidth
          />
          <TextField
            label="Trigger"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            error={trigger !== "" && triggerProblem !== null}
            helperText={(trigger !== "" && triggerProblem)
              || "The word a prompt types to get this face. Fixed once the character has trained."}
            fullWidth
          />
          <TextField
            select
            label="Gender"
            value={gender}
            onChange={(e) => setGender(e.target.value as RegClass)}
            helperText="What the trigger is bound to. Fixed once the character has trained."
            fullWidth
          >
            <MenuItem value="woman">woman</MenuItem>
            <MenuItem value="man">man</MenuItem>
          </TextField>
          {trigger.trim() && gender && (
            <Alert severity="info">
              Every caption for this character starts{" "}
              <strong>“{trigger.trim()}, {gender}, …”</strong>
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="contained"
          disabled={busy || nameProblem !== null || triggerProblem !== null || !gender}
          onClick={submit}
        >
          {busy ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
