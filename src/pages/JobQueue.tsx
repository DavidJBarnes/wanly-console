import { useEffect, useState, useCallback, useRef } from "react";
import {
  Autocomplete,
  Box,
  Typography,
  Card,
  CardActionArea,
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
  TablePagination,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { Add, DeleteOutline, ClearOutlined, DragIndicator } from "@mui/icons-material";
import { useNavigate } from "react-router";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { useLoraStore } from "../stores/loraStore";
import { createJob, deleteJob, getJobs, getFileUrl, getFaceswapPresets, reorderJobs } from "../api/client";
import type { JobCreate, JobResponse, JobStatus, LoraListItem, FaceswapPreset } from "../api/types";
import StatusChip from "../components/StatusChip";

const ALL_STATUSES: JobStatus[] = [
  "awaiting",
  "failed",
  "processing",
  "pending",
  "paused",
];

const STATUS_PRIORITY: Record<string, number> = {
  awaiting: 0,
  failed: 1,
  processing: 2,
  pending: 3,
  paused: 4,
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

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const result = [...arr];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

export default function JobQueue() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isPriorityMode, setIsPriorityMode] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [deleteConfirm, setDeleteConfirm] = useState<JobResponse | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeJob, setActiveJob] = useState<JobResponse | null>(null);
  const isDraggingRef = useRef(false);

  const fetchPage = useCallback(async () => {
    if (isDraggingRef.current) return;
    try {
      const res = await getJobs({
        limit: isPriorityMode ? 200 : rowsPerPage,
        offset: isPriorityMode ? 0 : page * rowsPerPage,
        status: statusFilter.length > 0 ? statusFilter.join(",") : undefined,
        sort: isPriorityMode ? "priority_asc" : undefined,
      });
      setJobs(res.items);
      setTotal(res.total);
    } catch {
      // silently retry on next interval
    } finally {
      setLoading(false);
    }
  }, [isPriorityMode, page, rowsPerPage, statusFilter]);

  useEffect(() => {
    setLoading(true);
    fetchPage();
    const interval = setInterval(fetchPage, 5000);
    return () => clearInterval(interval);
  }, [fetchPage]);

  // Reset to first page when filter changes
  const handleFilterChange = (newFilter: string[]) => {
    setStatusFilter(newFilter);
    setPage(0);
  };

  const handleSort = (key: SortKey) => {
    if (isPriorityMode) {
      setIsPriorityMode(false);
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
      setPage(0);
    } else if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const handleDragEnd = (event: { canceled: boolean; operation: { source: { id: string | number } | null; target: { id: string | number } | null } }) => {
    isDraggingRef.current = false;
    setActiveJob(null);

    if (event.canceled) return;
    const { source, target } = event.operation;
    if (!source || !target || source.id === target.id) return;

    const fromIndex = jobs.findIndex((j) => j.id === source.id);
    const toIndex = jobs.findIndex((j) => j.id === target.id);
    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = arrayMove(jobs, fromIndex, toIndex);
    const prev = [...jobs];
    setJobs(reordered);

    reorderJobs(reordered.map((j) => j.id)).catch(() => {
      setJobs(prev);
    });
  };

  const handleDeleteJob = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await deleteJob(deleteConfirm.id);
      setDeleteConfirm(null);
      fetchPage();
    } catch {
      // keep dialog open on failure
    } finally {
      setDeleting(false);
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

  const sortedJobs = isPriorityMode ? jobs : [...jobs].sort(comparator);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

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

      <Box sx={{ mb: 3, display: "flex", gap: 2, alignItems: "center" }}>
        <FormControl size="small" sx={{ minWidth: 250 }}>
          <InputLabel>Filter by Status</InputLabel>
          <Select<string[]>
            multiple
            value={statusFilter}
            onChange={(e) => {
              const val = e.target.value;
              handleFilterChange(
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
        {!isPriorityMode && (
          <Button
            size="small"
            onClick={() => {
              setIsPriorityMode(true);
              setPage(0);
            }}
          >
            Reset to priority order
          </Button>
        )}
      </Box>

      {loading && jobs.length === 0 && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      <DragDropProvider
        onDragStart={(event) => {
          isDraggingRef.current = true;
          const job = jobs.find((j) => j.id === event.operation.source?.id);
          setActiveJob(job || null);
        }}
        onDragEnd={handleDragEnd}
      >
      {sortedJobs.length > 0 && !isMobile && (
        <Card>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  {isPriorityMode && <TableCell sx={{ width: 32, px: 0.5 }} />}
                  <TableCell sx={{ width: 60 }}>Image</TableCell>
                  <SortableHeader id="name" label="Name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} isPriorityMode={isPriorityMode} />
                  <SortableHeader id="status" label="Status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} isPriorityMode={isPriorityMode} sx={{ width: 120 }} />
                  <TableCell>Dimensions</TableCell>
                  <SortableHeader id="fps" label="FPS" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} isPriorityMode={isPriorityMode} sx={{ width: 80 }} />
                  <SortableHeader id="created_at" label="Created" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} isPriorityMode={isPriorityMode} sx={{ width: 150 }} />
                  <SortableHeader id="updated_at" label="Updated" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} isPriorityMode={isPriorityMode} sx={{ width: 150 }} />
                  <TableCell sx={{ width: 60 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedJobs.map((job, index) => (
                  <SortableTableRow
                    key={job.id}
                    job={job}
                    index={index}
                    showHandle={isPriorityMode}
                    onNavigate={(id) => navigate(`/jobs/${id}`)}
                    onDelete={setDeleteConfirm}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {!isPriorityMode && (
            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          )}
        </Card>
      )}

      {/* Mobile card layout */}
      {sortedJobs.length > 0 && isMobile && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {sortedJobs.map((job, index) => (
            <SortableMobileCard
              key={job.id}
              job={job}
              index={index}
              showHandle={isPriorityMode}
              onNavigate={(id) => navigate(`/jobs/${id}`)}
              onDelete={setDeleteConfirm}
            />
          ))}
          {!isPriorityMode && (
            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[10, 25, 50]}
            />
          )}
        </Box>
      )}

      <DragOverlay>
        {activeJob && (
          <Card sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center", boxShadow: 4, minWidth: 250 }}>
            <DragIndicator sx={{ color: "text.disabled" }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{activeJob.name}</Typography>
            <StatusChip status={activeJob.status} />
          </Card>
        )}
      </DragOverlay>
      </DragDropProvider>

      {!loading && sortedJobs.length === 0 && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <Typography color="text.secondary">
            {total === 0 && statusFilter.length === 0
              ? "No jobs yet. Create your first one!"
              : "No jobs match the selected filters."}
          </Typography>
        </Box>
      )}

      {/* Delete job confirm dialog */}
      <Dialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Job</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <strong>{deleteConfirm?.name}</strong>? This will permanently
            remove the job, all its segments, videos, and S3 assets. This cannot
            be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDeleteJob}
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <CreateJobDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => {
          setDialogOpen(false);
          fetchPage();
        }}
      />
    </Box>
  );
}

