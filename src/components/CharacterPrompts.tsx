import { useCallback, useEffect, useState } from "react";
import {
  Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import { ContentCopy, DeleteOutline, Edit } from "@mui/icons-material";
import {
  addCharacterPrompt, deleteCharacterPrompt, editCharacterPrompt, listCharacterPrompts,
} from "../api/client";
import type { CharacterPrompt } from "../api/types";
import { promptDateLabel } from "../lib/characterPage";

/**
 * A character's good working prompts (console#675): many short entries, each with the date it
 * was added, not one long textarea. Add, copy, edit in place, delete.
 */
export default function CharacterPrompts({ character }: { character: string }) {
  const [prompts, setPrompts] = useState<CharacterPrompt[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [doomed, setDoomed] = useState<CharacterPrompt | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setPrompts(await listCharacterPrompts(character));
      setError("");
    } catch {
      setError("Could not load the prompts.");
    }
  }, [character]);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    try {
      await fn();
      setError("");
      await load();
      return true;
    } catch {
      setError(failed);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!draft.trim()) return;
    if (await run(() => addCharacterPrompt(character, draft), "Could not add the prompt.")) setDraft("");
  };

  const save = async () => {
    if (!editing || !editing.text.trim()) return;
    if (await run(() => editCharacterPrompt(editing.id, editing.text), "Could not save the prompt.")) {
      setEditing(null);
    }
  };

  const copy = async (p: CharacterPrompt) => {
    try {
      await navigator.clipboard.writeText(p.text);
      setCopied(p.id);
      setTimeout(() => setCopied((c) => (c === p.id ? null : c)), 1500);
    } catch {
      setError("Could not copy to the clipboard.");
    }
  };

  return (
    <Box sx={{ maxWidth: 900 }}>
      <Stack spacing={1} sx={{ mb: 2 }}>
        <TextField
          label="Add a prompt that works"
          multiline
          minRows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void add(); }
          }}
          helperText="Ctrl+Enter adds it"
        />
        <Box>
          <Button variant="contained" disabled={busy || !draft.trim()} onClick={() => void add()}>
            Add
          </Button>
        </Box>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {prompts === null ? null : prompts.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No prompts yet. Add the ones that work for {character} and they will list here, newest first.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {prompts.map((p) => (
            <Card key={p.id} variant="outlined">
              <CardContent sx={{ pb: "12px !important" }}>
                {editing?.id === p.id ? (
                  <Stack spacing={1}>
                    <TextField
                      multiline
                      minRows={2}
                      autoFocus
                      value={editing.text}
                      onChange={(e) => setEditing({ id: p.id, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <Stack direction="row" spacing={1}>
                      <Button size="small" variant="contained" disabled={busy || !editing.text.trim()}
                              onClick={() => void save()}>Save</Button>
                      <Button size="small" onClick={() => setEditing(null)}>Cancel</Button>
                    </Stack>
                  </Stack>
                ) : (
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {p.text}
                  </Typography>
                )}
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                    {promptDateLabel(p)}
                  </Typography>
                  <Tooltip title={copied === p.id ? "Copied" : "Copy"}>
                    <IconButton size="small" onClick={() => void copy(p)}><ContentCopy fontSize="small" /></IconButton>
                  </Tooltip>
                  <Tooltip title="Edit">
                    <IconButton size="small" disabled={editing?.id === p.id}
                                onClick={() => setEditing({ id: p.id, text: p.text })}>
                      <Edit fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton size="small" color="error" onClick={() => setDoomed(p)}>
                      <DeleteOutline fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <Dialog open={doomed !== null} onClose={() => setDoomed(null)}>
        <DialogTitle>Delete this prompt?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{doomed?.text}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDoomed(null)}>Cancel</Button>
          <Button color="error" disabled={busy} onClick={async () => {
            const p = doomed;
            if (p && await run(() => deleteCharacterPrompt(p.id), "Could not delete the prompt.")) setDoomed(null);
          }}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
