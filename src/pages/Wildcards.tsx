import { useCallback, useEffect, useState } from "react";
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
import { Add, Edit, DeleteOutline, ContentCopy } from "@mui/icons-material";
import { getWildcards, createWildcard, updateWildcard, deleteWildcard } from "../api/client";
import type { WildcardResponse } from "../api/types";

// The API resolver matches <([^<>]+)> — so a name containing angle brackets can never be hit.
const NAME_RE = /^[^<>]+$/;

// Options are edited one-per-line: dolphin returns long sentences, which chips/autocomplete
// would make unreadable.
const optionsToText = (options: string[]) => options.join("\n");
const textToOptions = (text: string) =>
  text
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);

export default function Wildcards() {
  const [wildcards, setWildcards] = useState<WildcardResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WildcardResponse | null>(null);
  const [name, setName] = useState("");
  const [optionsText, setOptionsText] = useState("");
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
    setOptionsText("");
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (wc: WildcardResponse) => {
    setEditing(wc);
    setName(wc.name);
    setOptionsText(optionsToText(wc.options));
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    const options = textToOptions(optionsText);
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
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
          <TextField
            label="Options"
            multiline
            minRows={6}
            maxRows={18}
            fullWidth
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            helperText="One option per line. Blank lines are ignored."
          />
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