function SortableHeader({
  id,
  label,
  sortKey,
  sortDir,
  onSort,
  isPriorityMode,
  sx,
}: {
  id: SortKey;
  label: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  isPriorityMode: boolean;
  sx?: Record<string, unknown>;
}) {
  return (
    <TableCell sx={sx}>
      <TableSortLabel
        active={!isPriorityMode && sortKey === id}
        direction={!isPriorityMode && sortKey === id ? sortDir : "asc"}
        onClick={() => onSort(id)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );
}

function SortableTableRow({
  job,
  index,
  showHandle,
  onNavigate,
  onDelete,
}: {
  job: JobResponse;
  index: number;
  showHandle: boolean;
  onNavigate: (id: string) => void;
  onDelete: (job: JobResponse) => void;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: job.id,
    index,
    disabled: !showHandle,
  });

  return (
    <TableRow
      ref={ref}
      hover
      sx={{
        cursor: "pointer",
        opacity: isDragging ? 0.4 : 1,
      }}
      onClick={() => onNavigate(job.id)}
    >
      {showHandle && (
        <TableCell sx={{ width: 32, px: 0.5 }}>
          <Box
            ref={handleRef}
            sx={{
              cursor: "grab",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "text.disabled",
              "&:hover": { color: "text.secondary" },
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <DragIndicator fontSize="small" />
          </Box>
        </TableCell>
      )}
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
      <TableCell>
        <Tooltip title="Delete job">
          <IconButton
            size="small"
            color="error"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(job);
            }}
          >
            <DeleteOutline fontSize="small" />
          </IconButton>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

function SortableMobileCard({
  job,
  index,
  showHandle,
  onNavigate,
  onDelete,
}: {
  job: JobResponse;
  index: number;
  showHandle: boolean;
  onNavigate: (id: string) => void;
  onDelete: (job: JobResponse) => void;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: job.id,
    index,
    disabled: !showHandle,
  });

  return (
    <Card
      ref={ref}
      variant="outlined"
      sx={{
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <CardActionArea
        onClick={() => onNavigate(job.id)}
        sx={{ p: 1.5 }}
      >
        <Box sx={{ display: "flex", gap: 1.5 }}>
          {showHandle && (
            <Box
              ref={handleRef}
              sx={{
                display: "flex",
                alignItems: "center",
                cursor: "grab",
                color: "text.disabled",
                flexShrink: 0,
                mr: -0.5,
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <DragIndicator fontSize="small" />
            </Box>
          )}
          {job.starting_image ? (
            <Box
              component="img"
              src={getFileUrl(job.starting_image)}
              alt=""
              sx={{
                width: 56,
                height: 56,
                objectFit: "cover",
                borderRadius: 1,
                bgcolor: "#f5f5f5",
                flexShrink: 0,
              }}
            />
          ) : (
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: 1,
                bgcolor: "#f5f5f5",
                flexShrink: 0,
              }}
            />
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                {job.name}
              </Typography>
              <StatusChip status={job.status} />
            </Box>
            <Typography variant="caption" color="text.secondary">
              {job.width}x{job.height} &middot; {job.fps}fps &middot; {formatDate(job.updated_at)}
            </Typography>
          </Box>
          <IconButton
            size="small"
            color="error"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(job);
            }}
            sx={{ alignSelf: "center", flexShrink: 0 }}
          >
            <DeleteOutline fontSize="small" />
          </IconButton>
        </Box>
      </CardActionArea>
    </Card>
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
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [width, setWidth] = useState(640);
  const [height, setHeight] = useState(640);
  const [fps, setFps] = useState(30);
  const [duration, setDuration] = useState(5.0);
  const [seed, setSeed] = useState("");
  const [startingImage, setStartingImage] = useState<File | null>(null);
  const [faceswapEnabled, setFaceswapEnabled] = useState(false);
  const [faceswapSourceType, setFaceswapSourceType] = useState<"upload" | "preset" | "start_frame">("upload");
  const [faceswapImage, setFaceswapImage] = useState<File | null>(null);
  const [faceswapPresetUri, setFaceswapPresetUri] = useState<string | null>(null);
  const [faceswapPresets, setFaceswapPresets] = useState<FaceswapPreset[]>([]);
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
    if (open) {
      fetchLoras();
      getFaceswapPresets().then(setFaceswapPresets).catch(() => {});
    }
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
    if (item.default_prompt) {
      setPrompt((prev) =>
        prev.trim() ? `${prev.trim()}, ${item.default_prompt}` : item.default_prompt!,
      );
    }
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
    setFaceswapSourceType("upload");
    setFaceswapImage(null);
    setFaceswapPresetUri(null);
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
          faceswap_source_type: faceswapEnabled ? faceswapSourceType : null,
          faceswap_image: faceswapEnabled && faceswapSourceType === "preset" ? faceswapPresetUri : null,
          faceswap_faces_index: faceswapEnabled ? faceswapFacesIndex : null,
          faceswap_faces_order: faceswapEnabled ? faceswapFacesOrder : null,
        },
      };

      const formData = new FormData();
      formData.append("data", JSON.stringify(jobData));
      formData.append("starting_image", startingImage);
      if (faceswapEnabled && faceswapSourceType === "upload" && faceswapImage) {
        formData.append("faceswap_image", faceswapImage);
      }
      if (faceswapEnabled && faceswapSourceType === "start_frame" && startingImage) {
        formData.append("faceswap_image", startingImage);
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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
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
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: -1 }}>
          <IconButton
            size="small"
            onClick={() => setPrompt("")}
            disabled={!prompt}
            sx={{ color: "text.disabled", p: 0.25 }}
            title="Clear prompt"
          >
            <ClearOutlined sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 1 }}>
          <TextField
            label="Width"
            type="number"
            value={width}
            onChange={(e) => setWidth(parseInt(e.target.value) || 0)}
            sx={{ flex: 1, minWidth: 120 }}
          />
          <TextField
            label="Height"
            type="number"
            value={height}
            onChange={(e) => setHeight(parseInt(e.target.value) || 0)}
            sx={{ flex: 1, minWidth: 120 }}
          />
        </Box>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 2 }}>
          <TextField
            label="FPS"
            select
            value={fps}
            onChange={(e) => setFps(parseInt(e.target.value))}
            sx={{ flex: 1, minWidth: 100 }}
          >
            <MenuItem value={30}>30 fps</MenuItem>
            <MenuItem value={60}>60 fps</MenuItem>
          </TextField>
          <TextField
            label="Duration (sec)"
            type="number"
            value={duration}
            onChange={(e) => setDuration(parseFloat(e.target.value) || 0)}
            sx={{ flex: 1, minWidth: 120 }}
            slotProps={{ htmlInput: { step: 0.5, min: 1, max: 10 } }}
          />
          <TextField
            label="Seed (optional)"
            type="number"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            sx={{ flex: 1, minWidth: 120 }}
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
              options={loraLibrary
                .filter((l) => !loras.some((s) => s.lora_id === l.id))
                .sort((a, b) => a.name.localeCompare(b.name))}
              getOptionLabel={(o) => o.name}
              onChange={(_, val) => {
                addLoraFromLibrary(val);
              }}
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
                );
              }}
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
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
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
                  sx={{ flex: 1, minWidth: 100 }}
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
                  sx={{ flex: 1, minWidth: 100 }}
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
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 1 }}>
                <TextField
                  label="Faces Index"
                  size="small"
                  value={faceswapFacesIndex}
                  onChange={(e) => setFaceswapFacesIndex(e.target.value)}
                  sx={{ flex: 1, minWidth: 120 }}
                />
                <TextField
                  label="Faces Order"
                  size="small"
                  value={faceswapFacesOrder}
                  onChange={(e) => setFaceswapFacesOrder(e.target.value)}
                  sx={{ flex: 1, minWidth: 120 }}
                />
              </Box>
              <ToggleButtonGroup
                value={faceswapSourceType}
                exclusive
                onChange={(_e, v) => {
                  if (v === null) return;
                  setFaceswapSourceType(v);
                  if (v !== "upload") setFaceswapImage(null);
                  if (v !== "preset") setFaceswapPresetUri(null);
                }}
                size="small"
                fullWidth
                sx={{ mb: 1 }}
              >
                <ToggleButton value="upload">Upload</ToggleButton>
                <ToggleButton value="preset">Preset</ToggleButton>
                <ToggleButton value="start_frame" disabled={!startingImage}>
                  Start Frame
                </ToggleButton>
              </ToggleButtonGroup>
              {faceswapSourceType === "upload" && (
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
              )}
              {faceswapSourceType === "preset" && (
                <TextField
                  label="Preset Face"
                  select
                  size="small"
                  fullWidth
                  value={faceswapPresetUri ?? ""}
                  onChange={(e) => setFaceswapPresetUri(e.target.value || null)}
                >
                  {faceswapPresets.map((p) => (
                    <MenuItem key={p.key} value={p.url}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box
                          component="img"
                          src={getFileUrl(p.url)}
                          alt={p.name}
                          sx={{
                            width: 32,
                            height: 32,
                            objectFit: "cover",
                            borderRadius: 0.5,
                          }}
                        />
                        <Typography variant="body2">{p.name}</Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </TextField>
              )}
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
