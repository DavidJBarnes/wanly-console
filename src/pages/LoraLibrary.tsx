import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardMedia,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  IconButton,
  Tabs,
  Tab,
} from "@mui/material";
import {
  Add,
  AutoFixHigh,
  Delete,
  Edit,
} from "@mui/icons-material";
import { useLoraStore } from "../stores/loraStore";
import {
  createLora,
  createLoraUpload,
  updateLora,
  deleteLora,
  getLora,
  getFileUrl,
} from "../api/client";
import type { LoraListItem, LoraResponse, LoraCreate, LoraUpdate } from "../api/types";

export default function LoraLibrary() {
  const { loras, loading, fetchLoras } = useLoraStore();
  const [addOpen, setAddOpen] = useState(false);
  const [editLora, setEditLora] = useState<LoraResponse | null>(null);

  useEffect(() => {
    fetchLoras();
  }, [fetchLoras]);

  const handleAdded = () => {
    setAddOpen(false);
    fetchLoras();
  };

  const handleEditOpen = async (item: LoraListItem) => {
    try {
      const full = await getLora(item.id);
      setEditLora(full);
    } catch {
      // ignore
    }
  };

  const handleEdited = () => {
    setEditLora(null);
    fetchLoras();
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
        <Typography variant="h4">LoRA Library</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setAddOpen(true)}
        >
          Add LoRA
        </Button>
      </Box>

      {loading && loras.length === 0 && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {loras.length > 0 && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "1fr 1fr",
              md: "repeat(3, 1fr)",
              lg: "repeat(4, 1fr)",
            },
            gap: 2,
          }}
        >
          {loras.map((lora) => (
            <LoraCard
              key={lora.id}
              lora={lora}
              onClick={() => handleEditOpen(lora)}
            />
          ))}
        </Box>
      )}

      {!loading && loras.length === 0 && (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 8 }}>
            <AutoFixHigh
              sx={{ fontSize: 64, color: "text.disabled", mb: 2 }}
            />
            <Typography variant="h6" color="text.secondary">
              No LoRAs yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Add LoRAs to your library to use them in video generation.
            </Typography>
          </CardContent>
        </Card>
      )}

      <AddLoraDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={handleAdded}
      />

      {editLora && (
        <EditLoraDialog
          lora={editLora}
          onClose={() => setEditLora(null)}
          onSaved={handleEdited}
        />
      )}
    </Box>
  );
}

