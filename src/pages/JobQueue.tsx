import { useEffect, useState, useCallback, useRef } from "react";
import {
  Box,
  Typography,
  Card,
  CardActionArea,
  Button,
  Chip,
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
  MenuItem,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { Add, DragIndicator } from "@mui/icons-material";
import { useNavigate } from "react-router";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { useSortable, isSortable } from "@dnd-kit/react/sortable";
import { getJobs, getFileUrl, reorderJobs } from "../api/client";
import type { JobResponse, JobStatus } from "../api/types";
import StatusChip from "../components/StatusChip";
import CreateJobDialog from "../components/CreateJobDialog";

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

