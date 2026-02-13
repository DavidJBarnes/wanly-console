import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Typography,
  Card,
  Button,
  TextField,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
} from "@mui/material";
import { Add, DeleteOutline, Edit } from "@mui/icons-material";
import {
  getWildcards,
  createWildcard,
  updateWildcard,
  deleteWildcard,
} from "../api/client";
import type { WildcardResponse } from "../api/types";

export default function PromptLibrary() {
  const [wildcards, setWildcards] = useState<WildcardResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingWildcard, setEditingWildcard] = useState<WildcardResponse | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<WildcardResponse | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchWildcards = useCallback(async () => {
    try {
      const data = await getWildcards();
      setWildcards(data);
      setError("");
    } catch {
      setError("Failed to load wildcards");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWildcards();
  }, [fetchWildcards]);

  const handleDelete = async (wc: WildcardResponse) => {
    setDeleting(true);
    try {
      await deleteWildcard(wc.id);
      setDeleteConfirm(null);
      fetchWildcards();
    } catch {
      setError("Failed to delete wildcard");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="h4">Prompt Wildcards</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Use <code>&lt;name&gt;</code> in prompts to insert a random value
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => {
            setEditingWildcard(null);
            setDialogOpen(true);
          }}
        >
          New Wildcard
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && wildcards.length === 0 && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {wildcards.length > 0 ? (
        <Card>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 200 }}>Name</TableCell>
                  <TableCell>Options</TableCell>
                  <TableCell sx={{ width: 80 }}>Count</TableCell>
                  <TableCell sx={{ width: 100 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {wildcards.map((wc) => (
                  <TableRow key={wc.id}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        &lt;{wc.name}&gt;
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                        {wc.options.slice(0, 10).map((opt, i) => (
                          <Chip key={i} label={opt} size="small" variant="outlined" />
                        ))}
                        {wc.options.length > 10 && (
                          <Chip
                            label={`+${wc.options.length - 10} more`}
                            size="small"
                            color="primary"
                            variant="outlined"
                          />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>{wc.options.length}</TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Tooltip title="Edit">
                          <IconButton
                            size="small"
                            onClick={() => {
                              setEditingWildcard(wc);
                              setDialogOpen(true);
                            }}
                          >
                            <Edit fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setDeleteConfirm(wc)}
                          >
                            <DeleteOutline fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      ) : (
        !loading && (
          <Card sx={{ textAlign: "center", py: 8 }}>
            <Typography variant="h6" color="text.secondary">
              No wildcards yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Create a wildcard to use random values in your prompts.
            </Typography>
          </Card>
        )
      )}

      <WildcardDialog
        open={dialogOpen}
        editing={editingWildcard}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          setDialogOpen(false);
          fetchWildcards();
        }}
      />

      <Dialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Wildcard</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <strong>&lt;{deleteConfirm?.name}&gt;</strong>? Existing
            prompts using this wildcard will no longer resolve.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function WildcardDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: WildcardResponse | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (editing) {
        setName(editing.name);
        setOptionsText(editing.options.join("\n"));
      } else {
        setName("");
        setOptionsText("");
      }
      setError("");
    }
  }, [open, editing]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    const options = optionsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (options.length === 0) {
      setError("At least one option is required");
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      if (editing) {
        await updateWildcard(editing.id, { name: name.trim(), options });
      } else {
        await createWildcard({ name: name.trim(), options });
      }
      onSaved();
    } catch (e: unknown) {
      const detail =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(detail ?? "Failed to save wildcard");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? "Edit Wildcard" : "New Wildcard"}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
            {error}
          </Alert>
        )}
        <TextField
          label="Name"
          fullWidth
          margin="normal"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          helperText={name ? `Usage: <${name}>` : "e.g. color, mood, style"}
        />
        <TextField
          label="Options (one per line)"
          fullWidth
          multiline
          rows={8}
          margin="normal"
          value={optionsText}
          onChange={(e) => setOptionsText(e.target.value)}
          helperText={`${optionsText.split("\n").filter((s) => s.trim()).length} options`}
          placeholder={"red\nblue\ngreen\nyellow"}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Saving..." : editing ? "Save" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
