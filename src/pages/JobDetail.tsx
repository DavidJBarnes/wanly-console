import { useEffect, useState, useCallback, useRef } from "react";
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Autocomplete,
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  TextField,
  MenuItem,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Popover,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  ArrowBack,
  PlayArrow,
  PlayCircleOutline,
  Close,
  Replay,
  DeleteOutline,
  ClearOutlined,
  InfoOutlined,
  StopCircle,
  Download,
  AutoAwesome,
  ExpandMore,
  Visibility,
} from "@mui/icons-material";
import { useParams, useNavigate, Link as RouterLink } from "react-router";
import {
  getJob,
  updateJob,
  addSegment,
  uploadFile,
  retrySegment,
  cancelSegment,
  deleteSegment,
  deleteJob,
  reopenJob,
  getFileUrl,
  getFaceswapPresets,
  updateSegmentTransition,
  updateSegmentTrim,
  getSegmentFrames,
} from "../api/client";
import { usePromptGenerator } from "../hooks/usePromptGenerator";
import { useLoraStore } from "../stores/loraStore";
import { usePromptPresetStore } from "../stores/promptPresetStore";
import type {
  JobDetailResponse,
  SegmentResponse,
  SegmentCreate,
  LoraConfig,
  LoraListItem,
  FaceswapPreset,
  PromptPreset,
  FramePreviewResponse,
} from "../api/types";
import StatusChip from "../components/StatusChip";

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function segmentRunTime(seg: SegmentResponse): string {
  if (!seg.claimed_at || !seg.completed_at) return "-";
  const ms =
    new Date(seg.completed_at).getTime() - new Date(seg.claimed_at).getTime();
  return formatDuration(ms / 1000);
}

