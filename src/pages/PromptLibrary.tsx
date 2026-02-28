import { useEffect, useState, useCallback } from "react";
import {
  Autocomplete,
  Box,
  Typography,
  Card,
  CardContent,
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
  Divider,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import { Add, DeleteOutline, Edit } from "@mui/icons-material";
import {
  getWildcards,
  createWildcard,
  updateWildcard,
  deleteWildcard,
  createPromptPreset,
  updatePromptPreset,
  deletePromptPreset,
  getFileUrl,
} from "../api/client";
import { usePromptPresetStore } from "../stores/promptPresetStore";
import { useLoraStore } from "../stores/loraStore";
import type { WildcardResponse, PromptPreset, PromptPresetLoraSlot, LoraListItem } from "../api/types";

export default function PromptLibrary() {
  const [wildcards, setWildcards] = useState<WildcardResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wcDialogOpen, setWcDialogOpen] = useState(false);
  const [editingWildcard, setEditingWildcard] = useState<WildcardResponse | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<WildcardResponse | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Preset state
  const { presets, loading: presetsLoading, fetchPresets } = usePromptPresetStore();
  const { loras: loraLibrary, fetchLoras } = useLoraStore();
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<PromptPreset | null>(null);
  const [deletePresetConfirm, setDeletePresetConfirm] = useState<PromptPreset | null>(null);
  const [deletingPreset, setDeletingPreset] = useState(false);

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
    fetchPresets();
    fetchLoras();
  }, [fetchWildcards, fetchPresets, fetchLoras]);

  const handleDeleteWildcard = async (wc: WildcardResponse) => {
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

  const handleDeletePreset = async (preset: PromptPreset) => {
    setDeletingPreset(true);
    try {
      await deletePromptPreset(preset.id);
      setDeletePresetConfirm(null);
      fetchPresets();
    } catch {
      setError("Failed to delete preset");
    } finally {
      setDeletingPreset(false);
    }
  };

  const resolveLoraName = (loraId: string) => {
    const lora = loraLibrary.find((l) => l.id === loraId);
    return lora?.name ?? loraId.slice(0, 8);
  };

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  return (
    <Box>
      {/* ── Prompt Presets Section ── */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Box>
          <Typography variant={isMobile ? "h5" : "h4"}>Prompt Presets</Typography>
          {!isMobile && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Saved prompt + LoRA combos for quick re-use
            </Typography>
          )}
        </Box>
        <Button
          variant="contained"
          startIcon={isMobile ? undefined : <Add />}
          size={isMobile ? "small" : "medium"}
          onClick={() => {
            setEditingPreset(null);
            setPresetDialogOpen(true);
          }}
        >
          {isMobile ? "New" : "New Preset"}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {presetsLoading && presets.length === 0 && (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {presets.length > 0 ? (
        <Grid container spacing={2} sx={{ mb: 4 }}>
          {presets.map((preset) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={preset.id}>
              <Card sx={{ height: "100%" }}>
                <CardContent sx={{ pb: "12px !important" }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {preset.name}
                    </Typography>
                    <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditingPreset(preset);
                          setPresetDialogOpen(true);
                        }}
                      >
                        <Edit fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => setDeletePresetConfirm(preset)}
                      >
                        <DeleteOutline fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      mb: 1,
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {preset.prompt}
                  </Typography>
                  {preset.loras && preset.loras.length > 0 && (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {preset.loras.map((l) => (
                        <Chip
                          key={l.lora_id}
                          label={resolveLoraName(l.lora_id)}
                          size="small"
                          variant="outlined"
                          color="primary"
                        />
                      ))}
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : (
        !presetsLoading && (
          <Card sx={{ textAlign: "center", py: 4, mb: 4 }}>
            <Typography variant="h6" color="text.secondary">
              No presets yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Save a prompt + LoRA combo for quick re-use in job creation.
            </Typography>
          </Card>
        )
      )}

      <PromptPresetDialog
        open={presetDialogOpen}
        editing={editingPreset}
        onClose={() => setPresetDialogOpen(false)}
        onSaved={() => {
          setPresetDialogOpen(false);
          fetchPresets();
        }}
      />

      <Dialog
        open={!!deletePresetConfirm}
        onClose={() => setDeletePresetConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Preset</DialogTitle>
        <DialogContent>
          <Typography>
            Delete preset <strong>{deletePresetConfirm?.name}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletePresetConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => deletePresetConfirm && handleDeletePreset(deletePresetConfirm)}
            disabled={deletingPreset}
          >
            {deletingPreset ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Divider ── */}
      <Divider sx={{ my: 4 }} />

      {/* ── Wildcards Section ── */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Box>
          <Typography variant={isMobile ? "h5" : "h4"}>Prompt Wildcards</Typography>
          {!isMobile && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Use <code>&lt;name&gt;</code> in prompts to insert a random value
            </Typography>
          )}
        </Box>
        <Button
          variant="contained"
          startIcon={isMobile ? undefined : <Add />}
          size={isMobile ? "small" : "medium"}
          onClick={() => {
            setEditingWildcard(null);
            setWcDialogOpen(true);
          }}
        >
          {isMobile ? "New" : "New Wildcard"}
        </Button>
      </Box>

      {loading && wildcards.length === 0 && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {wildcards.length > 0 ? (
        <>
          {/* Desktop table layout */}
          {!isMobile && (
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
                                  setWcDialogOpen(true);
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
          )}

          {/* Mobile card layout */}
          {isMobile && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {wildcards.map((wc) => (
                <Card key={wc.id}>
                  <CardContent sx={{ pb: "12px !important" }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        &lt;{wc.name}&gt;
                      </Typography>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
                        <Typography variant="caption" color="text.secondary">
                          {wc.options.length} options
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={() => {
                            setEditingWildcard(wc);
                            setWcDialogOpen(true);
                          }}
                        >
                          <Edit fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setDeleteConfirm(wc)}
                        >
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {wc.options.slice(0, 6).map((opt, i) => (
                        <Chip key={i} label={opt} size="small" variant="outlined" />
                      ))}
                      {wc.options.length > 6 && (
                        <Chip
                          label={`+${wc.options.length - 6} more`}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                      )}
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
        </>
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
        open={wcDialogOpen}
        editing={editingWildcard}
        onClose={() => setWcDialogOpen(false)}
        onSaved={() => {
          setWcDialogOpen(false);
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
            onClick={() => deleteConfirm && handleDeleteWildcard(deleteConfirm)}
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ── Prompt Preset Dialog ── */

function PromptPresetDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: PromptPreset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { loras: loraLibrary, fetchLoras } = useLoraStore();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loraSlots, setLoraSlots] = useState<
    { lora_id: string; name: string; high_weight: number; low_weight: number; preview_image: string | null }[]
  >([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      fetchLoras();
      if (editing) {
        setName(editing.name);
        setPrompt(editing.prompt);
        setLoraSlots(
          (editing.loras ?? []).map((l) => {
            const lib = loraLibrary.find((item) => item.id === l.lora_id);
            return {
              lora_id: l.lora_id,
              name: lib?.name ?? l.lora_id.slice(0, 8),
              high_weight: l.high_weight,
              low_weight: l.low_weight,
              preview_image: lib?.preview_image ?? null,
            };
          }),
        );
      } else {
        setName("");
        setPrompt("");
        setLoraSlots([]);
      }
      setError("");
    }
  }, [open, editing, fetchLoras]);

  // Re-resolve names when loraLibrary loads
  useEffect(() => {
    if (open && loraLibrary.length > 0 && loraSlots.length > 0) {
      setLoraSlots((prev) =>
        prev.map((s) => {
          const lib = loraLibrary.find((item) => item.id === s.lora_id);
          return lib ? { ...s, name: lib.name, preview_image: lib.preview_image } : s;
        }),
      );
    }
  }, [open, loraLibrary]);

  const addLora = (item: LoraListItem | null) => {
    if (!item || loraSlots.length >= 3) return;
    if (loraSlots.some((l) => l.lora_id === item.id)) return;
    setLoraSlots([
      ...loraSlots,
      {
        lora_id: item.id,
        name: item.name,
        high_weight: item.default_high_weight,
        low_weight: item.default_low_weight,
        preview_image: item.preview_image,
      },
    ]);
  };

  const updateWeight = (idx: number, field: string, value: number) => {
    const updated = [...loraSlots];
    updated[idx] = { ...updated[idx], [field]: value };
    setLoraSlots(updated);
  };

  const removeLora = (idx: number) => {
    setLoraSlots(loraSlots.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!prompt.trim()) {
      setError("Prompt is required");
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const loras: PromptPresetLoraSlot[] | undefined =
        loraSlots.length > 0
          ? loraSlots.map((l) => ({
              lora_id: l.lora_id,
              high_weight: l.high_weight,
              low_weight: l.low_weight,
            }))
          : undefined;

      if (editing) {
        await updatePromptPreset(editing.id, {
          name: name.trim(),
          prompt: prompt.trim(),
          loras: loras ?? null,
        });
      } else {
        await createPromptPreset({
          name: name.trim(),
          prompt: prompt.trim(),
          loras: loras ?? null,
        });
      }
      onSaved();
    } catch (e: unknown) {
      const detail =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setError(detail ?? "Failed to save preset");
    } finally {
      setSubmitting(false);
    }
  };

  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle>{editing ? "Edit Preset" : "New Preset"}</DialogTitle>
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
        />
        <TextField
          label="Prompt"
          fullWidth
          multiline
          rows={4}
          margin="normal"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        {/* LoRA slots */}
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            LoRAs
          </Typography>
          {loraSlots.length < 3 && (
            <Autocomplete
              options={loraLibrary
                .filter((l) => !loraSlots.some((s) => s.lora_id === l.id))
                .sort((a, b) => a.name.localeCompare(b.name))}
              getOptionLabel={(o) => o.name}
              onChange={(_, val) => addLora(val)}
              value={null}
              renderOption={(props, option) => {
                const idx = (props as unknown as { "data-option-index": number })["data-option-index"];
                return (
                  <Box
                    component="li"
                    {...props}
                    key={option.id}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      bgcolor: idx % 2 === 0 ? "#f5f5f5" : "#ffffff",
                    }}
                  >
                    {option.preview_image ? (
                      <Box
                        component="img"
                        src={getFileUrl(option.preview_image)}
                        alt=""
                        sx={{ width: 40, height: 40, objectFit: "cover", borderRadius: 0.5, flexShrink: 0 }}
                      />
                    ) : (
                      <Box sx={{ width: 40, height: 40, bgcolor: "#eee", borderRadius: 0.5, flexShrink: 0 }} />
                    )}
                    <Box>
                      <Typography variant="body2">{option.name}</Typography>
                      {option.trigger_words && (
                        <Typography variant="caption" color="text.secondary">
                          {option.trigger_words}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              }}
              renderInput={(params) => (
                <TextField {...params} size="small" placeholder="Search LoRA library..." />
              )}
              size="small"
              blurOnSelect
              clearOnBlur
            />
          )}
          {loraSlots.map((lora, idx) => (
            <Card key={lora.lora_id} variant="outlined" sx={{ p: 1.5, mt: 1 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                {lora.preview_image ? (
                  <Box
                    component="img"
                    src={getFileUrl(lora.preview_image)}
                    alt=""
                    sx={{ width: 36, height: 36, objectFit: "cover", borderRadius: 0.5 }}
                  />
                ) : (
                  <Box sx={{ width: 36, height: 36, bgcolor: "#eee", borderRadius: 0.5 }} />
                )}
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
                  {lora.name}
                </Typography>
                <Button size="small" color="error" onClick={() => removeLora(idx)}>
                  Remove
                </Button>
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                <TextField
                  label="High Weight"
                  size="small"
                  type="number"
                  value={lora.high_weight}
                  onChange={(e) => updateWeight(idx, "high_weight", parseFloat(e.target.value))}
                  sx={{ flex: 1, minWidth: 100 }}
                  slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
                />
                <TextField
                  label="Low Weight"
                  size="small"
                  type="number"
                  value={lora.low_weight}
                  onChange={(e) => updateWeight(idx, "low_weight", parseFloat(e.target.value))}
                  sx={{ flex: 1, minWidth: 100 }}
                  slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
                />
              </Box>
            </Card>
          ))}
        </Box>
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

/* ── Wildcard Dialog ── */

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

  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
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
