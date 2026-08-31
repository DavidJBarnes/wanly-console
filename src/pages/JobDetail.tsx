import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import {
  Box,
  Chip,
  Typography,
  Card,
  CardContent,
  Button,
  TextField,
  MenuItem,
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
  Popover,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  ArrowBack,
  PlayCircleOutline,
  Close,
  Replay,
  Casino,
  StopCircle,
  DeleteOutline,
  RemoveCircleOutline,
  Download,
  ExpandMore,
  ExpandLess,
  Repeat,
  Visibility,
  ChevronLeft,
  ChevronRight,
  ViewInAr,
  RateReview,
  RateReviewOutlined,
} from "@mui/icons-material";
import { useParams, useNavigate, Link as RouterLink } from "react-router";
import {
  getJob,
  updateJob,
  retrySegment,
  rerollJobSeed,
  cancelSegment,
  deleteSegment,
  makeHologram,
  deleteJob,
  reopenJob,
  getFileUrl,
  updateSegmentTransition,
  updateSegmentTrim,
  getSegmentFrames,
} from "../api/client";
import { apiError } from "../lib/apiError";
import { useSettingsStore } from "../stores/settingsStore";
import type {
  JobDetailResponse,
  SegmentResponse,
  FramePreviewResponse,
} from "../api/types";
import StatusChip from "../components/StatusChip";
import SegmentObservationDialog from "../components/SegmentObservationDialog";
import { discardSegment } from "../api/client";
import SegmentPromptPopover from "../components/SegmentPromptPopover";
import { canRerollSeed } from "../lib/rerollEligibility";
import { allArchivedTakes, groupTakes, takeSeed } from "../lib/segmentTakes";
import { useGoBack } from "../hooks/useGoBack";
import HologramConfig from "../components/HologramConfig";
import { QRCodeCanvas } from "qrcode.react";
import {
  POLL_INTERVAL_FAST,
} from "../constants";

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

const BRANCH_COLORS = [
  "#e53935", "#1e88e5", "#43a047", "#fb8c00",
  "#8e24aa", "#00acc1", "#f4511e", "#3949ab",
];

interface BranchGroup {
  filename: string;
  color: string;
  firstIndex: number;
  lastIndex: number;
}

function resolveSegmentStartImage(
  seg: SegmentResponse,
  segments: SegmentResponse[],
  startingImage: string | null,
): string | null {
  // Found by index among LIVE segments, not by array position. Those were the same thing until a
  // re-roll could put two segments at index 0: after one, segments[0] may be the archived take,
  // so position lookup would show segment 1 starting from a frame that was thrown away.
  return (
    seg.start_image ??
    (seg.index === 0
      ? startingImage
      : segments.find((s) => !s.discarded && s.index === seg.index - 1)?.last_frame_path) ??
    null
  );
}

// AR hologram work rides a dedicated carrier segment at this sentinel index; hide it from the
// video-segment list (the "Building hologram…" card is its only surface).
const HOLOGRAM_CARRIER_INDEX = 1000;
const isVideoSegment = (s: SegmentResponse) => s.index < HOLOGRAM_CARRIER_INDEX;

