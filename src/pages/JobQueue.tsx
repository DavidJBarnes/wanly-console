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
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { Add, ClearOutlined, DragIndicator } from "@mui/icons-material";
import { useNavigate } from "react-router";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { useSortable, isSortable } from "@dnd-kit/react/sortable";
import { useLoraStore } from "../stores/loraStore";
import { useTagStore } from "../stores/tagStore";
import { createJob, getJobs, getFileUrl, getFaceswapPresets, reorderJobs } from "../api/client";
import type { JobCreate, JobResponse, JobStatus, LoraListItem, FaceswapPreset } from "../api/types";
import StatusChip from "../components/StatusChip";

const ALL_STATUSES: JobStatus[] = [
  "awaiting",
  "failed",
  "processing",
  "pending",
  "paused",
  "archived",
];

const STATUS_PRIORITY: Record<string, number> = {
  failed: 0,
  awaiting: 1,
  processing: 2,
  pending: 3,
  paused: 4,
  archived: 5,
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

const DRAG_LOCKED_STATUSES = new Set(["failed", "awaiting", "processing", "finalizing", "completed", "archived"]);

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
  const [activeJob, setActiveJob] = useState<JobResponse | null>(null);
  const isDraggingRef = useRef(false);
  const sortedJobsRef = useRef<JobResponse[]>([]);

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

  // In @dnd-kit/react, the OptimisticSortingPlugin reorders the DOM during drag,
  // so source and target in onDragEnd are always the same item.
  // Use source.sortable.initialIndex / .index instead (per dnd-kit#1664).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDragEnd = (event: { canceled: boolean; operation: { source: any } }) => {
    setActiveJob(null);

    if (event.canceled) {
      isDraggingRef.current = false;
      return;
    }

    const { source } = event.operation;
    if (!source || !isSortable(source)) {
      isDraggingRef.current = false;
      return;
    }

    const fromIndex = source.sortable.initialIndex;
    let toIndex = source.sortable.index;

    // Prevent pending jobs from being dragged above non-pending jobs
    const displayed = sortedJobsRef.current;
    const firstPendingIndex = displayed.findIndex((j) => j.status === "pending");
    if (firstPendingIndex >= 0 && toIndex < firstPendingIndex) {
      toIndex = firstPendingIndex;
    }

    if (fromIndex === toIndex) {
      isDraggingRef.current = false;
      return;
    }

    const reordered = arrayMove(displayed, fromIndex, toIndex);
    const prev = [...jobs];
    setJobs(reordered);

    const allIds = reordered.map((j) => j.id);
    reorderJobs(allIds)
      .catch(() => setJobs(prev))
      .finally(() => { isDraggingRef.current = false; });
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

  const sortedJobs = isPriorityMode
    ? [...jobs].sort((a, b) => {
        // Group by status first (failed → awaiting → processing → pending → paused)
        const sa = STATUS_PRIORITY[a.status] ?? 99;
        const sb = STATUS_PRIORITY[b.status] ?? 99;
        if (sa !== sb) return sa - sb;
        // Within same status group, keep API priority order
        return 0;
      })
    : [...jobs].sort(comparator);
  sortedJobsRef.current = sortedJobs;

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
                  <TableCell sx={{ width: 80 }}>Segments</TableCell>
                  <TableCell>Dimensions</TableCell>
                  <SortableHeader id="fps" label="FPS" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} isPriorityMode={isPriorityMode} sx={{ width: 80 }} />
                  <SortableHeader id="created_at" label="Created" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} isPriorityMode={isPriorityMode} sx={{ width: 150 }} />
                  <SortableHeader id="updated_at" label="Updated" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} isPriorityMode={isPriorityMode} sx={{ width: 150 }} />
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
}: {
  job: JobResponse;
  index: number;
  showHandle: boolean;
  onNavigate: (id: string) => void;
}) {
  const isLocked = DRAG_LOCKED_STATUSES.has(job.status);
  const { ref, handleRef, isDragging } = useSortable({
    id: job.id,
    index,
    disabled: !showHandle || isLocked,
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
          {isLocked ? (
            <Box sx={{ width: 24, height: 24 }} />
          ) : (
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
          )}
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
        <Typography variant="body2">
          {job.completed_segment_count}/{job.segment_count}
        </Typography>
      </TableCell>
      <TableCell>
        {job.width}x{job.height}
      </TableCell>
      <TableCell>{job.fps}</TableCell>
      <TableCell>{formatDate(job.created_at)}</TableCell>
      <TableCell>{formatDate(job.updated_at)}</TableCell>
    </TableRow>
  );
}

function SortableMobileCard({
  job,
  index,
  showHandle,
  onNavigate,
}: {
  job: JobResponse;
  index: number;
  showHandle: boolean;
  onNavigate: (id: string) => void;
}) {
  const isLocked = DRAG_LOCKED_STATUSES.has(job.status);
  const { ref, handleRef, isDragging } = useSortable({
    id: job.id,
    index,
    disabled: !showHandle || isLocked,
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
          {showHandle && !isLocked && (
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
              {job.width}x{job.height} &middot; {job.fps}fps &middot; {job.completed_segment_count}/{job.segment_count} segs &middot; {formatDate(job.updated_at)}
            </Typography>
          </Box>
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
  const [speed, setSpeed] = useState(1.0);
  const [seed, setSeed] = useState("");
  const [lightx2vHigh, setLightx2vHigh] = useState("2.0");
  const [lightx2vLow, setLightx2vLow] = useState("1.0");
  const [startingImage, setStartingImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
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

  // Tag state
  const { titleTags1, titleTags2, fetchTags } = useTagStore();
  const [selectedTag1, setSelectedTag1] = useState("");
  const [selectedTag2, setSelectedTag2] = useState("");
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);

  // Auto-generate name from tags + fps
  useEffect(() => {
    if (nameManuallyEdited) return;
    const parts = [selectedTag1, selectedTag2, `${fps}fps`].filter(Boolean);
    if (selectedTag1 || selectedTag2) {
      setName(parts.join("_"));
    }
  }, [selectedTag1, selectedTag2, fps, nameManuallyEdited]);

  // LoRA state
  const { loras: loraLibrary, fetchLoras } = useLoraStore();
  const [loras, setLoras] = useState<
    { lora_id: string; name: string; high_weight: number; low_weight: number; preview_image: string | null }[]
  >([]);

  useEffect(() => {
    if (open) {
      fetchLoras();
      fetchTags();
      getFaceswapPresets().then(setFaceswapPresets).catch(() => {});
    }
  }, [open, fetchLoras, fetchTags]);

  const addLoraFromLibrary = (item: LoraListItem | null) => {
    if (!item || loras.length >= 3) return;
    if (loras.some((l) => l.lora_id === item.id)) return;
    setLoras([
      ...loras,
      {
        lora_id: item.id,
        name: item.name,
        high_weight: item.high_file ? item.default_high_weight : 0,
        low_weight: item.low_file ? item.default_low_weight : 0,
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
    setSpeed(1.0);
    setSeed("");
    setLightx2vHigh("2.0");
    setLightx2vLow("1.0");
    setStartingImage(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setFaceswapEnabled(false);
    setFaceswapSourceType("upload");
    setFaceswapImage(null);
    setFaceswapPresetUri(null);
    setFaceswapMethod("reactor");
    setFaceswapFacesIndex("0");
    setFaceswapFacesOrder("left-right");
    setLoras([]);
    setSelectedTag1("");
    setSelectedTag2("");
    setNameManuallyEdited(false);
    setError("");
  }, [imagePreview]);

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
        lightx2v_strength_high: lightx2vHigh && parseFloat(lightx2vHigh) !== 2.0 ? parseFloat(lightx2vHigh) : null,
        lightx2v_strength_low: lightx2vLow && parseFloat(lightx2vLow) !== 1.0 ? parseFloat(lightx2vLow) : null,
        first_segment: {
          prompt: prompt.trim(),
          duration_seconds: duration,
          speed,
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
        {(titleTags1.length > 0 || titleTags2.length > 0) && (
          <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
            {titleTags1.length > 0 && (
              <TextField
                label="Title Tag 1"
                select
                value={selectedTag1}
                onChange={(e) => {
                  setSelectedTag1(e.target.value);
                  setNameManuallyEdited(false);
                }}
                sx={{ flex: 1 }}
                size="small"
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {titleTags1.map((tag) => (
                  <MenuItem key={tag.id} value={tag.name}>
                    {tag.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {titleTags2.length > 0 && (
              <TextField
                label="Title Tag 2"
                select
                value={selectedTag2}
                onChange={(e) => {
                  setSelectedTag2(e.target.value);
                  setNameManuallyEdited(false);
                }}
                sx={{ flex: 1 }}
                size="small"
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {titleTags2.map((tag) => (
                  <MenuItem key={tag.id} value={tag.name}>
                    {tag.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Box>
        )}
        <TextField
          label="Job Name"
          fullWidth
          margin="normal"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameManuallyEdited(true);
          }}
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
            label="Speed"
            select
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            sx={{ flex: 1, minWidth: 100 }}
          >
            <MenuItem value={1.0}>1.0x</MenuItem>
            <MenuItem value={1.25}>1.25x</MenuItem>
            <MenuItem value={1.5}>1.5x</MenuItem>
            <MenuItem value={2.0}>2.0x</MenuItem>
          </TextField>
          <TextField
            label="Seed (optional)"
            type="number"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            sx={{ flex: 1, minWidth: 120 }}
          />
        </Box>

        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 2 }}>
          <TextField
            label="LightX2V High"
            type="number"
            value={lightx2vHigh}
            onChange={(e) => setLightx2vHigh(e.target.value)}
            sx={{ flex: 1, minWidth: 120 }}
            slotProps={{ htmlInput: { step: 0.1, min: 0 } }}
            helperText="Range: 1.0–5.6"
          />
          <TextField
            label="LightX2V Low"
            type="number"
            value={lightx2vLow}
            onChange={(e) => setLightx2vLow(e.target.value)}
            sx={{ flex: 1, minWidth: 120 }}
            slotProps={{ htmlInput: { step: 0.1, min: 0 } }}
            helperText="Range: 1.0–2.0"
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
                if (imagePreview) URL.revokeObjectURL(imagePreview);
                if (file) {
                  const url = URL.createObjectURL(file);
                  setImagePreview(url);
                  const img = new window.Image();
                  img.onload = () => {
                    setWidth(img.naturalWidth);
                    setHeight(img.naturalHeight);
                  };
                  img.src = url;
                } else {
                  setImagePreview(null);
                }
              }}
            />
          </Button>
          {imagePreview && (
            <Box component="img" src={imagePreview} alt="Starting image preview" sx={{ mt: 1, maxHeight: 120, borderRadius: 1, objectFit: "cover", display: "block" }} />
          )}
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
                  disabled={!loraLibrary.find((l) => l.id === lora.lora_id)?.high_file}
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
                  disabled={!loraLibrary.find((l) => l.id === lora.lora_id)?.low_file}
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
