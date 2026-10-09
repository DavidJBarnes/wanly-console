import { useEffect, useState } from "react";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField,
  ToggleButton, ToggleButtonGroup,
} from "@mui/material";

import { createDataset } from "../api/client";
import { createCharacter, listRecipes, ltxError } from "../api/ltx";
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
 *
 * A PAIR (wanly-api#452) is two registered people: its trigger is their phrases joined, which
 * the API derives -- nothing to type. With `createSet`, the character is born WITH its
 * dataset (a character has its dataset): an empty character set, or a pair's together set.
 */
export default function NewCharacterDialog({
  onClose, onCreated, initialName = "", createSet = false, allowPair = false,
}: {
  onClose: () => void;
  onCreated: (c: Character) => void;
  initialName?: string;
  /** Create the character's (empty) dataset with it -- the Characters page's New character. */
  createSet?: boolean;
  /** Offer "pair" as well as "solo". */
  allowPair?: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<"solo" | "pair">("solo");
  const [members, setMembers] = useState<[string, string]>(["", ""]);
  const [solos, setSolos] = useState<Character[]>([]);
  useEffect(() => {
    if (!allowPair) return;
    let live = true;
    listRecipes().then((b) => {
      if (live) setSolos((b.characters ?? []).filter((c) => (c.kind ?? "solo") === "solo" && c.trigger && c.gender));
    }).catch(() => {});
    return () => { live = false; };
  }, [allowPair]);
  const pair = kind === "pair";
  const [trigger, setTrigger] = useState("");
  const [gender, setGender] = useState<"" | RegClass>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const nameProblem = characterProblem(name.trim());
  // A comma would split the trigger inside "<trigger>, <gender>, <caption>" — the one
  // structural rule about a trigger that needs no data to check.
  const triggerProblem = pair ? null : !trigger.trim() ? "required"
    : trigger.includes(",") ? "no commas — the caption is comma-separated" : null;
  const membersProblem = !pair ? null
    : !members[0] || !members[1] ? "pick both people"
      : members[0] === members[1] ? "two different people" : null;
  const phraseOf = (n: string) => {
    const m = solos.find((c) => c.name === n);
    return m ? `${m.trigger}, ${m.gender}` : n;
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const c = pair
        ? await createCharacter({ name: name.trim(), kind: "pair", members: [...members] })
        : await createCharacter({
          name: name.trim(), trigger: trigger.trim(), gender: gender as RegClass, kind: "solo",
        });
      if (createSet) {
        await createDataset({ name: c.name, kind: pair ? "composition" : "character", character: c.name });
      }
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
          {allowPair && (
            <ToggleButtonGroup exclusive size="small" value={kind}
                               onChange={(_, v) => { if (v) setKind(v); }}>
              <ToggleButton value="solo">One person</ToggleButton>
              <ToggleButton value="pair">A pair</ToggleButton>
            </ToggleButtonGroup>
          )}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={name !== "" && nameProblem !== null}
            helperText={(name !== "" && nameProblem) || (pair ? "The pair, e.g. DavidJoana." : "One person, e.g. Kelly-2026.")}
            autoFocus
            fullWidth
          />
          {pair ? (
            <>
              {[0, 1].map((ix) => (
                <TextField key={ix} select label={ix === 0 ? "First person" : "Second person"}
                           value={members[ix]} fullWidth
                           onChange={(e) => setMembers((m) => (ix === 0 ? [e.target.value, m[1]] : [m[0], e.target.value]))}>
                  {solos.map((c) => <MenuItem key={c.name} value={c.name}>{c.name}</MenuItem>)}
                </TextField>
              ))}
              {membersProblem === null && (
                <Alert severity="info">
                  The pair's trigger is their phrases joined:{" "}
                  <strong>“{phraseOf(members[0])} and {phraseOf(members[1])}”</strong>
                </Alert>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="contained"
          disabled={busy || nameProblem !== null || triggerProblem !== null
            || (pair ? membersProblem !== null : !gender)}
          onClick={submit}
        >
          {busy ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