function LoraCard({
  lora,
  onClick,
}: {
  lora: LoraListItem;
  onClick: () => void;
}) {
  return (
    <Card
      sx={{ cursor: "pointer", "&:hover": { boxShadow: 4 } }}
      onClick={onClick}
    >
      {lora.preview_image ? (
        <CardMedia
          component="img"
          height="180"
          image={getFileUrl(lora.preview_image)}
          alt={lora.name}
          sx={{ objectFit: "cover" }}
        />
      ) : (
        <Box
          sx={{
            height: 180,
            bgcolor: "#f0f0f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AutoFixHigh sx={{ fontSize: 48, color: "text.disabled" }} />
        </Box>
      )}
      <CardContent sx={{ pb: "12px !important" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
          {lora.name}
        </Typography>
        {lora.trigger_words && (
          <Box sx={{ mt: 0.5, display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {lora.trigger_words
              .split(",")
              .slice(0, 3)
              .map((w) => (
                <Chip key={w.trim()} label={w.trim()} size="small" />
              ))}
          </Box>
        )}
        <Box sx={{ mt: 1, display: "flex", gap: 0.5 }}>
          {lora.high_file && (
            <Chip
              label="High"
              size="small"
              color="primary"
              variant="outlined"
            />
          )}
          {lora.low_file && (
            <Chip
              label="Low"
              size="small"
              color="secondary"
              variant="outlined"
            />
          )}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ ml: "auto", alignSelf: "center" }}
          >
            {lora.default_high_weight}/{lora.default_low_weight}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

function AddLoraDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [tab, setTab] = useState(0);
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [highUrl, setHighUrl] = useState("");
  const [lowUrl, setLowUrl] = useState("");
  const [triggerWords, setTriggerWords] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [description, setDescription] = useState("");
  const [highWeight, setHighWeight] = useState(1.0);
  const [lowWeight, setLowWeight] = useState(1.0);
  const [highFile, setHighFile] = useState<File | null>(null);
  const [lowFile, setLowFile] = useState<File | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setTab(0);
    setName("");
    setSourceUrl("");
    setHighUrl("");
    setLowUrl("");
    setTriggerWords("");
    setDefaultPrompt("");
    setDescription("");
    setHighWeight(1.0);
    setLowWeight(1.0);
    setHighFile(null);
    setLowFile(null);
    setPreviewFile(null);
    setError("");
  }, []);

  const handleSubmitUrl = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const body: LoraCreate = {
        name: name.trim(),
        description: description.trim() || null,
        trigger_words: triggerWords.trim() || null,
        default_prompt: defaultPrompt.trim() || null,
        source_url: sourceUrl.trim() || null,
        high_url: highUrl.trim() || null,
        low_url: lowUrl.trim() || null,
        default_high_weight: highWeight,
        default_low_weight: lowWeight,
      };
      await createLora(body);
      resetForm();
      onAdded();
    } catch (e: unknown) {
      let msg = "Failed to create LoRA";
      if (e && typeof e === "object" && "response" in e) {
        const resp = (e as { response?: { status?: number; data?: { detail?: string } } }).response;
        if (resp?.data?.detail) {
          msg = resp.data.detail;
        } else if (resp?.status) {
          msg = `Server error (${resp.status}). The download may have timed out — try again.`;
        }
      } else if (e && typeof e === "object" && "message" in e) {
        msg = `Network error: ${(e as { message: string }).message}`;
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitUpload = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const body: LoraCreate = {
        name: name.trim(),
        description: description.trim() || null,
        trigger_words: triggerWords.trim() || null,
        default_prompt: defaultPrompt.trim() || null,
        source_url: sourceUrl.trim() || null,
        default_high_weight: highWeight,
        default_low_weight: lowWeight,
      };
      const formData = new FormData();
      formData.append("data", JSON.stringify(body));
      if (highFile) formData.append("high_file", highFile);
      if (lowFile) formData.append("low_file", lowFile);
      if (previewFile) formData.append("preview_image", previewFile);
      await createLoraUpload(formData);
      resetForm();
      onAdded();
    } catch (e: unknown) {
      let msg = "Failed to upload LoRA";
      if (e && typeof e === "object" && "response" in e) {
        const resp = (e as { response?: { status?: number; data?: { detail?: string } } }).response;
        if (resp?.data?.detail) {
          msg = resp.data.detail;
        } else if (resp?.status) {
          msg = `Server error (${resp.status})`;
        }
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add LoRA</DialogTitle>
      <DialogContent>
        {submitting && (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              py: 4,
              gap: 2,
            }}
          >
            <CircularProgress size={48} />
            <Typography color="text.secondary">
              {tab === 0
                ? "Downloading .safetensors from URL and uploading to S3... This may take a few minutes."
                : "Uploading files to S3..."}
            </Typography>
          </Box>
        )}

        {!submitting && (
          <>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab label="From URL" />
          <Tab label="Upload File" />
        </Tabs>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
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

        {tab === 0 && (
          <>
            <TextField
              label="CivitAI Page URL"
              fullWidth
              margin="normal"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://civitai.com/models/..."
              helperText="Preview image auto-fetched from CivitAI"
            />
            <TextField
              label="High Noise .safetensors URL"
              fullWidth
              margin="normal"
              value={highUrl}
              onChange={(e) => setHighUrl(e.target.value)}
              placeholder="Direct download link"
            />
            <TextField
              label="Low Noise .safetensors URL"
              fullWidth
              margin="normal"
              value={lowUrl}
              onChange={(e) => setLowUrl(e.target.value)}
              placeholder="Direct download link (optional)"
            />
          </>
        )}

        {tab === 1 && (
          <>
            <TextField
              label="CivitAI Page URL (optional)"
              fullWidth
              margin="normal"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
            <Box sx={{ mt: 2, display: "flex", gap: 2 }}>
              <Button variant="outlined" component="label" size="small">
                {highFile ? highFile.name : "High Noise File"}
                <input
                  type="file"
                  hidden
                  accept=".safetensors"
                  onChange={(e) => setHighFile(e.target.files?.[0] ?? null)}
                />
              </Button>
              <Button variant="outlined" component="label" size="small">
                {lowFile ? lowFile.name : "Low Noise File"}
                <input
                  type="file"
                  hidden
                  accept=".safetensors"
                  onChange={(e) => setLowFile(e.target.files?.[0] ?? null)}
                />
              </Button>
              <Button variant="outlined" component="label" size="small">
                {previewFile ? previewFile.name : "Preview Image"}
                <input
                  type="file"
                  hidden
                  accept="image/*"
                  onChange={(e) =>
                    setPreviewFile(e.target.files?.[0] ?? null)
                  }
                />
              </Button>
            </Box>
          </>
        )}

        <TextField
          label="Trigger Words"
          fullWidth
          margin="normal"
          value={triggerWords}
          onChange={(e) => setTriggerWords(e.target.value)}
          placeholder="Comma-separated activation keywords"
        />
        <TextField
          label="Default Prompt"
          fullWidth
          multiline
          rows={2}
          margin="normal"
          value={defaultPrompt}
          onChange={(e) => setDefaultPrompt(e.target.value)}
          placeholder="Suggested prompt snippet for this LoRA"
        />
        <TextField
          label="Description"
          fullWidth
          multiline
          rows={2}
          margin="normal"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
          <TextField
            label="Default High Weight"
            type="number"
            value={highWeight}
            onChange={(e) => setHighWeight(parseFloat(e.target.value) || 0)}
            slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Default Low Weight"
            type="number"
            value={lowWeight}
            onChange={(e) => setLowWeight(parseFloat(e.target.value) || 0)}
            slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
            sx={{ flex: 1 }}
          />
        </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button
          variant="contained"
          onClick={tab === 0 ? handleSubmitUrl : handleSubmitUpload}
          disabled={submitting}
        >
          {submitting
            ? tab === 0
              ? "Downloading files..."
              : "Uploading..."
            : "Add LoRA"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EditLoraDialog({
  lora,
  onClose,
  onSaved,
}: {
  lora: LoraResponse;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(lora.name);
  const [description, setDescription] = useState(lora.description ?? "");
  const [triggerWords, setTriggerWords] = useState(lora.trigger_words ?? "");
  const [defaultPrompt, setDefaultPrompt] = useState(
    lora.default_prompt ?? "",
  );
  const [sourceUrl, setSourceUrl] = useState(lora.source_url ?? "");
  const [highWeight, setHighWeight] = useState(lora.default_high_weight);
  const [lowWeight, setLowWeight] = useState(lora.default_low_weight);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const body: LoraUpdate = {
        name: name.trim(),
        description: description.trim() || null,
        trigger_words: triggerWords.trim() || null,
        default_prompt: defaultPrompt.trim() || null,
        source_url: sourceUrl.trim() || null,
        default_high_weight: highWeight,
        default_low_weight: lowWeight,
      };
      await updateLora(lora.id, body);
      onSaved();
    } catch {
      setError("Failed to update LoRA");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setSubmitting(true);
    try {
      await deleteLora(lora.id);
      onSaved();
    } catch {
      setError("Failed to delete LoRA");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center" }}>
        <Edit sx={{ mr: 1 }} />
        Edit LoRA
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {lora.preview_image && (
          <Box sx={{ mb: 2, textAlign: "center" }}>
            <Box
              component="img"
              src={getFileUrl(lora.preview_image)}
              alt={lora.name}
              sx={{
                maxHeight: 200,
                borderRadius: 1,
                objectFit: "contain",
              }}
            />
          </Box>
        )}

        <TextField
          label="Name"
          fullWidth
          margin="normal"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="CivitAI Page URL"
          fullWidth
          margin="normal"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
        />
        <TextField
          label="Trigger Words"
          fullWidth
          margin="normal"
          value={triggerWords}
          onChange={(e) => setTriggerWords(e.target.value)}
        />
        <TextField
          label="Default Prompt"
          fullWidth
          multiline
          rows={2}
          margin="normal"
          value={defaultPrompt}
          onChange={(e) => setDefaultPrompt(e.target.value)}
        />
        <TextField
          label="Description"
          fullWidth
          multiline
          rows={2}
          margin="normal"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
          <TextField
            label="Default High Weight"
            type="number"
            value={highWeight}
            onChange={(e) => setHighWeight(parseFloat(e.target.value) || 0)}
            slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Default Low Weight"
            type="number"
            value={lowWeight}
            onChange={(e) => setLowWeight(parseFloat(e.target.value) || 0)}
            slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
            sx={{ flex: 1 }}
          />
        </Box>

        {/* Read-only file info */}
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Files (read-only)
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            {lora.high_file && (
              <Chip label={`High: ${lora.high_file}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
            )}
            {lora.low_file && (
              <Chip label={`Low: ${lora.low_file}`} size="small" sx={{ mb: 0.5 }} />
            )}
            {!lora.high_file && !lora.low_file && (
              <Typography variant="body2" color="text.secondary">
                No files uploaded
              </Typography>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between" }}>
        <Box>
          {!confirmDelete ? (
            <IconButton color="error" onClick={() => setConfirmDelete(true)}>
              <Delete />
            </IconButton>
          ) : (
            <Button
              color="error"
              variant="contained"
              size="small"
              onClick={handleDelete}
              disabled={submitting}
            >
              Confirm Delete
            </Button>
          )}
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={submitting}
          >
            {submitting ? "Saving..." : "Save"}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
