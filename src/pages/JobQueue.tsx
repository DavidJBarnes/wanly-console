import { useEffect, useState, useCallback } from "react";
import {
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
} from "@mui/material";
import { Add } from "@mui/icons-material";
import { useNavigate } from "react-router";
import { useJobStore } from "../stores/jobStore";
import { createJob } from "../api/client";
import type { JobCreate, JobStatus } from "../api/types";
import StatusChip from "../components/StatusChip";

const ALL_STATUSES: JobStatus[] = [
  "awaiting",
  "processing",
  "pending",
  "paused",
  "finalized",
];

const STATUS_PRIORITY: Record<string, number> = {
  awaiting: 0,
  processing: 1,
  pending: 2,
  paused: 3,
  finalized: 4,
};

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

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const filteredJobs = jobs
    .filter((j) => statusFilter.length === 0 || statusFilter.includes(j.status))
    .sort((a, b) => {
      const pa = STATUS_PRIORITY[a.status] ?? 99;
      const pb = STATUS_PRIORITY[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

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
                  <TableCell>Name</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Dimensions</TableCell>
                  <TableCell>FPS</TableCell>
                  <TableCell>Created</TableCell>
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
  const [loras, setLoras] = useState<
    { high_file: string; low_file: string; high_weight: number; low_weight: number }[]
  >([]);

  const addLora = () => {
    if (loras.length >= 3) return;
    setLoras([...loras, { high_file: "", low_file: "", high_weight: 1.0, low_weight: 1.0 }]);
  };

  const updateLora = (idx: number, field: string, value: string | number) => {
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
          loras: loras.length > 0 ? loras : null,
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
              onChange={(e) => setStartingImage(e.target.files?.[0] ?? null)}
            />
          </Button>
        </Box>

        {/* LoRA section */}
        <Box sx={{ mt: 3 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Typography variant="subtitle2">LoRAs</Typography>
            <Button
              size="small"
              onClick={addLora}
              disabled={loras.length >= 3}
            >
              Add LoRA
            </Button>
          </Box>
          {loras.map((lora, idx) => (
            <Card key={idx} variant="outlined" sx={{ p: 1.5, mt: 1 }}>
              <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
                <TextField
                  label="High UNET file"
                  size="small"
                  value={lora.high_file}
                  onChange={(e) =>
                    updateLora(idx, "high_file", e.target.value)
                  }
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Weight"
                  size="small"
                  type="number"
                  value={lora.high_weight}
                  onChange={(e) =>
                    updateLora(idx, "high_weight", parseFloat(e.target.value))
                  }
                  sx={{ width: 80 }}
                  slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
                />
              </Box>
              <Box sx={{ display: "flex", gap: 1 }}>
                <TextField
                  label="Low UNET file"
                  size="small"
                  value={lora.low_file}
                  onChange={(e) =>
                    updateLora(idx, "low_file", e.target.value)
                  }
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Weight"
                  size="small"
                  type="number"
                  value={lora.low_weight}
                  onChange={(e) =>
                    updateLora(idx, "low_weight", parseFloat(e.target.value))
                  }
                  sx={{ width: 80 }}
                  slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
                />
              </Box>
              <Button
                size="small"
                color="error"
                onClick={() => removeLora(idx)}
                sx={{ mt: 0.5 }}
              >
                Remove
              </Button>
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
