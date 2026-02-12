import { useEffect, useState, useCallback } from "react";
import {
  Autocomplete,
  Box,
  Typography,
  Card,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
  Select,
  InputLabel,
  FormControl,
  OutlinedInput,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
} from "@mui/material";
import { Add } from "@mui/icons-material";
import { useNavigate } from "react-router";
import { useJobStore } from "../stores/jobStore";
import { useLoraStore } from "../stores/loraStore";
import { createJob, getFileUrl } from "../api/client";
import type { JobCreate, JobResponse, JobStatus, LoraListItem } from "../api/types";
import StatusChip from "../components/StatusChip";

const ALL_STATUSES: JobStatus[] = [
  "awaiting",
  "failed",
  "processing",
  "pending",
  "paused",
  "finalizing",
  "finalized",
];

const STATUS_PRIORITY: Record<string, number> = {
  awaiting: 0,
  failed: 1,
  processing: 2,
  pending: 3,
  paused: 4,
  finalizing: 5,
  finalized: 6,
};

type SortKey = "name" | "status" | "fps" | "created_at" | "updated_at";
type SortDir = "asc" | "desc";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function JobQueue() {
  const { jobs, loading, fetchJobs } = useJobStore();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const comparator = (a: JobResponse, b: JobResponse): number => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name":
        return dir * a.name.localeCompare(b.name);
      case "status": {
        const pa = STATUS_PRIORITY[a.status] ?? 99;
        const pb = STATUS_PRIORITY[b.status] ?? 99;
        return dir * (pa - pb);
      }
      case "fps":
        return dir * (a.fps - b.fps);
      case "created_at":
        return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case "updated_at":
        return dir * (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      default:
        return 0;
    }
  };

  const filteredJobs = jobs
    .filter((j) => statusFilter.length === 0 || statusFilter.includes(j.status))
    .sort(comparator);

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
        <Typography variant="h4">Job Queue</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setDialogOpen(true)}
        >
          New Job
        </Button>
      </Box>

      <Box sx={{ mb: 3 }}>
        <FormControl size="small" sx={{ minWidth: 250 }}>
          <InputLabel>Filter by Status</InputLabel>
          <Select<string[]>
            multiple
            value={statusFilter}
            onChange={(e) => {
              const val = e.target.value;
              setStatusFilter(
                typeof val === "string" ? val.split(",") : val,
              );
            }}
            input={<OutlinedInput label="Filter by Status" />}
            renderValue={(selected) => (
              <Box sx={{ display: "flex", gap: 0.5 }}>
                {(selected as string[]).map((s: string) => (
                  <Chip key={s} label={s} size="small" />
                ))}
              </Box>
            )}
          >
            {ALL_STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {loading && jobs.length === 0 && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {filteredJobs.length > 0 && (
        <Card>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 60 }}>Image</TableCell>
                  <SortableCell id="name" label="Name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  <SortableCell id="status" label="Status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} sx={{ width: 120 }} />
                  <TableCell>Dimensions</TableCell>
                  <SortableCell id="fps" label="FPS" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} sx={{ width: 80 }} />
                  <SortableCell id="created_at" label="Created" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} sx={{ width: 150 }} />
                  <SortableCell id="updated_at" label="Updated" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} sx={{ width: 150 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredJobs.map((job) => (
                  <TableRow
                    key={job.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => navigate(`/jobs/${job.id}`)}
                  >
                    <TableCell>
                      {job.starting_image ? (
                        <Box
                          component="img"
                          src={getFileUrl(job.starting_image)}
                          alt=""
                          sx={{
                            width: 48,
                            height: 48,
                            objectFit: "cover",
                            borderRadius: 1,
                            bgcolor: "#f5f5f5",
                            display: "block",
                          }}
                        />
                      ) : (
                        <Box
                          sx={{
                            width: 48,
                            height: 48,
                            borderRadius: 1,
                            bgcolor: "#f5f5f5",
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {job.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <StatusChip status={job.status} />
                    </TableCell>
                    <TableCell>
                      {job.width}x{job.height}
                    </TableCell>
                    <TableCell>{job.fps}</TableCell>
                    <TableCell>{formatDate(job.created_at)}</TableCell>
                    <TableCell>{formatDate(job.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {!loading && filteredJobs.length === 0 && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <Typography color="text.secondary">
            {jobs.length === 0
              ? "No jobs yet. Create your first one!"
              : "No jobs match the selected filters."}
          </Typography>
        </Box>
      )}

      <CreateJobDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => {
          setDialogOpen(false);
          fetchJobs();
        }}
      />
    </Box>
  );
}

function SortableCell({
  id,
  label,
  sortKey,
  sortDir,
  onSort,
  sx,
}: {
  id: SortKey;
  label: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  sx?: Record<string, unknown>;
}) {
  return (
    <TableCell sx={sx}>
      <TableSortLabel
        active={sortKey === id}
        direction={sortKey === id ? sortDir : "asc"}
        onClick={() => onSort(id)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );
}

function CreateJobDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(640);
  const [fps, setFps] = useState(30);
  const [duration, setDuration] = useState(5.0);
  const [seed, setSeed] = useState("");
  const [startingImage, setStartingImage] = useState<File | null>(null);
  const [faceswapEnabled, setFaceswapEnabled] = useState(false);
  const [faceswapImage, setFaceswapImage] = useState<File | null>(null);
  const [faceswapMethod, setFaceswapMethod] = useState("reactor");
  const [faceswapFacesIndex, setFaceswapFacesIndex] = useState("0");
  const [faceswapFacesOrder, setFaceswapFacesOrder] = useState("left-right");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // LoRA state
  const { loras: loraLibrary, fetchLoras } = useLoraStore();
  const [loras, setLoras] = useState<
    { lora_id: string; name: string; high_weight: number; low_weight: number; preview_image: string | null }[]
  >([]);

  useEffect(() => {
    if (open) fetchLoras();
  }, [open, fetchLoras]);

  const addLoraFromLibrary = (item: LoraListItem | null) => {
    if (!item || loras.length >= 3) return;
    if (loras.some((l) => l.lora_id === item.id)) return;
    setLoras([
      ...loras,
      {
        lora_id: item.id,
        name: item.name,
        high_weight: item.default_high_weight,
        low_weight: item.default_low_weight,
        preview_image: item.preview_image,
      },
    ]);
  };

  const updateLoraWeight = (idx: number, field: string, value: number) => {
    const updated = [...loras];
    updated[idx] = { ...updated[idx], [field]: value };
    setLoras(updated);
  };

  const removeLora = (idx: number) => {
    setLoras(loras.filter((_, i) => i !== idx));
  };

  const resetForm = useCallback(() => {
    setName("");
    setPrompt("");
    setWidth(640);
    setHeight(640);
    setFps(30);
    setDuration(5.0);
    setSeed("");
    setStartingImage(null);
    setFaceswapEnabled(false);
    setFaceswapImage(null);
    setFaceswapMethod("reactor");
    setFaceswapFacesIndex("0");
    setFaceswapFacesOrder("left-right");
    setLoras([]);
    setError("");
  }, []);

  const handleSubmit = async () => {
    if (!name.trim() || !prompt.trim()) {
      setError("Name and prompt are required");
      return;
    }
    if (!startingImage) {
      setError("Starting image is required");
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const jobData: JobCreate = {
        name: name.trim(),
        width,
        height,
        fps,
        seed: seed ? parseInt(seed) : null,
        first_segment: {
          prompt: prompt.trim(),
          duration_seconds: duration,
          loras:
            loras.length > 0
              ? loras.map((l) => ({
                  lora_id: l.lora_id,
                  high_weight: l.high_weight,
                  low_weight: l.low_weight,
                }))
              : null,
          faceswap_enabled: faceswapEnabled,
          faceswap_method: faceswapEnabled ? faceswapMethod : null,
          faceswap_faces_index: faceswapEnabled ? faceswapFacesIndex : null,
          faceswap_faces_order: faceswapEnabled ? faceswapFacesOrder : null,
        },
      };

      const formData = new FormData();
      formData.append("data", JSON.stringify(jobData));
      formData.append("starting_image", startingImage);
      if (faceswapEnabled && faceswapImage) {
        formData.append("faceswap_image", faceswapImage);
      }

      await createJob(formData);
      resetForm();
      onCreated();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to create job",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create New Job</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
            {error}
          </Alert>
        )}
        <TextField
          label="Job Name"
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
          rows={3}
          margin="normal"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
          <TextField
            label="Width"
            type="number"
            value={width}
            onChange={(e) => setWidth(parseInt(e.target.value) || 0)}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Height"
            type="number"
            value={height}
            onChange={(e) => setHeight(parseInt(e.target.value) || 0)}
            sx={{ flex: 1 }}
          />
        </Box>

        <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
          <TextField
            label="FPS"
            select
            value={fps}
            onChange={(e) => setFps(parseInt(e.target.value))}
            sx={{ flex: 1 }}
          >
            <MenuItem value={30}>30 fps</MenuItem>
            <MenuItem value={60}>60 fps</MenuItem>
          </TextField>
          <TextField
            label="Duration (sec)"
            type="number"
            value={duration}
            onChange={(e) => setDuration(parseFloat(e.target.value) || 0)}
            sx={{ flex: 1 }}
            slotProps={{ htmlInput: { step: 0.5, min: 1, max: 10 } }}
          />
          <TextField
            label="Seed (optional)"
            type="number"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            sx={{ flex: 1 }}
          />
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Starting Image *
          </Typography>
          <Button variant="outlined" component="label">
            {startingImage ? startingImage.name : "Choose Image"}
            <input
              type="file"
              hidden
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setStartingImage(file);
                if (file) {
                  const url = URL.createObjectURL(file);
                  const img = new Image();
                  img.onload = () => {
                    setWidth(img.naturalWidth);
                    setHeight(img.naturalHeight);
                    URL.revokeObjectURL(url);
                  };
                  img.onerror = () => URL.revokeObjectURL(url);
                  img.src = url;
                }
              }}
            />
          </Button>
        </Box>

        {/* LoRA section */}
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            LoRAs
          </Typography>
          {loras.length < 3 && (
            <Autocomplete
              options={loraLibrary.filter(
                (l) => !loras.some((s) => s.lora_id === l.id),
              )}
              getOptionLabel={(o) => o.name}
              onChange={(_, val) => {
                addLoraFromLibrary(val);
              }}
              value={null}
              renderOption={(props, option) => (
                <Box
                  component="li"
                  {...props}
                  key={option.id}
                  sx={{ display: "flex", alignItems: "center", gap: 1 }}
                >
                  {option.preview_image ? (
                    <Box
                      component="img"
                      src={getFileUrl(option.preview_image)}
                      alt=""
                      sx={{
                        width: 40,
                        height: 40,
                        objectFit: "cover",
                        borderRadius: 0.5,
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        bgcolor: "#eee",
                        borderRadius: 0.5,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <Box>
                    <Typography variant="body2">{option.name}</Typography>
                    {option.trigger_words && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                      >
                        {option.trigger_words}
                      </Typography>
                    )}
                  </Box>
                </Box>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  placeholder="Search LoRA library..."
                />
              )}
              size="small"
              blurOnSelect
              clearOnBlur
            />
          )}
          {loras.map((lora, idx) => (
            <Card key={lora.lora_id} variant="outlined" sx={{ p: 1.5, mt: 1 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  mb: 1,
                }}
              >
                {lora.preview_image ? (
                  <Box
                    component="img"
                    src={getFileUrl(lora.preview_image)}
                    alt=""
                    sx={{
                      width: 36,
                      height: 36,
                      objectFit: "cover",
                      borderRadius: 0.5,
                    }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: 36,
                      height: 36,
                      bgcolor: "#eee",
                      borderRadius: 0.5,
                    }}
                  />
                )}
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
                  {lora.name}
                </Typography>
                <Button
                  size="small"
                  color="error"
                  onClick={() => removeLora(idx)}
                >
                  Remove
                </Button>
              </Box>
              <Box sx={{ display: "flex", gap: 1 }}>
                <TextField
                  label="High Weight"
                  size="small"
                  type="number"
                  value={lora.high_weight}
                  onChange={(e) =>
                    updateLoraWeight(
                      idx,
                      "high_weight",
                      parseFloat(e.target.value),
                    )
                  }
                  sx={{ width: 120 }}
                  slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
                />
                <TextField
                  label="Low Weight"
                  size="small"
                  type="number"
                  value={lora.low_weight}
                  onChange={(e) =>
                    updateLoraWeight(
                      idx,
                      "low_weight",
                      parseFloat(e.target.value),
                    )
                  }
                  sx={{ width: 120 }}
                  slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
                />
              </Box>
            </Card>
          ))}
        </Box>

        {/* Faceswap section */}
        <Box sx={{ mt: 3 }}>
          <FormControlLabel
            control={
              <Switch
                checked={faceswapEnabled}
                onChange={(e) => setFaceswapEnabled(e.target.checked)}
              />
            }
            label="Enable Faceswap"
          />
          {faceswapEnabled && (
            <Box sx={{ mt: 1 }}>
              <TextField
                label="Method"
                select
                size="small"
                fullWidth
                value={faceswapMethod}
                onChange={(e) => setFaceswapMethod(e.target.value)}
                sx={{ mb: 1 }}
              >
                <MenuItem value="reactor">ReActor</MenuItem>
                <MenuItem value="facefusion">FaceFusion</MenuItem>
              </TextField>
              <Box sx={{ display: "flex", gap: 2, mb: 1 }}>
                <TextField
                  label="Faces Index"
                  size="small"
                  value={faceswapFacesIndex}
                  onChange={(e) => setFaceswapFacesIndex(e.target.value)}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Faces Order"
                  size="small"
                  value={faceswapFacesOrder}
                  onChange={(e) => setFaceswapFacesOrder(e.target.value)}
                  sx={{ flex: 1 }}
                />
              </Box>
              <Button variant="outlined" size="small" component="label">
                {faceswapImage ? faceswapImage.name : "Choose Faceswap Image"}
                <input
                  type="file"
                  hidden
                  accept="image/*"
                  onChange={(e) =>
                    setFaceswapImage(e.target.files?.[0] ?? null)
                  }
                />
              </Button>
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Creating..." : "Create Job"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