function LiveTimer({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState(() =>
    Math.floor((Date.now() - new Date(since).getTime()) / 1000),
  );
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(since).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [since]);
  return (
    <Typography variant="caption" sx={{ color: "warning.main", fontWeight: 600 }}>
      {formatDuration(elapsed)}
    </Typography>
  );
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [videoModal, setVideoModal] = useState<{ path: string; v?: string; segIndex?: number } | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [segmentModalOpen, setSegmentModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<SegmentResponse | null>(
    null,
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteJobConfirm, setDeleteJobConfirm] = useState(false);
  const [deletingJob, setDeletingJob] = useState(false);
  const [detailSeg, setDetailSeg] = useState<SegmentResponse | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reopenConfirm, setReopenConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [trimValues, setTrimValues] = useState<Record<string, { start: number; end: number }>>({});
  const trimTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [framePreview, setFramePreview] = useState<{
    anchorEl: HTMLElement | null;
    segId: string;
    position: "start" | "end";
    loading: boolean;
    data: FramePreviewResponse | null;
    trimStart: number;
    trimEnd: number;
  } | null>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const fetchJob = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getJob(id);
      setJob(data);
      setError("");
    } catch {
      setError("Failed to load job");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchJob();
    const interval = setInterval(fetchJob, 5000);
    return () => clearInterval(interval);
  }, [fetchJob]);

  const handleFinalize = async () => {
    if (!id) return;
    setFinalizing(true);
    try {
      await updateJob(id, { status: "finalized" });
      fetchJob();
    } catch {
      setError("Failed to finalize job");
    } finally {
      setFinalizing(false);
    }
  };

  const handleReopen = async () => {
    if (!id) return;
    setReopenConfirm(false);
    setReopening(true);
    try {
      const data = await reopenJob(id);
      setJob(data);
      setError("");
    } catch {
      setError("Failed to re-open job");
    } finally {
      setReopening(false);
    }
  };

  const handleArchive = async () => {
    if (!id) return;
    setArchiving(true);
    try {
      await updateJob(id, { status: "archived" });
      fetchJob();
    } catch {
      setError("Failed to archive job");
    } finally {
      setArchiving(false);
    }
  };

  const handleUnarchive = async () => {
    if (!id) return;
    setArchiving(true);
    try {
      await updateJob(id, { status: "awaiting" });
      fetchJob();
    } catch {
      setError("Failed to unarchive job");
    } finally {
      setArchiving(false);
    }
  };

  const handleRetry = async (seg: SegmentResponse) => {
    setActionLoading(seg.id);
    try {
      await retrySegment(seg.id);
      fetchJob();
    } catch {
      setError("Failed to retry segment");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (seg: SegmentResponse) => {
    setActionLoading(seg.id);
    try {
      await cancelSegment(seg.id);
      fetchJob();
    } catch {
      setError("Failed to cancel segment");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (seg: SegmentResponse) => {
    setDeleteConfirm(null);
    setActionLoading(seg.id);
    try {
      await deleteSegment(seg.id);
      fetchJob();
    } catch {
      setError("Failed to delete segment");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteJob = async () => {
    if (!id) return;
    setDeletingJob(true);
    try {
      await deleteJob(id);
      navigate("/jobs");
    } catch {
      setError("Failed to delete job");
      setDeletingJob(false);
      setDeleteJobConfirm(false);
    }
  };

  // Initialize trim values from job data when job loads
  useEffect(() => {
    if (!job) return;
    const newTrimValues: Record<string, { start: number; end: number }> = {};
    for (const seg of job.segments) {
      newTrimValues[seg.id] = {
        start: seg.trim_start_frames,
        end: seg.trim_end_frames,
      };
    }
    setTrimValues(newTrimValues);
  }, [job]);

  const handleTrimChange = (segId: string, field: "start" | "end", value: number) => {
    setTrimValues((prev) => ({
      ...prev,
      [segId]: { ...prev[segId], [field]: value },
    }));
    // Debounce save
    if (trimTimers.current[segId + field]) {
      clearTimeout(trimTimers.current[segId + field]);
    }
    trimTimers.current[segId + field] = setTimeout(async () => {
      const vals = { ...trimValues[segId], [field]: value };
      try {
        await updateSegmentTrim(segId, vals.start, vals.end);
        fetchJob();
      } catch {
        setError("Failed to update trim");
      }
    }, 500);
  };

  const openFramePreview = async (
    anchorEl: HTMLElement,
    segId: string,
    position: "start" | "end",
    trimStart: number,
    trimEnd: number,
  ) => {
    setFramePreview({ anchorEl, segId, position, loading: true, data: null, trimStart, trimEnd });
    try {
      const trimValue = position === "start" ? trimStart : trimEnd;
      const data = await getSegmentFrames(segId, position, 5, trimValue);
      setFramePreview((prev) => prev && prev.segId === segId && prev.position === position
        ? { ...prev, loading: false, data }
        : prev);
    } catch {
      setFramePreview(null);
      setError("Failed to load frame preview");
    }
  };

  if (loading) {
    return (
      <Box sx={{ textAlign: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && !job) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        {error}
      </Alert>
    );
  }

  if (!job) return null;

  const lastSegment = job.segments[job.segments.length - 1];
  const canAddSegment =
    job.status === "awaiting" &&
    !job.segments.some((s) =>
      ["pending", "claimed", "processing"].includes(s.status),
    );

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        <IconButton onClick={() => navigate("/jobs")}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h4" sx={{ flex: 1 }}>
          {job.name}
        </Typography>
        <Tooltip title="Delete job">
          <IconButton
            color="error"
            onClick={() => setDeleteJobConfirm(true)}
            disabled={deletingJob}
          >
            {deletingJob ? <CircularProgress size={20} /> : <DeleteOutline />}
          </IconButton>
        </Tooltip>
        <StatusChip status={job.status} />
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {job.status === "failed" && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Segment failed — retry or delete it to continue.
        </Alert>
      )}

      {/* Job metadata + finalized video */}
      <Box sx={{ display: "flex", gap: 3, mb: 3, flexWrap: { xs: "wrap", md: "nowrap" } }}>
        <Card sx={{ flex: 1, minWidth: 0 }}>
          <CardContent>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" },
                gap: 2,
              }}
            >
              <MetaItem label="Dimensions" value={`${job.width}x${job.height}`} />
              <MetaItem label="FPS" value={`${job.fps}`} />
              <MetaItem label="Seed" value={`${job.seed}`} />
              <MetaItem
                label="LightX2V High"
                value={`${job.lightx2v_strength_high ?? 2.0}`}
              />
              <MetaItem
                label="LightX2V Low"
                value={`${job.lightx2v_strength_low ?? 1.0}`}
              />
              <MetaItem
                label="CFG High"
                value={`${job.cfg_high ?? 1}`}
              />
              <MetaItem
                label="CFG Low"
                value={`${job.cfg_low ?? 1}`}
              />
              <MetaItem
                label="Segments"
                value={`${job.completed_segment_count}`}
              />
              <MetaItem
                label="Total Run Time"
                value={formatDuration(job.total_run_time)}
              />
              <MetaItem
                label="Total Video Time"
                value={formatDuration(job.total_video_time)}
              />
              <MetaItem label="Created" value={formatDate(job.created_at)} />
              <MetaItem label="Updated" value={formatDate(job.updated_at)} />
            </Box>
          </CardContent>
        </Card>
        {(() => {
          const finalVideo = job.videos?.find((v) => v.status === "completed" && v.output_path);
          if (!finalVideo?.output_path) return null;
          return (
            <Card sx={{ width: { xs: "100%", md: 400 }, flexShrink: 0 }}>
              <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Finalized Video</Typography>
                <Box
                  component="video"
                  src={getFileUrl(finalVideo.output_path, finalVideo.completed_at ?? undefined)}
                  controls
                  sx={{ width: "100%", borderRadius: 1, display: "block" }}
                />
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {finalVideo.duration_seconds != null ? formatDuration(finalVideo.duration_seconds) : ""}
                  </Typography>
                  <IconButton
                    size="small"
                    component="a"
                    href={getFileUrl(finalVideo.output_path, finalVideo.completed_at ?? undefined)}
                    download
                    target="_blank"
                  >
                    <Download fontSize="small" />
                  </IconButton>
                </Box>
              </CardContent>
            </Card>
          );
        })()}
      </Box>

      {/* Segments table */}
      <Card sx={{ mb: 3 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1.5,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography variant="h6">Segments</Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {(job.status === "processing" || job.status === "pending") && (
              <>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  {job.status === "processing"
                    ? "Processing segment..."
                    : "Waiting for worker..."}
                </Typography>
              </>
            )}
            {job.status === "finalizing" && (
              <>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  Finalizing...
                </Typography>
              </>
            )}
            {canAddSegment && (
              <Button
                variant="contained"
                size="small"
                startIcon={<PlayArrow />}
                onClick={() => setSegmentModalOpen(true)}
              >
                Next Segment
              </Button>
            )}
            {job.status === "awaiting" && (
              <Button
                variant="contained"
                color="secondary"
                size="small"
                onClick={handleFinalize}
                disabled={finalizing}
                startIcon={
                  finalizing ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : undefined
                }
              >
                {finalizing ? "Finalizing..." : "Finalize & Merge"}
              </Button>
            )}
            {job.status === "finalized" && (
              <Button
                variant="outlined"
                color="warning"
                size="small"
                onClick={() => setReopenConfirm(true)}
                disabled={reopening}
                startIcon={
                  reopening ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <Replay />
                  )
                }
              >
                {reopening ? "Re-opening..." : "Re-open Job"}
              </Button>
            )}
            {["awaiting", "failed", "paused"].includes(job.status) && (
              <Button
                variant="outlined"
                size="small"
                onClick={handleArchive}
                disabled={archiving}
                sx={{ color: "#616161", borderColor: "#bdbdbd" }}
              >
                {archiving ? "Archiving..." : "Archive"}
              </Button>
            )}
            {job.status === "archived" && (
              <Button
                variant="outlined"
                size="small"
                onClick={handleUnarchive}
                disabled={archiving}
                sx={{ color: "#616161", borderColor: "#bdbdbd" }}
              >
                {archiving ? "Unarchiving..." : "Unarchive"}
              </Button>
            )}
          </Box>
        </Box>
        {/* Desktop table */}
        {!isMobile && (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 60 }}>#</TableCell>
                  <TableCell sx={{ width: 120 }}>Start Image</TableCell>
                  <TableCell>Prompt</TableCell>
                  <TableCell sx={{ width: 120 }}>Output</TableCell>
                  <TableCell sx={{ width: 80 }}>Swapped</TableCell>
                  <TableCell sx={{ width: 100 }}>Status</TableCell>
                  <TableCell sx={{ width: 120 }}>Worker</TableCell>
                  <TableCell sx={{ width: 140 }}>Created</TableCell>
                  <TableCell sx={{ width: 80 }}>Run Time</TableCell>
                  <TableCell sx={{ width: 80 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {job.segments.flatMap((seg) => {
                  const rows = [
                  <TableRow key={seg.id}>
                    <TableCell>{seg.index}</TableCell>
                    <TableCell>
                      {(() => {
                        const img =
                          seg.start_image ??
                          (seg.index === 0
                            ? job.starting_image
                            : job.segments[seg.index - 1]?.last_frame_path) ??
                          null;
                        return img ? (
                          <Box
                            component="img"
                            src={getFileUrl(img)}
                            alt="Start"
                            sx={{
                              width: 80,
                              height: 80,
                              objectFit: "cover",
                              borderRadius: 1,
                              bgcolor: "#f5f5f5",
                              display: "block",
                            }}
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            -
                          </Typography>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{ whiteSpace: "pre-wrap" }}
                      >
                        {seg.prompt_template ?? seg.prompt}
                      </Typography>
                      {seg.prompt_template && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block", mt: 0.5, fontStyle: "italic" }}
                        >
                          Resolved: {seg.prompt}
                        </Typography>
                      )}
                      {seg.error_message && (
                        <Alert severity="error" sx={{ mt: 1 }}>
                          {seg.error_message}
                        </Alert>
                      )}
                    </TableCell>
                    <TableCell>
                      {seg.status === "completed" && seg.last_frame_path ? (
                        <Box
                          sx={{ position: "relative", cursor: "pointer" }}
                          onClick={() =>
                            seg.output_path && setVideoModal({ path: seg.output_path, v: seg.completed_at ?? undefined, segIndex: seg.index })
                          }
                        >
                          <Box
                            component="img"
                            src={getFileUrl(seg.last_frame_path, seg.completed_at ?? undefined)}
                            alt="Last frame"
                            sx={{
                              width: 80,
                              height: 80,
                              objectFit: "cover",
                              borderRadius: 1,
                              bgcolor: "#f5f5f5",
                              display: "block",
                            }}
                          />
                          {seg.output_path && (
                            <PlayCircleOutline
                              sx={{
                                position: "absolute",
                                top: "50%",
                                left: "50%",
                                transform: "translate(-50%, -50%)",
                                fontSize: 32,
                                color: "white",
                                filter:
                                  "drop-shadow(0 1px 2px rgba(0,0,0,0.5))",
                              }}
                            />
                          )}
                        </Box>
                      ) : seg.status === "pending" ||
                        seg.status === "claimed" ||
                        seg.status === "processing" ? (
                        <CircularProgress size={24} />
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          -
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {seg.faceswap_enabled && seg.faceswap_image ? (
                        <Box
                          component="img"
                          src={getFileUrl(seg.faceswap_image)}
                          alt="Faceswap"
                          sx={{
                            width: 40,
                            height: 40,
                            objectFit: "cover",
                            borderRadius: 1,
                            bgcolor: "#f5f5f5",
                            display: "block",
                          }}
                        />
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          -
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={seg.status} />
                    </TableCell>
                    <TableCell>
                      {seg.worker_id ? (
                        <Typography
                          variant="caption"
                          component={RouterLink}
                          to={`/workers/${seg.worker_id}`}
                          sx={{
                            color: "primary.main",
                            textDecoration: "none",
                            "&:hover": { textDecoration: "underline" },
                          }}
                        >
                          {seg.worker_name ?? seg.worker_id.slice(0, 8)}
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          -
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {formatDate(seg.created_at)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {(seg.status === "claimed" || seg.status === "processing") && seg.claimed_at ? (
                        <Box>
                          <LiveTimer since={seg.claimed_at} />
                          {seg.estimated_run_time != null && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              ~{formatDuration(seg.estimated_run_time)}
                            </Typography>
                          )}
                        </Box>
                      ) : seg.status === "pending" && seg.estimated_run_time != null ? (
                        <Typography variant="caption" color="text.secondary">
                          ~{formatDuration(seg.estimated_run_time)}
                        </Typography>
                      ) : (
                        <Typography variant="caption">
                          {segmentRunTime(seg)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Tooltip title="Details">
                          <IconButton
                            size="small"
                            onClick={() => setDetailSeg(seg)}
                          >
                            <InfoOutlined fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {(seg.status === "pending" || seg.status === "claimed" || seg.status === "processing") && (
                          <Tooltip title="Cancel">
                            <IconButton
                              size="small"
                              color="warning"
                              onClick={() => handleCancel(seg)}
                              disabled={actionLoading === seg.id}
                            >
                              {actionLoading === seg.id ? (
                                <CircularProgress size={18} />
                              ) : (
                                <StopCircle fontSize="small" />
                              )}
                            </IconButton>
                          </Tooltip>
                        )}
                        {seg.status === "failed" && (
                          <Tooltip title="Retry">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => handleRetry(seg)}
                              disabled={actionLoading === seg.id}
                            >
                              {actionLoading === seg.id ? (
                                <CircularProgress size={18} />
                              ) : (
                                <Replay fontSize="small" />
                              )}
                            </IconButton>
                          </Tooltip>
                        )}
                        {job.status !== "finalized" &&
                          (seg.status === "failed" ||
                            seg.status === "completed") &&
                          job.segments.length > 1 && (
                            <Tooltip title="Delete">
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => setDeleteConfirm(seg)}
                                disabled={actionLoading === seg.id}
                              >
                                <DeleteOutline fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                      </Box>
                    </TableCell>
                  </TableRow>
                  ];
                  rows.push(
                    <TableRow key={`transition-${seg.id}`} sx={{ bgcolor: "action.hover" }}>
                      <TableCell colSpan={10} sx={{ py: 0.5 }}>
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">Trim #{seg.index} Start:</Typography>
                            <TextField
                              type="number"
                              size="small"
                              value={trimValues[seg.id]?.start ?? 0}
                              onChange={(e) => handleTrimChange(seg.id, "start", Math.max(0, parseInt(e.target.value) || 0))}
                              variant="standard"
                              slotProps={{ htmlInput: { min: 0, style: { width: 50, textAlign: "center", fontSize: 13 } } }}
                            />
                            <IconButton
                              size="small"
                              onClick={(e) => openFramePreview(e.currentTarget, seg.id, "start", trimValues[seg.id]?.start ?? 0, trimValues[seg.id]?.end ?? 0)}
                              disabled={!seg.output_path}
                            >
                              <Visibility sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">Transition:</Typography>
                            <TextField
                              select
                              size="small"
                              value={seg.transition ?? "none"}
                              onChange={async (e) => {
                                const val = e.target.value === "none" ? null : e.target.value;
                                try {
                                  await updateSegmentTransition(seg.id, val);
                                  fetchJob();
                                } catch {
                                  setError("Failed to update transition");
                                }
                              }}
                              variant="standard"
                              sx={{ minWidth: 120, "& .MuiInput-input": { fontSize: 13, py: 0 } }}
                            >
                              <MenuItem value="none">None</MenuItem>
                              <MenuItem value="fade">Fade (black)</MenuItem>
                              <MenuItem value="flash">Flash (black)</MenuItem>
                            </TextField>
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">Trim #{seg.index} End:</Typography>
                            <TextField
                              type="number"
                              size="small"
                              value={trimValues[seg.id]?.end ?? 0}
                              onChange={(e) => handleTrimChange(seg.id, "end", Math.max(0, parseInt(e.target.value) || 0))}
                              variant="standard"
                              slotProps={{ htmlInput: { min: 0, style: { width: 50, textAlign: "center", fontSize: 13 } } }}
                            />
                            <IconButton
                              size="small"
                              onClick={(e) => openFramePreview(e.currentTarget, seg.id, "end", trimValues[seg.id]?.start ?? 0, trimValues[seg.id]?.end ?? 0)}
                              disabled={!seg.output_path}
                            >
                              <Visibility sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Box>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                  return rows;
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Mobile card layout */}
        {isMobile && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, p: 1.5 }}>
            {job.segments.flatMap((seg) => {
              const startImg =
                seg.start_image ??
                (seg.index === 0
                  ? job.starting_image
                  : job.segments[seg.index - 1]?.last_frame_path) ??
                null;
              const card = (
                <Card key={seg.id} variant="outlined">
                  <Box sx={{ p: 1.5 }}>
                    {/* Header row: index, status, actions */}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        #{seg.index}
                      </Typography>
                      <StatusChip status={seg.status} />
                      <Box sx={{ ml: "auto", display: "flex", gap: 0.5 }}>
                        {(seg.status === "claimed" || seg.status === "processing") && seg.claimed_at && (
                          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                            <LiveTimer since={seg.claimed_at} />
                            {seg.estimated_run_time != null && (
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>
                                ~{formatDuration(seg.estimated_run_time)}
                              </Typography>
                            )}
                          </Box>
                        )}
                        {seg.status === "pending" && seg.estimated_run_time != null && (
                          <Typography variant="caption" color="text.secondary">
                            ~{formatDuration(seg.estimated_run_time)}
                          </Typography>
                        )}
                        {seg.status !== "claimed" && seg.status !== "processing" && seg.status !== "pending" && segmentRunTime(seg) !== "-" && (
                          <Typography variant="caption" color="text.secondary">
                            {segmentRunTime(seg)}
                          </Typography>
                        )}
                        <IconButton
                          size="small"
                          onClick={() => setDetailSeg(seg)}
                        >
                          <InfoOutlined fontSize="small" />
                        </IconButton>
                        {(seg.status === "pending" || seg.status === "claimed" || seg.status === "processing") && (
                          <IconButton
                            size="small"
                            color="warning"
                            onClick={() => handleCancel(seg)}
                            disabled={actionLoading === seg.id}
                          >
                            {actionLoading === seg.id ? (
                              <CircularProgress size={18} />
                            ) : (
                              <StopCircle fontSize="small" />
                            )}
                          </IconButton>
                        )}
                        {seg.status === "failed" && (
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => handleRetry(seg)}
                            disabled={actionLoading === seg.id}
                          >
                            {actionLoading === seg.id ? (
                              <CircularProgress size={18} />
                            ) : (
                              <Replay fontSize="small" />
                            )}
                          </IconButton>
                        )}
                        {job.status !== "finalized" &&
                          (seg.status === "failed" || seg.status === "completed") &&
                          job.segments.length > 1 && (
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => setDeleteConfirm(seg)}
                              disabled={actionLoading === seg.id}
                            >
                              <DeleteOutline fontSize="small" />
                            </IconButton>
                          )}
                      </Box>
                    </Box>

                    {/* Thumbnails row */}
                    <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
                      {startImg ? (
                        <Box
                          component="img"
                          src={getFileUrl(startImg)}
                          alt="Start"
                          sx={{
                            width: 64,
                            height: 64,
                            objectFit: "cover",
                            borderRadius: 1,
                            bgcolor: "#f5f5f5",
                          }}
                        />
                      ) : (
                        <Box
                          sx={{
                            width: 64,
                            height: 64,
                            borderRadius: 1,
                            bgcolor: "#f5f5f5",
                          }}
                        />
                      )}
                      {seg.status === "completed" && seg.last_frame_path ? (
                        <Box
                          sx={{ position: "relative", cursor: "pointer" }}
                          onClick={() =>
                            seg.output_path && setVideoModal({ path: seg.output_path, v: seg.completed_at ?? undefined, segIndex: seg.index })
                          }
                        >
                          <Box
                            component="img"
                            src={getFileUrl(seg.last_frame_path, seg.completed_at ?? undefined)}
                            alt="Output"
                            sx={{
                              width: 64,
                              height: 64,
                              objectFit: "cover",
                              borderRadius: 1,
                              bgcolor: "#f5f5f5",
                            }}
                          />
                          {seg.output_path && (
                            <PlayCircleOutline
                              sx={{
                                position: "absolute",
                                top: "50%",
                                left: "50%",
                                transform: "translate(-50%, -50%)",
                                fontSize: 28,
                                color: "white",
                                filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))",
                              }}
                            />
                          )}
                        </Box>
                      ) : (seg.status === "pending" || seg.status === "claimed" || seg.status === "processing") ? (
                        <Box sx={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <CircularProgress size={24} />
                        </Box>
                      ) : null}
                      {seg.faceswap_enabled && seg.faceswap_image && (
                        <Box
                          component="img"
                          src={getFileUrl(seg.faceswap_image)}
                          alt="Faceswap"
                          sx={{
                            width: 64,
                            height: 64,
                            objectFit: "cover",
                            borderRadius: 1,
                            bgcolor: "#f5f5f5",
                          }}
                        />
                      )}
                    </Box>

                    {/* Prompt */}
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: 0.5 }}>
                      {seg.prompt_template ?? seg.prompt}
                    </Typography>
                    {seg.prompt_template && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic", display: "block" }}>
                        Resolved: {seg.prompt}
                      </Typography>
                    )}
                    {seg.error_message && (
                      <Alert severity="error" sx={{ mt: 1 }}>
                        {seg.error_message}
                      </Alert>
                    )}

                    {/* Meta line */}
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                      {seg.worker_id
                        ? seg.worker_name ?? seg.worker_id.slice(0, 8)
                        : "No worker"}{" "}
                      &middot; {formatDate(seg.created_at)}
                    </Typography>
                  </Box>
                </Card>
              );
              const items = [card];
              items.push(
                <Box key={`transition-${seg.id}`} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 1, py: 0.5 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">Trim Start:</Typography>
                    <TextField
                      type="number"
                      size="small"
                      value={trimValues[seg.id]?.start ?? 0}
                      onChange={(e) => handleTrimChange(seg.id, "start", Math.max(0, parseInt(e.target.value) || 0))}
                      variant="standard"
                      slotProps={{ htmlInput: { min: 0, style: { width: 50, textAlign: "center", fontSize: 13 } } }}
                    />
                    <IconButton
                      size="small"
                      onClick={(e) => openFramePreview(e.currentTarget, seg.id, "start", trimValues[seg.id]?.start ?? 0, trimValues[seg.id]?.end ?? 0)}
                      disabled={!seg.output_path}
                    >
                      <Visibility sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">Transition:</Typography>
                    <TextField
                      select
                      size="small"
                      value={seg.transition ?? "none"}
                      onChange={async (e) => {
                        const val = e.target.value === "none" ? null : e.target.value;
                        try {
                          await updateSegmentTransition(seg.id, val);
                          fetchJob();
                        } catch {
                          setError("Failed to update transition");
                        }
                      }}
                      variant="standard"
                      sx={{ minWidth: 120, "& .MuiInput-input": { fontSize: 13, py: 0 } }}
                    >
                      <MenuItem value="none">None</MenuItem>
                      <MenuItem value="fade">Fade (black)</MenuItem>
                      <MenuItem value="flash">Flash (black)</MenuItem>
                    </TextField>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">Trim End:</Typography>
                    <TextField
                      type="number"
                      size="small"
                      value={trimValues[seg.id]?.end ?? 0}
                      onChange={(e) => handleTrimChange(seg.id, "end", Math.max(0, parseInt(e.target.value) || 0))}
                      variant="standard"
                      slotProps={{ htmlInput: { min: 0, style: { width: 50, textAlign: "center", fontSize: 13 } } }}
                    />
                    <IconButton
                      size="small"
                      onClick={(e) => openFramePreview(e.currentTarget, seg.id, "end", trimValues[seg.id]?.start ?? 0, trimValues[seg.id]?.end ?? 0)}
                      disabled={!seg.output_path}
                    >
                      <Visibility sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                </Box>
              );
              return items;
            })}
          </Box>
        )}
      </Card>

      {/* Progress log */}
      {(() => {
        const activeSeg = job.segments.find(
          (s) => s.status === "processing" || s.status === "claimed",
        );
        const failedSeg = !activeSeg
          ? [...job.segments].reverse().find((s) => s.status === "failed")
          : undefined;
        const logSeg = activeSeg ?? failedSeg;
        if (!logSeg?.progress_log) return null;
        const isActive =
          logSeg.status === "processing" || logSeg.status === "claimed";
        return (
          <Card sx={{ mb: 3 }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 2,
                py: 1.5,
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              <Typography variant="subtitle2" sx={{ flex: 1 }}>
                {isActive ? "Progress" : "Last Run Log"}
              </Typography>
              <StatusChip status={logSeg.status} />
            </Box>
            <Box
              sx={{
                bgcolor: "#1e1e2e",
                color: "#cdd6f4",
                fontFamily: "monospace",
                fontSize: 13,
                p: 2,
                maxHeight: 300,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                lineHeight: 1.6,
              }}
            >
              {logSeg.progress_log}
            </Box>
          </Card>
        );
      })()}

      {/* Segment modal */}
      <SegmentModal
        open={segmentModalOpen}
        jobId={job.id}
        job={job}
        lastSegment={lastSegment}
        onClose={() => setSegmentModalOpen(false)}
        onSubmitted={() => {
          setSegmentModalOpen(false);
          fetchJob();
        }}
      />

      {/* Delete confirm dialog */}
      <Dialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Segment</DialogTitle>
        <DialogContent>
          <Typography>
            Delete segment #{deleteConfirm?.index}? This will remove the segment
            and its S3 assets. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete job confirm dialog */}
      <Dialog
        open={deleteJobConfirm}
        onClose={() => setDeleteJobConfirm(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Job</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <strong>{job.name}</strong>? This will permanently remove the
            job, all its segments, videos, and S3 assets. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteJobConfirm(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDeleteJob}
            disabled={deletingJob}
          >
            {deletingJob ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Re-open job confirm dialog */}
      <Dialog
        open={reopenConfirm}
        onClose={() => setReopenConfirm(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Re-open Job</DialogTitle>
        <DialogContent>
          <Typography>
            Re-open <strong>{job.name}</strong>? This will delete the finalized
            video and return the job to &ldquo;awaiting&rdquo; status. All
            segments will be preserved.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReopenConfirm(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleReopen}
            disabled={reopening}
          >
            {reopening ? "Re-opening..." : "Re-open"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Video modal */}
      <Dialog
        open={!!videoModal}
        onClose={() => setVideoModal(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogContent sx={{ p: 0, position: "relative", bgcolor: "#000" }}>
          <IconButton
            onClick={() => {
              if (!videoModal || !job) return;
              const url = getFileUrl(videoModal.path, videoModal.v);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${job.name}_segment${videoModal.segIndex ?? 0}.mp4`;
              a.click();
            }}
            sx={{
              position: "absolute",
              top: 8,
              right: 48,
              color: "white",
              zIndex: 1,
            }}
          >
            <Download />
          </IconButton>
          <IconButton
            onClick={() => setVideoModal(null)}
            sx={{
              position: "absolute",
              top: 8,
              right: 8,
              color: "white",
              zIndex: 1,
            }}
          >
            <Close />
          </IconButton>
          {videoModal && (
            <Box
              component="video"
              controls
              autoPlay
              src={getFileUrl(videoModal.path, videoModal.v)}
              sx={{ width: "100%", maxHeight: "80vh", objectFit: "contain", display: "block" }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Segment detail modal */}
      <SegmentDetailModal
        seg={detailSeg}
        job={job}
        onClose={() => setDetailSeg(null)}
      />

      {/* Frame preview popover */}
      <Popover
        open={!!framePreview}
        anchorEl={framePreview?.anchorEl}
        onClose={() => setFramePreview(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Box sx={{ p: 1.5, minWidth: 200 }}>
          {framePreview?.loading && (
            <Box sx={{ textAlign: "center", py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {framePreview?.data && (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
                {framePreview.data.total_frames} frames @ {framePreview.data.fps.toFixed(1)} fps
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5 }}>
                {framePreview.data.frames.map((f) => {
                  const isTrimmed = framePreview.position === "start"
                    ? f.frame_index < framePreview.trimStart
                    : f.frame_index >= framePreview.data!.total_frames - framePreview.trimEnd;
                  return (
                    <Box key={f.frame_index} sx={{ position: "relative", textAlign: "center" }}>
                      <Box
                        component="img"
                        src={f.data_url}
                        sx={{ width: 80, height: "auto", display: "block", borderRadius: 0.5 }}
                      />
                      {isTrimmed && (
                        <Box
                          sx={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            bgcolor: "rgba(244,67,54,0.4)",
                            borderRadius: 0.5,
                          }}
                        />
                      )}
                      <Typography variant="caption" sx={{ fontSize: 10 }}>{f.frame_index}</Typography>
                    </Box>
                  );
                })}
              </Box>
            </>
          )}
        </Box>
      </Popover>
    </Box>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 500 }}>
        {value}
      </Typography>
    </Box>
  );
}

function SegmentDetailModal({
  seg,
  job,
  onClose,
}: {
  seg: SegmentResponse | null;
  job: JobDetailResponse;
  onClose: () => void;
}) {
  const { loras: loraLibrary } = useLoraStore();

  if (!seg) return null;

  const startImage =
    seg.start_image ??
    (seg.index === 0
      ? job.starting_image
      : job.segments[seg.index - 1]?.last_frame_path) ??
    null;

  const loraNames = (seg.loras ?? []).map((l) => {
    const lib = loraLibrary.find((item) => item.id === l.lora_id);
    return {
      name: lib?.name ?? l.lora_id?.slice(0, 8) ?? "unknown",
      high_weight: l.high_weight,
      low_weight: l.low_weight,
    };
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Segment #{seg.index} Details</DialogTitle>
      <DialogContent dividers>
        {/* Prompt */}
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Prompt
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: 2 }}>
          {seg.prompt_template ?? seg.prompt}
        </Typography>
        {seg.prompt_template && (
          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic", display: "block", mb: 2, mt: -1 }}>
            Resolved: {seg.prompt}
          </Typography>
        )}

        {/* Duration / Speed */}
        <Box sx={{ display: "flex", gap: 4, mb: 2 }}>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">Duration</Typography>
            <Typography variant="body2">{seg.duration_seconds}s</Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">Speed</Typography>
            <Typography variant="body2">{seg.speed}x</Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">Status</Typography>
            <StatusChip status={seg.status} />
          </Box>
          {seg.worker_name && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Worker</Typography>
              <Typography variant="body2">{seg.worker_name}</Typography>
            </Box>
          )}
        </Box>

        {/* Thumbnails */}
        <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
          {startImage && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>Start Image</Typography>
              <Box
                component="img"
                src={getFileUrl(startImage)}
                alt="Start"
                sx={{ width: 100, height: 100, objectFit: "cover", borderRadius: 1, bgcolor: "#f5f5f5", display: "block" }}
              />
            </Box>
          )}
          {seg.last_frame_path && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>Output</Typography>
              <Box
                component="img"
                src={getFileUrl(seg.last_frame_path, seg.completed_at ?? undefined)}
                alt="Output"
                sx={{ width: 100, height: 100, objectFit: "cover", borderRadius: 1, bgcolor: "#f5f5f5", display: "block" }}
              />
            </Box>
          )}
        </Box>

        {/* LoRAs */}
        {loraNames.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>LoRAs</Typography>
            {loraNames.map((l, i) => (
              <Typography key={i} variant="body2">
                {l.name} (H: {l.high_weight}, L: {l.low_weight})
              </Typography>
            ))}
          </Box>
        )}

        {/* Faceswap */}
        {seg.faceswap_enabled && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>Faceswap</Typography>
            <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
              {seg.faceswap_image && (
                <Box
                  component="img"
                  src={getFileUrl(seg.faceswap_image)}
                  alt="Faceswap"
                  sx={{ width: 48, height: 48, objectFit: "cover", borderRadius: 1, bgcolor: "#f5f5f5" }}
                />
              )}
              <Box>
                <Typography variant="body2">Method: {seg.faceswap_method ?? "-"}</Typography>
                <Typography variant="body2">Source: {seg.faceswap_source_type ?? "-"}</Typography>
                {seg.faceswap_faces_index && (
                  <Typography variant="body2">Faces: {seg.faceswap_faces_index} ({seg.faceswap_faces_order})</Typography>
                )}
              </Box>
            </Box>
          </Box>
        )}

        {/* Timing */}
        <Box sx={{ display: "flex", gap: 4, mb: 2 }}>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">Created</Typography>
            <Typography variant="body2">{formatDate(seg.created_at)}</Typography>
          </Box>
          {seg.claimed_at && seg.completed_at && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Run Time</Typography>
              <Typography variant="body2">{segmentRunTime(seg)}</Typography>
            </Box>
          )}
        </Box>

        {/* Error */}
        {seg.error_message && (
          <Alert severity="error">{seg.error_message}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

interface LoraSlot {
  lora_id: string;
  name: string;
  high_weight: number;
  low_weight: number;
  preview_image: string | null;
}

function lorasToSlots(
  loras: LoraConfig[] | null | undefined,
  library: LoraListItem[],
): LoraSlot[] {
  if (!loras) return [];
  return loras
    .filter((l) => l.lora_id)
    .map((l) => {
      const lib = library.find((item) => item.id === l.lora_id);
      return {
        lora_id: l.lora_id!,
        name: lib?.name ?? l.lora_id!.slice(0, 8),
        high_weight: lib?.high_file ? l.high_weight : 0,
        low_weight: lib?.low_file ? l.low_weight : 0,
        preview_image: lib?.preview_image ?? null,
      };
    });
}

function SegmentModal({
  open,
  jobId,
  job,
  lastSegment,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  jobId: string;
  job: JobDetailResponse;
  lastSegment?: SegmentResponse;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const { loras: loraLibrary, fetchLoras } = useLoraStore();
  const { presets: promptPresets, fetchPresets } = usePromptPresetStore();
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5.0);
  const [speed, setSpeed] = useState(1.0);
  const [faceswapEnabled, setFaceswapEnabled] = useState(false);
  const [faceswapSourceType, setFaceswapSourceType] = useState<"upload" | "preset" | "start_frame">("upload");
  const [faceswapMethod, setFaceswapMethod] = useState("reactor");
  const [faceswapFile, setFaceswapFile] = useState<File | null>(null);
  const [faceswapPresetUri, setFaceswapPresetUri] = useState<string | null>(null);
  const [faceswapPresets, setFaceswapPresets] = useState<FaceswapPreset[]>([]);
  const [faceswapFacesIndex, setFaceswapFacesIndex] = useState("0");
  const [faceswapFacesOrder, setFaceswapFacesOrder] = useState("left-right");
  const [loraSlots, setLoraSlots] = useState<LoraSlot[]>([]);
  const [startImageMode, setStartImageMode] = useState<"auto" | "select" | "upload">("auto");
  const [startImagePath, setStartImagePath] = useState<string | null>(null);
  const [startImageFile, setStartImageFile] = useState<File | null>(null);
  const [startImageError, setStartImageError] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Prompt generation
  const { promptPrefix, setPromptPrefix, generating, genError, setGenError, generate } = usePromptGenerator();

  const accordionSx = { "&:before": { display: "none" }, boxShadow: "none", border: "1px solid", borderColor: "divider", borderRadius: "8px !important", mb: 1 };

  const applyPreset = (preset: PromptPreset | null) => {
    if (!preset) return;
    setPrompt(preset.prompt);
    if (preset.loras && preset.loras.length > 0) {
      setLoraSlots(
        preset.loras.map((l) => {
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
      setLoraSlots([]);
    }
  };

  // Pre-populate from last segment when modal opens (use template if available)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on open, not on poll refetch
  useEffect(() => {
    if (open && lastSegment) {
      setPrompt(lastSegment.prompt_template ?? lastSegment.prompt);
      setDuration(lastSegment.duration_seconds);
      setSpeed(lastSegment.speed);
      setFaceswapEnabled(lastSegment.faceswap_enabled);
      const srcType = lastSegment.faceswap_source_type === "preset"
        ? "preset"
        : lastSegment.faceswap_source_type === "start_frame"
          ? "start_frame"
          : "upload";
      setFaceswapSourceType(srcType);
      setFaceswapMethod(lastSegment.faceswap_method ?? "reactor");
      setFaceswapFile(null);
      setFaceswapPresetUri(srcType === "preset" ? lastSegment.faceswap_image ?? null : null);
      setFaceswapFacesIndex(lastSegment.faceswap_faces_index ?? "0");
      setFaceswapFacesOrder(lastSegment.faceswap_faces_order ?? "left-right");
      setStartImageMode("auto");
      setStartImagePath(null);
      setStartImageFile(null);
      setStartImageError("");
      setError("");
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      fetchLoras();
      fetchPresets();
      getFaceswapPresets().then(setFaceswapPresets).catch(() => {});
    }
  }, [open, fetchLoras, fetchPresets]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on open + library load
  useEffect(() => {
    if (open && loraLibrary.length > 0 && lastSegment?.loras) {
      setLoraSlots(lorasToSlots(lastSegment.loras, loraLibrary));
    }
  }, [open, loraLibrary]);

  const addLoraFromLibrary = (item: LoraListItem | null) => {
    if (!item || loraSlots.length >= 3) return;
    if (loraSlots.some((l) => l.lora_id === item.id)) return;
    setLoraSlots([
      ...loraSlots,
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
    const updated = [...loraSlots];
    updated[idx] = { ...updated[idx], [field]: value };
    setLoraSlots(updated);
  };

  const removeLora = (idx: number) => {
    setLoraSlots(loraSlots.filter((_, i) => i !== idx));
  };

  // Display name for existing faceswap image
  const existingFaceswapName = lastSegment?.faceswap_image
    ? lastSegment.faceswap_image.split("/").pop() ?? "existing image"
    : null;

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      setError("Prompt is required");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      let faceswapImageUri: string | null = null;
      if (faceswapEnabled) {
        if (faceswapSourceType === "preset") {
          faceswapImageUri = faceswapPresetUri;
        } else if (faceswapSourceType === "start_frame") {
          // Use the effective start image for the next segment
          faceswapImageUri = lastSegment?.last_frame_path ?? job.starting_image ?? null;
        } else if (faceswapFile) {
          const result = await uploadFile(faceswapFile, jobId);
          faceswapImageUri = result.path;
        } else {
          faceswapImageUri = lastSegment?.faceswap_image ?? null;
        }
      }

      let startImageUri: string | null = null;
      if (startImageMode === "select") {
        startImageUri = startImagePath;
      } else if (startImageMode === "upload" && startImageFile) {
        const uploaded = await uploadFile(startImageFile, jobId);
        startImageUri = uploaded.path;
      }

      const body: SegmentCreate = {
        prompt: prompt.trim(),
        duration_seconds: duration,
        speed,
        start_image: startImageUri,
        faceswap_enabled: faceswapEnabled,
        faceswap_method: faceswapEnabled ? faceswapMethod : null,
        faceswap_source_type: faceswapEnabled ? faceswapSourceType : null,
        faceswap_image: faceswapImageUri,
        faceswap_faces_index: faceswapEnabled ? faceswapFacesIndex : null,
        faceswap_faces_order: faceswapEnabled ? faceswapFacesOrder : null,
        loras:
          loraSlots.length > 0
            ? loraSlots.map((l) => ({
                lora_id: l.lora_id,
                high_weight: l.high_weight,
                low_weight: l.low_weight,
              }))
            : null,
      };
      await addSegment(jobId, body);
      onSubmitted();
    } catch {
      setError("Failed to add segment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle>Next Segment</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
            {error}
          </Alert>
        )}

        {/* ── Start Image (top, matching CreateJobDialog) ── */}
        <Box sx={{ mt: 1, mb: 1 }}>
          {(() => {
            const autoImage = lastSegment?.last_frame_path ?? job.starting_image ?? null;
            const effectiveImage =
              startImageMode === "select" ? startImagePath :
              startImageMode === "upload" && startImageFile ? URL.createObjectURL(startImageFile) :
              autoImage;
            const isObjectUrl = startImageMode === "upload" && startImageFile;
            const selectableImages: { path: string; label: string }[] = [];
            const seen = new Set<string>();
            if (job.starting_image) {
              seen.add(job.starting_image);
              selectableImages.push({ path: job.starting_image, label: "Starting Image" });
            }
            for (const seg of job.segments) {
              if (seg.status === "completed" && seg.last_frame_path && !seen.has(seg.last_frame_path)) {
                seen.add(seg.last_frame_path);
                selectableImages.push({ path: seg.last_frame_path, label: `Seg ${seg.index} output` });
              }
            }
            return (
              <>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
                  {effectiveImage && (
                    <Box
                      component="img"
                      src={isObjectUrl ? effectiveImage : getFileUrl(effectiveImage!)}
                      alt="Start image preview"
                      sx={{
                        height: 64,
                        borderRadius: 1,
                        objectFit: "cover",
                      }}
                    />
                  )}
                  <ToggleButtonGroup
                    value={startImageMode}
                    exclusive
                    onChange={(_e, v) => {
                      if (v === null) return;
                      setStartImageMode(v);
                      if (v !== "select") setStartImagePath(null);
                      if (v !== "upload") {
                        setStartImageFile(null);
                        setStartImageError("");
                      }
                    }}
                    size="small"
                  >
                    <ToggleButton value="auto">Auto</ToggleButton>
                    <ToggleButton value="select">Select</ToggleButton>
                    <ToggleButton value="upload">Upload</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                {startImageMode === "select" && (
                  <Box
                    sx={{
                      display: "flex",
                      gap: 1,
                      overflowX: "auto",
                      py: 1,
                      "&::-webkit-scrollbar": { height: 6 },
                      "&::-webkit-scrollbar-thumb": { bgcolor: "action.disabled", borderRadius: 3 },
                    }}
                  >
                    {selectableImages.map((img) => (
                      <Tooltip key={img.path} title={img.label} arrow>
                        <Box
                          component="img"
                          src={getFileUrl(img.path)}
                          alt={img.label}
                          onClick={() => setStartImagePath(img.path)}
                          sx={{
                            width: 64,
                            height: 64,
                            objectFit: "cover",
                            borderRadius: 0.5,
                            cursor: "pointer",
                            flexShrink: 0,
                            border: "2px solid",
                            borderColor: startImagePath === img.path ? "primary.main" : "transparent",
                            "&:hover": { borderColor: startImagePath === img.path ? "primary.main" : "action.hover" },
                          }}
                        />
                      </Tooltip>
                    ))}
                    {selectableImages.length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        No images available
                      </Typography>
                    )}
                  </Box>
                )}
                {startImageMode === "upload" && (
                  <Box sx={{ mt: 1 }}>
                    <Button variant="outlined" size="small" component="label">
                      {startImageFile ? startImageFile.name : "Choose Image"}
                      <input
                        type="file"
                        hidden
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const img = new Image();
                          img.onload = () => {
                            if (img.naturalWidth !== job.width || img.naturalHeight !== job.height) {
                              setStartImageError(
                                `Image must be ${job.width}x${job.height} (got ${img.naturalWidth}x${img.naturalHeight})`
                              );
                              setStartImageFile(null);
                            } else {
                              setStartImageError("");
                              setStartImageFile(file);
                            }
                            URL.revokeObjectURL(img.src);
                          };
                          img.src = URL.createObjectURL(file);
                          e.target.value = "";
                        }}
                      />
                    </Button>
                    {startImageError && (
                      <Alert severity="error" sx={{ mt: 1 }}>
                        {startImageError}
                      </Alert>
                    )}
                  </Box>
                )}
              </>
            );
          })()}
        </Box>

        {/* ── Prompt ── */}
        {promptPresets.length > 0 && (
          <Autocomplete
            options={promptPresets}
            getOptionLabel={(o) => o.name}
            onChange={(_, val) => applyPreset(val)}
            value={null}
            renderInput={(params) => (
              <TextField {...params} label="Load Preset" size="small" margin="dense" />
            )}
            size="small"
            blurOnSelect
            clearOnBlur
          />
        )}
        <TextField
          label="Prompt Prefix"
          fullWidth
          size="small"
          margin="dense"
          value={promptPrefix}
          onChange={(e) => setPromptPrefix(e.target.value)}
          placeholder="e.g. a woman in a red dress"
        />
        <TextField
          label="Prompt"
          fullWidth
          multiline
          rows={3}
          margin="dense"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          autoFocus
        />
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: -0.5 }}>
          <Button
            size="small"
            startIcon={generating ? <CircularProgress size={14} /> : <AutoAwesome sx={{ fontSize: 14 }} />}
            disabled={generating}
            onClick={() => {
              const autoImage = lastSegment?.last_frame_path ?? job.starting_image ?? null;
              if (startImageMode === "upload" && startImageFile) {
                generate({ imageFile: startImageFile }, (p) => setPrompt(p));
              } else if (startImageMode === "select" && startImagePath) {
                generate({ imageS3Uri: startImagePath }, (p) => setPrompt(p));
              } else if (autoImage) {
                generate({ imageS3Uri: autoImage }, (p) => setPrompt(p));
              }
            }}
            sx={{ textTransform: "none", fontSize: 12 }}
          >
            {generating ? "Generating..." : "Auto-generate"}
          </Button>
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
        {genError && (
          <Alert severity="error" sx={{ mt: 0.5, mb: 0.5 }} onClose={() => setGenError("")}>
            {genError}
          </Alert>
        )}

        {/* ── Video Settings (accordion) ── */}
        <Accordion defaultExpanded={false} disableGutters sx={accordionSx}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="subtitle2">
              Video Settings
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {duration}s / {speed}x
              </Typography>
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
              <TextField
                label="Duration"
                type="number"
                size="small"
                value={duration}
                onChange={(e) => setDuration(parseFloat(e.target.value) || 5)}
                sx={{ flex: 1, minWidth: 80 }}
                slotProps={{ htmlInput: { step: 0.5, min: 1, max: 10 } }}
              />
              <TextField
                label="Speed"
                select
                size="small"
                value={speed}
                onChange={(e) => setSpeed(parseFloat(e.target.value))}
                sx={{ flex: 1, minWidth: 80 }}
              >
                <MenuItem value={1.0}>1.0x</MenuItem>
                <MenuItem value={1.25}>1.25x</MenuItem>
                <MenuItem value={1.5}>1.5x</MenuItem>
                <MenuItem value={2.0}>2.0x</MenuItem>
              </TextField>
            </Box>
          </AccordionDetails>
        </Accordion>

        {/* ── LoRAs (accordion) ── */}
        <Accordion defaultExpanded={false} disableGutters sx={accordionSx}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="subtitle2">
              LoRAs
              {loraSlots.length > 0 && (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  {loraSlots.map((l) => l.name).join(", ")}
                </Typography>
              )}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            {loraSlots.length < 3 && (
              <Autocomplete
                options={loraLibrary
                  .filter((l) => !loraSlots.some((s) => s.lora_id === l.id))
                  .sort((a, b) => a.name.localeCompare(b.name))}
                getOptionLabel={(o) => o.name}
                onChange={(_, val) => addLoraFromLibrary(val)}
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
            {loraSlots.map((lora, idx) => (
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
          </AccordionDetails>
        </Accordion>

        {/* ── Faceswap (accordion) ── */}
        <Accordion defaultExpanded={false} disableGutters sx={accordionSx}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="subtitle2">
              Faceswap
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {faceswapEnabled ? `ON — ${faceswapMethod}` : "OFF"}
              </Typography>
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
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
                    select
                    value={faceswapFacesOrder}
                    onChange={(e) => setFaceswapFacesOrder(e.target.value)}
                    sx={{ flex: 1, minWidth: 120 }}
                  >
                    <MenuItem value="left-right">Left → Right</MenuItem>
                    <MenuItem value="right-left">Right → Left</MenuItem>
                    <MenuItem value="top-bottom">Top → Bottom</MenuItem>
                    <MenuItem value="bottom-top">Bottom → Top</MenuItem>
                    <MenuItem value="large-small">Large → Small</MenuItem>
                    <MenuItem value="small-large">Small → Large</MenuItem>
                  </TextField>
                </Box>
                <ToggleButtonGroup
                  value={faceswapSourceType}
                  exclusive
                  onChange={(_e, v) => {
                    if (v === null) return;
                    setFaceswapSourceType(v);
                    if (v !== "upload") setFaceswapFile(null);
                    if (v !== "preset") setFaceswapPresetUri(null);
                  }}
                  size="small"
                  fullWidth
                  sx={{ mb: 1 }}
                >
                  <ToggleButton value="upload">Upload</ToggleButton>
                  <ToggleButton value="preset">Preset</ToggleButton>
                  <ToggleButton value="start_frame">Start Frame</ToggleButton>
                </ToggleButtonGroup>
                {faceswapSourceType === "upload" && (
                  <>
                    <Button variant="outlined" size="small" component="label">
                      {faceswapFile
                        ? faceswapFile.name
                        : existingFaceswapName && lastSegment?.faceswap_source_type !== "preset"
                          ? `Re-using: ${existingFaceswapName}`
                          : "Choose Faceswap Image"}
                      <input
                        type="file"
                        hidden
                        accept="image/*"
                        onChange={(e) =>
                          setFaceswapFile(e.target.files?.[0] ?? null)
                        }
                      />
                    </Button>
                    {faceswapFile && existingFaceswapName && lastSegment?.faceswap_source_type !== "preset" && (
                      <Button
                        size="small"
                        sx={{ ml: 1 }}
                        onClick={() => setFaceswapFile(null)}
                      >
                        Reset to existing
                      </Button>
                    )}
                  </>
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
          </AccordionDetails>
        </Accordion>

      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Submitting..." : "Submit"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
