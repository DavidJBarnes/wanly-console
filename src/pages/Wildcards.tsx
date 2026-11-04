import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Typography,
  Button,
  Card,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Chip,
  CircularProgress,
  Tooltip,
} from "@mui/material";
import { Add, Edit, DeleteOutline, ContentCopy, Close } from "@mui/icons-material";
import { getWildcards, createWildcard, updateWildcard, deleteWildcard } from "../api/client";
import type { WildcardResponse } from "../api/types";
import {
  editRow,
  fromRows,
  optionsToText,
  removeRow,
  textToOptions,
  toRows,
  type OptionRow,
} from "../lib/wildcardOptions";

// The API resolver matches <([^<>]+)> — so a name containing angle brackets can never be hit.
const NAME_RE = /^[^<>]+$/;

// Options are long sentences, which chips/autocomplete would make unreadable. Each one gets
// its own field so it's obvious where one ends and the next begins; Bulk edit keeps the old
// one-per-line textarea for pasting many at once.

export default function Wildcards() {
  const [wildcards, setWildcards] = useState<WildcardResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WildcardResponse | null>(null);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<OptionRow[]>(() => toRows([]));
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const inputs = useRef(new Map<number, HTMLTextAreaElement>());
  const focusAt = useRef<{ index: number; caret: "start" | "end" } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<WildcardResponse | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      setWildcards(await getWildcards());
      setError(null);
    } catch {
      setError("Failed to load wildcards");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const openNew = () => {
    setEditing(null);
    setName("");
    setRows(toRows([]));
    setBulk(false);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (wc: WildcardResponse) => {
    setEditing(wc);
    setName(wc.name);
    setRows(toRows(wc.options));
    setBulk(false);
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    const options = bulk ? textToOptions(bulkText) : fromRows(rows);
    if (!trimmed) {
      setFormError("Name is required");
      return;
    }
    if (!NAME_RE.test(trimmed)) {
      setFormError("Name cannot contain < or >");
      return;
    }
    if (options.length === 0) {
      setFormError("Add at least one option — a wildcard with no options is left unresolved in the prompt");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateWildcard(editing.id, { name: trimmed, options });
      } else {
        await createWildcard({ name: trimmed, options });
      }
      setDialogOpen(false);
      await fetchAll();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFormError(detail ?? "Failed to save wildcard");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteWildcard(deleteConfirm.id);
      setDeleteConfirm(null);
      await fetchAll();
    } catch {
      setError("Failed to delete wildcard");
      setDeleteConfirm(null);
    }
  };

  // After a split or removal, move the caret into the row it belongs in.
  useEffect(() => {
    const f = focusAt.current;
    if (!f) return;
    focusAt.current = null;
    const el = rows[f.index] && inputs.current.get(rows[f.index].id);
    if (!el) return;
    el.focus();
    const pos = f.caret === "start" ? 0 : el.value.length;
    el.setSelectionRange(pos, pos);
  }, [rows]);

  const changeRow = (index: number, value: string) => {
    const r = editRow(rows, index, value);
    if (r.focus !== index) focusAt.current = { index: r.focus, caret: "start" };
    setRows(r.rows);
  };

  const deleteRow = (index: number) => {
    focusAt.current = { index: Math.max(0, index - 1), caret: "end" };
    setRows(removeRow(rows, index));
  };

  const addRow = () => {
    focusAt.current = { index: rows.length, caret: "start" };
    setRows(editRow(rows, rows.length - 1, rows[rows.length - 1].text + "\n").rows);
  };

  const toggleBulk = () => {
    if (bulk) setRows(toRows(textToOptions(bulkText)));
    else setBulkText(optionsToText(fromRows(rows)));
    setBulk(!bulk);
  };

  const optionCount = bulk ? textToOptions(bulkText).length : fromRows(rows).length;

  const copyToken = (wcName: string) => {
    navigator.clipboard.writeText(`<${wcName}>`);
    setCopied(wcName);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          Wildcards
        </Typography>
        <Button variant="contained" startIcon={<Add />} onClick={openNew} sx={{ ml: "auto" }}>
          New Wildcard
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Drop <code>&lt;name&gt;</code> into any segment prompt. At submission the API swaps it for a
        random option and stores the unresolved template alongside the resolved prompt. A name used
        twice in one prompt resolves to the <strong>same</strong> option both times — and an unknown
        name is passed through to the model verbatim, brackets and all.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ textAlign: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : wildcards.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No wildcards yet. Create one to start varying prompts across a batch.
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {wildcards.map((wc) => (
            <Card key={wc.id} variant="outlined" sx={{ p: 2 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <Typography
                  sx={{ fontFamily: "monospace", fontWeight: 600, fontSize: "0.95rem" }}
                >
                  &lt;{wc.name}&gt;
                </Typography>
                <Tooltip title={copied === wc.name ? "Copied!" : "Copy token"}>
                  <IconButton size="small" onClick={() => copyToken(wc.name)}>
                    <ContentCopy fontSize="inherit" />
                  </IconButton>
                </Tooltip>
                <Chip label={`${wc.options.length} options`} size="small" variant="outlined" />
                <Box sx={{ ml: "auto", display: "flex", gap: 0.5 }}>
                  <IconButton size="small" onClick={() => openEdit(wc)}>
                    <Edit fontSize="small" />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => setDeleteConfirm(wc)}>
                    <DeleteOutline fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                {wc.options.slice(0, 3).map((opt, i) => (
                  <Typography
                    key={i}
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    • {opt}
                  </Typography>
                ))}
                {wc.options.length > 3 && (
                  <Typography variant="caption" color="text.secondary">
                    …and {wc.options.length - 3} more
                  </Typography>
                )}
              </Box>
            </Card>
          ))}
        </Box>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? "Edit Wildcard" : "New Wildcard"}</DialogTitle>
        <DialogContent>
          {formError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {formError}
            </Alert>
          )}
          <TextField
            label="Name"
            size="small"
            fullWidth
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            helperText={`Referenced in prompts as <${name.trim() || "name"}>`}
            sx={{ mt: 1, mb: 2 }}
          />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <Typography variant="subtitle2">Options</Typography>
            <Chip label={optionCount} size="small" variant="outlined" />
            <Button size="small" onClick={toggleBulk} sx={{ ml: "auto" }}>
              {bulk ? "Edit as list" : "Bulk edit"}
            </Button>
          </Box>
          {bulk ? (
            <TextField
              multiline
              minRows={6}
              maxRows={18}
              fullWidth
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              helperText="One option per line. Blank lines are ignored."
            />
          ) : (
            <>
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.5,
                  maxHeight: "55vh",
                  overflowY: "auto",
                  pr: 0.5,
                  pt: 0.5,
                }}
              >
                {rows.map((row, i) => (
                  <Box key={row.id} sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                    <Box
                      sx={{
                        flexShrink: 0,
                        width: 28,
                        height: 28,
                        mt: 1,
                        borderRadius: "50%",
                        bgcolor: "action.selected",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                      }}
                    >
                      {i + 1}
                    </Box>
                    <TextField
                      multiline
                      minRows={1}
                      fullWidth
                      size="small"
                      placeholder="Describe this option…"
                      value={row.text}
                      inputRef={(el: HTMLTextAreaElement | null) => {
                        if (el) inputs.current.set(row.id, el);
                        else inputs.current.delete(row.id);
                      }}
                      onChange={(e) => changeRow(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Backspace" && row.text === "" && rows.length > 1) {
                          e.preventDefault();
                          deleteRow(i);
                        }
                      }}
                    />
                    <Tooltip title="Remove option">
                      <IconButton size="small" onClick={() => deleteRow(i)} sx={{ mt: 0.75 }}>
                        <Close fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                ))}
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", mt: 1.5 }}>
                <Button size="small" startIcon={<Add />} onClick={addRow}>
                  Add option
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                  Enter starts a new option · pasting several lines adds one option per line
                </Typography>
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <DialogTitle>Delete wildcard?</DialogTitle>
        <DialogContent>
          Delete &lt;{deleteConfirm?.name}&gt;? Prompts still referencing it will pass the literal
          text through to the model.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