function buildGroups(segments: SegmentResponse[], job: JobDetailResponse): BranchGroup[] {
  const counts = new Map<string, number>();
  const firstIdx = new Map<string, number>();
  const lastIdx = new Map<string, number>();
  for (const seg of segments) {
    const filename = resolveSegmentStartImage(seg, segments, job.starting_image);
    if (!filename) continue;
    counts.set(filename, (counts.get(filename) || 0) + 1);
    if (!firstIdx.has(filename)) firstIdx.set(filename, seg.index);
    lastIdx.set(filename, seg.index);
  }
  const groups: BranchGroup[] = [];
  let colorIdx = 0;
  for (const [filename, count] of counts) {
    if (count >= 2) {
      groups.push({
        filename,
        color: BRANCH_COLORS[colorIdx % BRANCH_COLORS.length],
        firstIndex: firstIdx.get(filename)!,
        lastIndex: lastIdx.get(filename)!,
      });
      colorIdx++;
    }
  }
  return groups;
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

function BranchLane({ groups, laneWidth, activeFilename, segIndex }: { groups: BranchGroup[]; laneWidth: number; activeFilename: string | null; segIndex: number }) {
  const showDot = activeFilename !== null;
  return (
    <svg
      viewBox={`0 0 ${laneWidth} 100`}
      preserveAspectRatio="none"
      style={{ display: "block", width: "100%", height: "100%" }}
      role="img"
      aria-label={activeFilename ? `Segment branch: ${activeFilename}` : "Branch lanes"}
    >
      {groups.map((group, idx) => {
        const cx = idx * 24 + 12;
        const isActive = group.filename === activeFilename;
        let y1: number;
        let y2: number;

        if (showDot) {
          if (segIndex < group.firstIndex || segIndex > group.lastIndex) return null;
          if (isActive && segIndex === group.firstIndex) { y1 = 50; y2 = 100; }
          else if (isActive && segIndex === group.lastIndex) { y1 = 0; y2 = 50; }
          else { y1 = 0; y2 = 100; }
        } else {
          if (segIndex < group.firstIndex || segIndex >= group.lastIndex) return null;
          y1 = 0; y2 = 100;
        }

        return (
          <g key={group.filename}>
            <line x1={cx} y1={y1} x2={cx} y2={y2} stroke={group.color} strokeWidth={2} />
            {isActive && showDot && (
              <>
                <circle cx={cx} cy={50} r={5} fill={group.color} />
                <line x1={cx + 5} y1={50} x2={laneWidth} y2={50} stroke={group.color} strokeWidth={2} />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // The queue is only the fallback now: a job is opened from Videos, the dashboard and an
  // image's job list too, and returning to the queue from any of those loses the page and
  // filters the user was looking at.
  const goBack = useGoBack("/jobs");
  const [job, setJob] = useState<JobDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [videoModal, setVideoModal] = useState<{ path: string; v?: string; segIndex?: number } | null>(null);
  const [imageModal, setImageModal] = useState<{ path: string; segIndex: number } | null>(null);
  // Which segment's observations are open. Holds the segment itself rather than an id so the
  // dialog can populate without a second lookup.
  const [observing, setObserving] = useState<SegmentResponse | null>(null);
  const [loopVideo, setLoopVideo] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<SegmentResponse | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteJobConfirm, setDeleteJobConfirm] = useState(false);
  const [deletingJob, setDeletingJob] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenConfirm, setReopenConfirm] = useState(false);
  const [rerollConfirm, setRerollConfirm] = useState(false);
  // "" = plain one-shot re-roll (no rule). The threshold is text state so a half-typed
  // number doesn't fight the input; parsed at roll time.
  const [takesOpen, setTakesOpen] = useState(false);
  const [rerolling, setRerolling] = useState(false);
  const [holoOpen, setHoloOpen] = useState(false);
  const [holoBusy, setHoloBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [trimValues, setTrimValues] = useState<Record<string, { start: number; end: number }>>({});
  const trimTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [jobTags, setJobTags] = useState("");
  const tagSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [framePreview, setFramePreview] = useState<{
    anchorEl: HTMLElement | null;
    segId: string;
    position: "start" | "end";
    loading: boolean;
    data: FramePreviewResponse | null;
    trimStart: number;
    trimEnd: number;
    currentTrim: number;
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

  const handleMakeHologram = useCallback(
    async (body: { subject_height_m?: number; key_color?: string }) => {
      if (!id) return;
      setHoloBusy(true);
      try {
        await makeHologram(id, body);
        setHoloOpen(false);
        await fetchJob();
      } catch (e) {
        setError(apiError(e, "Failed to start hologram"));
      } finally {
        setHoloBusy(false);
      }
    },
    [id, fetchJob],
  );

  useEffect(() => {
    fetchJob();
    const interval = setInterval(fetchJob, POLL_INTERVAL_FAST);
    return () => clearInterval(interval);
  }, [fetchJob]);

  useEffect(() => {
  }, []);

  const { fetchSettings: fetchAppSettings } = useSettingsStore();
  useEffect(() => {
    fetchAppSettings();
  }, [fetchAppSettings]);

  // Effective video settings for a segment: its own preset override, else the job's default
  // preset, else the job's raw sampler values. Returns a name (if a preset applies), the 7
  // params for the signature table, and the effective LoRAs (preset's live-linked LoRAs win
  // when the applied preset carries any, else the segment's own explicit LoRAs).

  const handleFinalize = async () => {
    if (!id) return;
    setFinalizing(true);
    try {
      await updateJob(id, { status: "finalized" });
      fetchJob();
    } catch (e) {
      setError(apiError(e, "Failed to finalize job"));
    } finally {
      setFinalizing(false);
    }
  };

  const handleReroll = async () => {
    if (!id) return;
    setRerollConfirm(false);
    setRerolling(true);
    try {
      await rerollJobSeed(id);
      // Refetch rather than patching state in: the response is the new segment, but the job's
      // status went back to pending and the old take is now archived, so the whole page moved.
      await fetchJob();
      setError("");
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "Failed to re-roll the segment");
    } finally {
      setRerolling(false);
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
    } catch (e) {
      setError(apiError(e, "Failed to re-open job"));
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
    } catch (e) {
      setError(apiError(e, "Failed to archive job"));
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
    } catch (e) {
      setError(apiError(e, "Failed to unarchive job"));
    } finally {
      setArchiving(false);
    }
  };


  const handleRenameJob = async () => {
    setEditingName(false);
    const next = nameDraft.trim();
    if (!id || !job || !next || next === job.name) return;
    const prevName = job.name;
    setJob((prev) => (prev ? { ...prev, name: next } : prev)); // optimistic
    try {
      await updateJob(id, { name: next });
    } catch (e) {
      setJob((prev) => (prev ? { ...prev, name: prevName } : prev)); // revert
      setError(apiError(e, "Failed to rename job"));
    }
  };

  const handleRetry = async (seg: SegmentResponse) => {
    setActionLoading(seg.id);
    try {
      await retrySegment(seg.id);
      fetchJob();
    } catch (e) {
      setError(apiError(e, "Failed to retry segment"));
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

  // Cleanup tag save timer on unmount
  useEffect(() => {
    return () => {
      if (tagSaveTimer.current) clearTimeout(tagSaveTimer.current);
    };
  }, []);

  // Initialize tags from the job when loaded (only if no pending edits)
  useEffect(() => {
    if (!job) return;
    if (tagSaveTimer.current) return;
    const tags = job.tags ?? job.videos?.find((v) => v.tags)?.tags ?? "";
    setJobTags(tags);
  }, [job]);

  const handleTagsChange = (newTags: string) => {
    setJobTags(newTags);
    if (tagSaveTimer.current) clearTimeout(tagSaveTimer.current);
    tagSaveTimer.current = setTimeout(() => {
      tagSaveTimer.current = undefined;
      if (id) {
        updateJob(id, { tags: newTags || null }).catch((err) => {
          console.error("Failed to save tags:", err);
          setError("Failed to save tags");
        });
      }
    }, 500);
  };

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

  const loadFramePreview = async (
    segId: string,
    position: "start" | "end",
    trimValue: number,
    anchorEl?: HTMLElement | null,
    trimStart?: number,
    trimEnd?: number,
  ) => {
    setFramePreview((prev) => ({
      anchorEl: anchorEl ?? prev?.anchorEl ?? null,
      segId,
      position,
      loading: true,
      data: prev?.segId === segId && prev?.position === position ? prev.data : null,
      trimStart: trimStart ?? prev?.trimStart ?? 0,
      trimEnd: trimEnd ?? prev?.trimEnd ?? 0,
      currentTrim: trimValue,
    }));
    try {
      const data = await getSegmentFrames(segId, position, 5, trimValue);
      setFramePreview((prev) => prev && prev.segId === segId && prev.position === position
        ? { ...prev, loading: false, data, currentTrim: trimValue }
        : prev);
    } catch {
      setFramePreview(null);
      setError("Failed to load frame preview");
    }
  };

  const openFramePreview = (
    anchorEl: HTMLElement,
    segId: string,
    position: "start" | "end",
    trimStart: number,
    trimEnd: number,
  ) => {
    const trimValue = position === "start" ? trimStart : trimEnd;
    loadFramePreview(segId, position, trimValue, anchorEl, trimStart, trimEnd);
  };

  const navigateFramePreview = (direction: "left" | "right") => {
    if (!framePreview?.data) return;
    const frames = framePreview.data.frames;
    const step = Math.max(1, Math.floor(frames.length / 2));
    const shift = direction === "left" ? -step : step;
    // Use the current center frame to compute a new trim value for centering
    const currentCenter = frames[Math.floor(frames.length / 2)]?.frame_index ?? 0;
    const newCenter = Math.max(0, Math.min(currentCenter + shift, framePreview.data.total_frames - 1));
    // Convert newCenter to a "trim" value the API expects
    let newTrim: number;
    if (framePreview.position === "start") {
      newTrim = newCenter;
    } else {
      newTrim = Math.max(framePreview.data.total_frames - newCenter, 0);
    }
    loadFramePreview(framePreview.segId, framePreview.position, newTrim);
  };

  // Live segments only. The lane draws a chain of what continues from what, and an archived take
  // continues nothing — drawn in, it reads as though the replacement followed the take it
  // replaced rather than standing in for it.
  const groups = useMemo(
    () => (job ? buildGroups(job.segments.filter(isVideoSegment).filter((s) => !s.discarded), job) : []),
    [job],
  );

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

  const videoSegments = job.segments.filter(isVideoSegment);
  // Archived takes are alternatives, not positions in the video, so they come out of the
  // sequence and sit under the take that replaced them.
  const { live: liveSegments, archivedByIndex } = groupTakes(videoSegments);

  const canReroll = canRerollSeed(videoSegments);

  /** The "N previous takes" fold for one index — used under the live segment that replaced
   *  them, and standalone for a position whose takes were all discarded with no replacement. */
  /** The "N previous takes" fold that closes the segment list.
   *
   *  One section under everything, not one per position: interleaving them put a fold between
   *  segment 0 and segment 1 and broke the one thing the list is for — reading the video in
   *  order. Takes are alternatives, not steps, so they get no lane, no trim and no transition. */
  const takeRows = () => {
    const rows: ReactElement[] = [];
                const takes = allArchivedTakes({ live: liveSegments, archivedByIndex });
                if (takes.length > 0) {
                  const open = takesOpen;
                  rows.push(
                    <TableRow key="takes-toggle">
                      {groups.length > 0 && <TableCell padding="none" sx={{ width: laneWidth }} />}
                      <TableCell colSpan={8} sx={{ py: 0.25, borderBottom: open ? "none" : undefined }}>
                        <Button
                          size="small"
                          onClick={() => setTakesOpen((open) => !open)}
                          startIcon={open ? <ExpandLess /> : <ExpandMore />}
                          sx={{ color: "text.secondary", textTransform: "none" }}
                        >
                          {takes.length} previous take{takes.length > 1 ? "s" : ""}
                        </Button>
                      </TableCell>
                    </TableRow>,
                  );
                  if (open) {
                    takes.forEach((take) => {
                      rows.push(
                        <TableRow key={take.id} sx={{ bgcolor: "action.hover" }}>
                          {groups.length > 0 && <TableCell padding="none" sx={{ width: laneWidth }} />}
                          <TableCell colSpan={8} sx={{ py: 1 }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, pl: 4, flexWrap: "wrap" }}>
                              {/* Which position this take was for: the list is pooled at the
                                  bottom, so a row has to say what it was a take OF. */}
                              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 700, minWidth: 26 }}>
                                #{take.index}
                              </Typography>
                              {take.last_frame_path ? (
                                <Box
                                  component="img"
                                  src={getFileUrl(take.last_frame_path, take.completed_at ?? undefined)}
                                  alt="Last frame"
                                  onClick={() =>
                                    take.output_path &&
                                    setVideoModal({
                                      path: take.output_path,
                                      v: take.completed_at ?? undefined,
                                      segIndex: take.index,
                                    })
                                  }
                                  sx={{
                                    width: 56,
                                    height: 56,
                                    objectFit: "cover",
                                    borderRadius: 0.5,
                                    cursor: take.output_path ? "pointer" : "default",
                                  }}
                                />
                              ) : (
                                <Box sx={{ width: 56, height: 56, bgcolor: "action.disabledBackground", borderRadius: 0.5 }} />
                              )}
                              <StatusChip status={take.status} />
                              {takeSeed(take) && (
                                <Tooltip title="The seed this take generated with">
                                  <Chip
                                    size="small"
                                    variant="outlined"
                                    label={`seed ${takeSeed(take)}`}
                                    sx={{ fontFamily: "monospace" }}
                                  />
                                </Tooltip>
                              )}
                              {(() => {
                                const reviewed =
                                  take.rating != null || !!take.notes || !!take.observation_tags;
                                return (
                                  <Tooltip title={reviewed ? "Edit observations" : "Add observations"}>
                                    <IconButton
                                      size="small"
                                      onClick={() => setObserving(take)}
                                      color={reviewed ? "primary" : "default"}
                                    >
                                      {reviewed ? <RateReview fontSize="small" /> : <RateReviewOutlined fontSize="small" />}
                                    </IconButton>
                                  </Tooltip>
                                );
                              })()}
                              <Typography variant="caption" color="text.secondary">
                                {formatDate(take.created_at)}
                              </Typography>
                              <Box sx={{ flex: 1 }} />
                              <Tooltip title="Delete this take permanently">
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => setDeleteConfirm(take)}
                                  disabled={actionLoading === take.id}
                                >
                                  <DeleteOutline fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </TableCell>
                        </TableRow>,
                      );
                    });
                  }
                }
    return rows;
  };

  const laneWidth = groups.length > 0 ? groups.length * 24 + 24 : 0;

  /** Mobile equivalent of takeRows. */
  /** Mobile equivalent of takeRows: one section after every segment card. */
  const mobileTakeItems = () => {
    const items: ReactElement[] = [];
            const takes = allArchivedTakes({ live: liveSegments, archivedByIndex });
            if (takes.length > 0) {
              const open = takesOpen;
              items.push(
                <Box key="takes" sx={{ pl: 1 }}>
                  <Button
                    size="small"
                    onClick={() => setTakesOpen((open) => !open)}
                    startIcon={open ? <ExpandLess /> : <ExpandMore />}
                    sx={{ color: "text.secondary", textTransform: "none" }}
                  >
                    {takes.length} previous take{takes.length > 1 ? "s" : ""}
                  </Button>
                  {open &&
                    takes.map((take) => (
                      <Box
                        key={take.id}
                        sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.75, pl: 1, flexWrap: "wrap" }}
                      >
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                            #{take.index}
                          </Typography>
                        {take.last_frame_path && (
                          <Box
                            component="img"
                            src={getFileUrl(take.last_frame_path, take.completed_at ?? undefined)}
                            alt="Last frame"
                            onClick={() =>
                              take.output_path &&
                              setVideoModal({
                                path: take.output_path,
                                v: take.completed_at ?? undefined,
                                segIndex: take.index,
                              })
                            }
                            sx={{ width: 44, height: 44, objectFit: "cover", borderRadius: 0.5 }}
                          />
                        )}
                        <StatusChip status={take.status} />
                        {takeSeed(take) && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`seed ${takeSeed(take)}`}
                            sx={{ fontFamily: "monospace", fontSize: 11 }}
                          />
                        )}
                        <IconButton size="small" onClick={() => setObserving(take)}>
                          <RateReview fontSize="small" />
                        </IconButton>
                      </Box>
                    ))}
                </Box>,
              );
            }
    return items;
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        <IconButton onClick={goBack} size={isMobile ? "small" : "medium"}>
          <ArrowBack />
        </IconButton>
        {editingName ? (
          <TextField
            autoFocus
            fullWidth
            variant="standard"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleRenameJob}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              else if (e.key === "Escape") setEditingName(false);
            }}
            sx={{ flex: 1, minWidth: 0 }}
            inputProps={{ style: { fontSize: isMobile ? "1.25rem" : "2.125rem", fontWeight: 400 } }}
          />
        ) : (
          <Typography
            variant={isMobile ? "h6" : "h4"}
            onClick={() => { setNameDraft(job.name); setEditingName(true); }}
            title="Click to rename"
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              cursor: "text",
              borderRadius: 1,
              px: 0.5,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            {job.name}
          </Typography>
        )}
        <Tooltip title="Delete job">
          <IconButton
            color="error"
            onClick={() => setDeleteJobConfirm(true)}
            disabled={deletingJob}
            size={isMobile ? "small" : "medium"}
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
          <CardContent sx={{ position: "relative" }}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" },
                gap: 2,
              }}
            >
              <MetaItem label="Dimensions" value={`${job.width}x${job.height}`} />
              <MetaItem label="FPS" value={`${job.fps}`} />
              {/* The job seed IS the live take's seed — a re-roll moves it here rather than
                  putting a second, different number on segment 0. One live take, one answer, in
                  the place the create dialog takes it back from. */}
              <MetaItem label="Seed" value={`${job.seed}`} />
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
                  loop={loopVideo}
                  sx={{ width: "100%", borderRadius: 1, display: "block" }}
                />
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {finalVideo.duration_seconds != null ? formatDuration(finalVideo.duration_seconds) : ""}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <IconButton
                size="small"
                onClick={() => setLoopVideo((v) => !v)}
                color={loopVideo ? "primary" : "default"}
                title={loopVideo ? "Loop on" : "Loop off"}
              >
                <Repeat fontSize="small" />
              </IconButton>
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
          </Box>
          {(() => {
            const holoSeg = job.segments?.find((s) => s.hologram_video_path);
            const holoUrl = holoSeg ? `${window.location.origin}/holo/${holoSeg.id}` : null;
            const building = !holoSeg && job.segments?.some((s) => s.reprocess_type === "ar_hologram");
            const flavorLabel = holoSeg?.hologram_flavor === "2.5d_depth" ? "2.5D Depth" : "2D Matte";
            return (
              <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                {holoUrl ? (
                  <>
                    <Chip size="small" label={flavorLabel} variant="outlined" />
                    <Button size="small" variant="contained" startIcon={<ViewInAr />} component="a" href={holoUrl} target="_blank">
                      Open in AR
                    </Button>
                    <QRCodeCanvas value={holoUrl} size={128} />
                    <Typography variant="caption" color="text.secondary">Scan on your Quest 3</Typography>
                    <Button size="small" onClick={() => setHoloOpen(true)}>Remake…</Button>
                  </>
                ) : building ? (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <CircularProgress size={18} />
                    <Typography variant="body2" color="text.secondary">Building hologram…</Typography>
                  </Box>
                ) : (
                  <Button size="small" variant="outlined" fullWidth startIcon={<ViewInAr />} onClick={() => setHoloOpen(true)}>
                    Make Hologram
                  </Button>
                )}
              </Box>
            );
          })()}
              </CardContent>
            </Card>
          );
        })()}
        <HologramConfig
          open={holoOpen}
          onClose={() => setHoloOpen(false)}
          onSubmit={handleMakeHologram}
          busy={holoBusy}
          initialFlavor={job.segments?.find((s) => s.hologram_video_path)?.hologram_flavor ?? "2d_matte"}
          initialDepthScale={
            job.segments?.find((s) => s.hologram_video_path)?.hologram_depth_scale_m ?? 0.3
          }
        />
      </Box>

      {/* Tags editor — always visible */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Tags</Typography>
          <TextField
            size="small"
            fullWidth
            placeholder="Add tags (comma separated)"
            value={jobTags}
            onChange={(e) => handleTagsChange(e.target.value)}
            aria-label="Job tags"
          />
          {jobTags && (
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1 }}>
              {jobTags.split(",").map((tag, i) => {
                const trimmed = tag.trim();
                if (!trimmed) return null;
                return (
                  <Chip
                    key={i}
                    label={trimmed}
                    size="small"
                    onDelete={() => {
                      const tags = jobTags.split(",").map((t) => t.trim()).filter((t) => t && t !== trimmed);
                      handleTagsChange(tags.join(", "));
                    }}
                  />
                );
              })}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Segments table */}
      <Card sx={{ mb: 3 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 1,
            px: 2,
            py: 1.5,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography variant="h6">Segments</Typography>
          <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
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
            {canReroll && (
              <Tooltip
                title="Archive this take and generate another one from the same settings with a new random seed"
                arrow
              >
                <span>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setRerollConfirm(true)}
                    disabled={rerolling}
                    startIcon={
                      rerolling ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : isMobile ? undefined : (
                        <Casino />
                      )
                    }
                  >
                    {rerolling ? "Rolling..." : isMobile ? "Re-roll" : "Re-roll Seed"}
                  </Button>
                </span>
              </Tooltip>
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
                {finalizing ? "Finalizing..." : isMobile ? "Finalize" : "Finalize & Merge"}
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
                  ) : isMobile ? undefined : (
                    <Replay />
                  )
                }
              >
                {reopening ? "Re-opening..." : isMobile ? "Re-open" : "Re-open Job"}
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
                  {groups.length > 0 && (
                    <TableCell padding="none" sx={{ width: laneWidth, minWidth: laneWidth }} />
                  )}
                  <TableCell sx={{ width: 120, ...(groups.length > 0 ? { pl: 0 } : {}) }}>Start Image</TableCell>
                  <TableCell sx={{ width: 48 }} align="center">Prompt</TableCell>
                  <TableCell sx={{ width: 120 }}>Output</TableCell>
                  <TableCell sx={{ width: 100 }}>Status</TableCell>
                  <TableCell sx={{ width: 120 }}>Worker</TableCell>
                  <TableCell sx={{ width: 140 }}>Created</TableCell>
                  <TableCell sx={{ width: 80 }}>Run Time</TableCell>
                  <TableCell sx={{ width: 92 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {liveSegments.flatMap((seg) => {
                  const rows = [
                  <TableRow key={seg.id}>
                    {groups.length > 0 && (
                      <TableCell padding="none" sx={{ width: laneWidth, minWidth: laneWidth, position: "relative" }}>
                        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
                          <BranchLane
                            groups={groups}
                            laneWidth={laneWidth}
                            activeFilename={resolveSegmentStartImage(seg, job.segments, job.starting_image)}
                            segIndex={seg.index}
                          />
                        </div>
                      </TableCell>
                    )}
                    <TableCell sx={groups.length > 0 ? { pl: 0 } : undefined}>
                      {(() => {
                        const img = resolveSegmentStartImage(seg, job.segments, job.starting_image);
                        return img ? (
                          <Box
                            component="img"
                            src={getFileUrl(img)}
                            alt="Start"
                            onClick={() => setImageModal({ path: img, segIndex: seg.index })}
                            sx={{
                              width: 80,
                              height: 80,
                              objectFit: "cover",
                              borderRadius: 1,
                              bgcolor: "#f5f5f5",
                              display: "block",
                              cursor: "pointer",
                              "&:hover": { opacity: 0.85 },
                            }}
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            -
                          </Typography>
                        );
                      })()}
                    </TableCell>
                    <TableCell align="center" padding="none">
                      <SegmentPromptPopover
                        index={seg.index}
                        prompt={seg.prompt}
                        promptTemplate={seg.prompt_template}
                        negativePrompt={seg.negative_prompt}
                      />
                    </TableCell>
                    <TableCell>
                      {/* The error alert lived inside the removed Video Settings cell and
                          moves here rather than going with it — a failed segment must still
                          say why, and Output is where you look when one fails. */}
                      {seg.error_message && (
                        <Alert severity="error" sx={{ mb: 1 }}>
                          {seg.error_message}
                        </Alert>
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
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                        <StatusChip status={seg.status} />
                        {(() => {
                          const reviewed =
                            seg.rating != null || !!seg.notes || !!seg.observation_tags;
                          return (
                            <Tooltip title={reviewed ? "Edit observations" : "Add observations"}>
                              <IconButton
                                size="small"
                                onClick={() => setObserving(seg)}
                                color={reviewed ? "primary" : "default"}
                              >
                                {reviewed ? (
                                  <RateReview fontSize="small" />
                                ) : (
                                  <RateReviewOutlined fontSize="small" />
                                )}
                              </IconButton>
                            </Tooltip>
                          );
                        })()}
                      </Box>
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
                    <TableCell padding="none" align="center">
                      <Box sx={{ display: "flex", gap: 0.25, justifyContent: "center" }}>
                        {(seg.status === "pending" || seg.status === "claimed" || seg.status === "processing") && (
                          <Tooltip title="Stop">
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
                          (seg.status === "failed" || seg.status === "completed") &&
                          !seg.discarded &&
                          job.segments.filter((x) => !x.discarded).length > 1 && (
                            <Tooltip title="Discard — keeps the rating and notes, removes it from the video">
                              <IconButton
                                size="small"
                                onClick={async () => {
                                  const updated = await discardSegment(seg.id);
                                  setJob((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          segments: prev.segments.map((x) =>
                                            x.id === updated.id ? { ...x, discarded: true } : x,
                                          ),
                                        }
                                      : prev,
                                  );
                                }}
                                disabled={actionLoading === seg.id}
                              >
                                <RemoveCircleOutline fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        {job.status !== "finalized" &&
                          (seg.status === "failed" || seg.status === "completed") &&
                          job.segments.length > 1 && (
                            <Tooltip title="Delete — destroys the segment and its feedback">
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
                      {groups.length > 0 && (
                        <TableCell padding="none" sx={{ width: laneWidth, minWidth: laneWidth, position: "relative" }}>
                          <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>
                            <BranchLane
                              groups={groups}
                              laneWidth={laneWidth}
                              activeFilename={null}
                              segIndex={seg.index}
                            />
                          </div>
                        </TableCell>
                      )}
                      {/* 8 non-lane columns: Start Image, Prompt, Output, Status, Worker,
                          Created, Run Time, actions */}
                      <TableCell colSpan={8} sx={{ py: 0.5 }}>
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
                              <MenuItem value="dissolve">Cross-dissolve</MenuItem>
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
                {takeRows()}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Mobile card layout */}
        {isMobile && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, p: 1.5 }}>
            {liveSegments.flatMap((seg) => {
              const startImg =
                resolveSegmentStartImage(seg, job.segments, job.starting_image);
              const card = (
                <Card key={seg.id} variant="outlined">
                  <Box sx={{ p: 1.5 }}>
                    {/* Header row: index, status, actions */}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        #{seg.index}
                      </Typography>
                      <StatusChip status={seg.status} />
                      {(() => {
                        const reviewed =
                          seg.rating != null || !!seg.notes || !!seg.observation_tags;
                        return (
                          <Tooltip title={reviewed ? "Edit observations" : "Add observations"}>
                            <IconButton
                              size="small"
                              onClick={() => setObserving(seg)}
                              color={reviewed ? "primary" : "default"}
                            >
                              {reviewed ? (
                                <RateReview fontSize="small" />
                              ) : (
                                <RateReviewOutlined fontSize="small" />
                              )}
                            </IconButton>
                          </Tooltip>
                        );
                      })()}
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
                          onClick={() => setImageModal({ path: startImg, segIndex: seg.index })}
                          sx={{
                            width: 64,
                            height: 64,
                            objectFit: "cover",
                            borderRadius: 1,
                            bgcolor: "#f5f5f5",
                            cursor: "pointer",
                            "&:hover": { opacity: 0.85 },
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
            {mobileTakeItems()}
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

      {/* Delete segment confirm dialog */}
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
      {/* Re-roll confirmation */}
      <Dialog open={rerollConfirm} onClose={() => setRerollConfirm(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Re-roll with a new seed?</DialogTitle>
        <DialogContent>
          <Typography>
            The current take is <strong>archived</strong>, not deleted — its video, rating and
            notes stay on the job, under the seed that produced it.
          </Typography>
          <Typography sx={{ mt: 1.5 }}>
            A new segment 0 is queued with the same prompt, LoRAs, preset and start image. Only
            the seed changes, so the two takes are directly comparable.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRerollConfirm(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleReroll}
            disabled={rerolling}
          >
            {rerolling ? "Rolling..." : "Re-roll"}
          </Button>
        </DialogActions>
      </Dialog>

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
              loop={loopVideo}
              src={getFileUrl(videoModal.path, videoModal.v)}
              sx={{ width: "100%", maxHeight: "80vh", objectFit: "contain", display: "block" }}
            />
          )}
          <Box sx={{ p: 1, display: "flex", justifyContent: "flex-start", bgcolor: "rgba(0,0,0,0.8)" }}>
            <IconButton
              size="small"
              onClick={() => setLoopVideo((v) => !v)}
              sx={{ color: loopVideo ? "primary.main" : "rgba(255,255,255,0.5)" }}
              title={loopVideo ? "Loop on" : "Loop off"}
            >
              <Repeat fontSize="small" />
            </IconButton>
          </Box>
        </DialogContent>
      </Dialog>

      {/* Start image modal */}
      <Dialog
        open={!!imageModal}
        onClose={() => setImageModal(null)}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogContent sx={{ p: 0, position: "relative", bgcolor: "#000" }}>
          <IconButton
            onClick={() => {
              if (!imageModal || !job) return;
              const a = document.createElement("a");
              a.href = getFileUrl(imageModal.path);
              a.download = `${job.name}_segment${imageModal.segIndex}_start${
                imageModal.path.match(/\.[a-z0-9]+$/i)?.[0] ?? ".png"
              }`;
              a.click();
            }}
            sx={{ position: "absolute", top: 8, right: 48, color: "white", zIndex: 1 }}
          >
            <Download />
          </IconButton>
          <IconButton
            onClick={() => setImageModal(null)}
            sx={{ position: "absolute", top: 8, right: 8, color: "white", zIndex: 1 }}
          >
            <Close />
          </IconButton>
          {imageModal && (
            <Box
              component="img"
              src={getFileUrl(imageModal.path)}
              alt={`Segment ${imageModal.segIndex} start image`}
              sx={{ width: "100%", maxHeight: "80vh", objectFit: "contain", display: "block" }}
            />
          )}
          <Box sx={{ px: 1.5, py: 1, bgcolor: "rgba(0,0,0,0.8)" }}>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.7)", wordBreak: "break-all" }}>
              {imageModal ? `#${imageModal.segIndex} — ${imageModal.path.split("/").pop()}` : ""}
            </Typography>
          </Box>
        </DialogContent>
      </Dialog>

      {/* Human observations. Kept out of the fetch path — saving patches the local segment in
          place rather than refetching the job, so the row you just rated does not flicker. */}
      <SegmentObservationDialog
        open={!!observing}
        segment={observing}
        onClose={() => setObserving(null)}
        onSaved={(updated) =>
          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  segments: prev.segments.map((s) =>
                    s.id === updated.id
                      ? {
                          ...s,
                          rating: updated.rating,
                          notes: updated.notes,
                          observation_tags: updated.observation_tags,
                        }
                      : s,
                  ),
                }
              : prev,
          )
        }
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
          {framePreview?.loading && !framePreview.data && (
            <Box sx={{ textAlign: "center", py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {framePreview?.data && (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
                {framePreview.data.total_frames} frames @ {framePreview.data.fps.toFixed(1)} fps
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <IconButton
                  size="small"
                  onClick={() => navigateFramePreview("left")}
                  disabled={framePreview.loading || (framePreview.data.frames[0]?.frame_index ?? 0) === 0}
                >
                  <ChevronLeft />
                </IconButton>
                <Box sx={{ display: "flex", gap: 0.5, opacity: framePreview.loading ? 0.5 : 1 }}>
                  {framePreview.data.frames.map((f) => {
                    const isTrimmed = framePreview.position === "start"
                      ? f.frame_index < framePreview.trimStart
                      : f.frame_index >= framePreview.data!.total_frames - framePreview.trimEnd;
                    return (
                      <Box key={f.frame_index} sx={{ position: "relative", textAlign: "center" }}>
                        <Box
                          component="img"
                          src={f.data_url}
                          sx={{ width: isMobile ? 56 : 120, height: "auto", display: "block", borderRadius: 0.5 }}
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
                <IconButton
                  size="small"
                  onClick={() => navigateFramePreview("right")}
                  disabled={framePreview.loading || (framePreview.data.frames[framePreview.data.frames.length - 1]?.frame_index ?? 0) >= framePreview.data.total_frames - 1}
                >
                  <ChevronRight />
                </IconButton>
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



