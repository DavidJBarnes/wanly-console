import { useEffect, useState, useCallback } from "react";
import {
  Autocomplete,
  Box,
  Chip,
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
  Tooltip,
} from "@mui/material";
import {
  ArrowBack,
  PlayArrow,
  PlayCircleOutline,
  Close,
  Replay,
  DeleteOutline,
} from "@mui/icons-material";
import { useParams, useNavigate, Link as RouterLink } from "react-router";
import {
  getJob,
  updateJob,
  addSegment,
  uploadFile,
  retrySegment,
  deleteSegment,
  deleteJob,
  getFileUrl,
} from "../api/client";
import { useLoraStore } from "../stores/loraStore";
import type {
  JobDetailResponse,
  SegmentResponse,
  SegmentCreate,
  LoraConfig,
  LoraListItem,
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
  const [videoModal, setVideoModal] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [segmentModalOpen, setSegmentModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<SegmentResponse | null>(
    null,
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteJobConfirm, setDeleteJobConfirm] = useState(false);
  const [deletingJob, setDeletingJob] = useState(false);

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

      {/* Job metadata card */}
      <Card sx={{ mb: 3 }}>
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
              label="Segments"
              value={`${job.completed_segment_count}/${job.segment_count}`}
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
          </Box>
        </Box>
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
              {job.segments.map((seg) => (
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
                          seg.output_path && setVideoModal(seg.output_path)
                        }
                      >
                        <Box
                          component="img"
                          src={getFileUrl(seg.last_frame_path)}
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
                      <LiveTimer since={seg.claimed_at} />
                    ) : (
                      <Typography variant="caption">
                        {segmentRunTime(seg)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", gap: 0.5 }}>
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
                      {(seg.status === "failed" ||
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
              ))}
            </TableBody>
          </Table>
        </TableContainer>
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

      {/* Video modal */}
      <Dialog
        open={!!videoModal}
        onClose={() => setVideoModal(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogContent sx={{ p: 0, position: "relative", bgcolor: "#000" }}>
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
              src={getFileUrl(videoModal)}
              sx={{ width: "100%", display: "block" }}
            />
          )}
        </DialogContent>
      </Dialog>
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
        high_weight: l.high_weight,
        low_weight: l.low_weight,
        preview_image: lib?.preview_image ?? null,
      };
    });
}

function SegmentModal({
  open,
  jobId,
  lastSegment,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  jobId: string;
  lastSegment?: SegmentResponse;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { loras: loraLibrary, fetchLoras } = useLoraStore();
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5.0);
  const [faceswapEnabled, setFaceswapEnabled] = useState(false);
  const [faceswapMethod, setFaceswapMethod] = useState("reactor");
  const [faceswapFile, setFaceswapFile] = useState<File | null>(null);
  const [faceswapFacesIndex, setFaceswapFacesIndex] = useState("0");
  const [faceswapFacesOrder, setFaceswapFacesOrder] = useState("left-right");
  const [loraSlots, setLoraSlots] = useState<LoraSlot[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pre-populate from last segment when modal opens (use template if available)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on open, not on poll refetch
  useEffect(() => {
    if (open && lastSegment) {
      setPrompt(lastSegment.prompt_template ?? lastSegment.prompt);
      setDuration(lastSegment.duration_seconds);
      setFaceswapEnabled(lastSegment.faceswap_enabled);
      setFaceswapMethod(lastSegment.faceswap_method ?? "reactor");
      setFaceswapFile(null);
      setFaceswapFacesIndex(lastSegment.faceswap_faces_index ?? "0");
      setFaceswapFacesOrder(lastSegment.faceswap_faces_order ?? "left-right");
      setError("");
    }
  }, [open]);

  useEffect(() => {
    if (open) fetchLoras();
  }, [open, fetchLoras]);

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
        if (faceswapFile) {
          const result = await uploadFile(faceswapFile, jobId);
          faceswapImageUri = result.path;
        } else {
          faceswapImageUri = lastSegment?.faceswap_image ?? null;
        }
      }

      const body: SegmentCreate = {
        prompt: prompt.trim(),
        duration_seconds: duration,
        faceswap_enabled: faceswapEnabled,
        faceswap_method: faceswapEnabled ? faceswapMethod : null,
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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Next Segment</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
            {error}
          </Alert>
        )}
        <TextField
          label="Prompt"
          fullWidth
          multiline
          rows={3}
          margin="normal"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          autoFocus
        />
        <TextField
          label="Duration (sec)"
          type="number"
          value={duration}
          onChange={(e) => setDuration(parseFloat(e.target.value) || 5)}
          slotProps={{ htmlInput: { step: 0.5, min: 1, max: 10 } }}
          sx={{ mt: 2, width: 150 }}
        />

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
                {faceswapFile
                  ? faceswapFile.name
                  : existingFaceswapName
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
              {faceswapFile && existingFaceswapName && (
                <Button
                  size="small"
                  sx={{ ml: 1 }}
                  onClick={() => setFaceswapFile(null)}
                >
                  Reset to existing
                </Button>
              )}
            </Box>
          )}
        </Box>

        {/* LoRA section */}
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            LoRAs
          </Typography>
          {loraSlots.length < 3 && (
            <Autocomplete
              options={loraLibrary.filter(
                (l) => !loraSlots.some((s) => s.lora_id === l.id),
              )}
              getOptionLabel={(o) => o.name}
              onChange={(_, val) => addLoraFromLibrary(val)}
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
                        width: 32,
                        height: 32,
                        objectFit: "cover",
                        borderRadius: 0.5,
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: 32,
                        height: 32,
                        bgcolor: "#eee",
                        borderRadius: 0.5,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <Typography variant="body2">{option.name}</Typography>
                </Box>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  placeholder="Add LoRA..."
                />
              )}
              size="small"
              blurOnSelect
              clearOnBlur
            />
          )}
          {loraSlots.map((lora, idx) => (
            <Box
              key={lora.lora_id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                mt: 1,
              }}
            >
              <Chip
                label={lora.name}
                onDelete={() => removeLora(idx)}
                size="small"
              />
              <TextField
                label="H"
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
                sx={{ width: 80 }}
                slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
              />
              <TextField
                label="L"
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
                sx={{ width: 80 }}
                slotProps={{ htmlInput: { step: 0.1, min: 0, max: 2 } }}
              />
            </Box>
          ))}
        </Box>
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
