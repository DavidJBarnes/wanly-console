import { useEffect, useState, useCallback } from "react";
import {
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
  Divider,
  IconButton,
} from "@mui/material";
import { ArrowBack, PlayArrow } from "@mui/icons-material";
import { useParams, useNavigate } from "react-router";
import { getJob, updateJob, addSegment, getFileUrl } from "../api/client";
import type {
  JobDetailResponse,
  SegmentResponse,
  SegmentCreate,
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

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    try {
      await updateJob(id, { status: "finalized" });
      fetchJob();
    } catch {
      setError("Failed to finalize job");
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

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        <IconButton onClick={() => navigate("/jobs")}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h4" sx={{ flex: 1 }}>
          {job.name}
        </Typography>
        <StatusChip status={job.status} />
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
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
            <MetaItem label="Total Run Time" value={formatDuration(job.total_run_time)} />
            <MetaItem
              label="Total Video Time"
              value={formatDuration(job.total_video_time)}
            />
            <MetaItem label="Created" value={formatDate(job.created_at)} />
            <MetaItem label="Updated" value={formatDate(job.updated_at)} />
          </Box>

          {/* Action buttons */}
          <Box sx={{ mt: 2, display: "flex", gap: 1 }}>
            {job.status === "awaiting" && (
              <Button
                variant="contained"
                color="secondary"
                onClick={handleFinalize}
              >
                Finalize & Merge
              </Button>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Segments timeline */}
      <Typography variant="h5" sx={{ mb: 2 }}>
        Segments
      </Typography>
      {job.segments.map((seg) => (
        <SegmentCard key={seg.id} segment={seg} />
      ))}

      {/* Next segment form */}
      {job.status === "awaiting" && (
        <NextSegmentForm
          jobId={job.id}
          lastSegment={lastSegment}
          onSubmitted={fetchJob}
        />
      )}

      {/* Processing indicator */}
      {(job.status === "processing" || job.status === "pending") && (
        <Card sx={{ mt: 2, bgcolor: "#e3f2fd" }}>
          <CardContent
            sx={{ display: "flex", alignItems: "center", gap: 2 }}
          >
            <CircularProgress size={24} />
            <Typography>
              {job.status === "processing"
                ? "Segment is being processed..."
                : "Waiting for a worker to pick up this job..."}
            </Typography>
          </CardContent>
        </Card>
      )}
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

function SegmentCard({ segment }: { segment: SegmentResponse }) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "start",
            mb: 1,
          }}
        >
          <Typography variant="h6">Segment {segment.index}</Typography>
          <StatusChip status={segment.status} />
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {segment.prompt}
        </Typography>

        <Box
          sx={{
            display: "flex",
            gap: 2,
            flexWrap: "wrap",
            alignItems: "start",
          }}
        >
          {/* Start image thumbnail */}
          {segment.start_image && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Start Image
              </Typography>
              <Box
                component="img"
                src={getFileUrl(segment.start_image)}
                alt="Start"
                sx={{
                  display: "block",
                  width: 160,
                  height: 90,
                  objectFit: "cover",
                  borderRadius: 1,
                  bgcolor: "#f5f5f5",
                }}
              />
            </Box>
          )}

          {/* Last frame thumbnail */}
          {segment.last_frame_path && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Last Frame
              </Typography>
              <Box
                component="img"
                src={getFileUrl(segment.last_frame_path)}
                alt="Last frame"
                sx={{
                  display: "block",
                  width: 160,
                  height: 90,
                  objectFit: "cover",
                  borderRadius: 1,
                  bgcolor: "#f5f5f5",
                }}
              />
            </Box>
          )}

          {/* Video player */}
          {segment.output_path && (
            <Box sx={{ flex: 1, minWidth: 280 }}>
              <Typography variant="caption" color="text.secondary">
                Output Video
              </Typography>
              <Box
                component="video"
                controls
                src={getFileUrl(segment.output_path)}
                sx={{
                  display: "block",
                  width: "100%",
                  maxWidth: 480,
                  borderRadius: 1,
                  bgcolor: "#000",
                }}
              />
            </Box>
          )}
        </Box>

        {segment.error_message && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {segment.error_message}
          </Alert>
        )}

        <Divider sx={{ my: 1.5 }} />
        <Box sx={{ display: "flex", gap: 3 }}>
          <Typography variant="caption" color="text.secondary">
            Duration: {segment.duration_seconds}s
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Created: {formatDate(segment.created_at)}
          </Typography>
          {segment.claimed_at && (
            <Typography variant="caption" color="text.secondary">
              Claimed: {formatDate(segment.claimed_at)}
            </Typography>
          )}
          {segment.completed_at && (
            <Typography variant="caption" color="text.secondary">
              Completed: {formatDate(segment.completed_at)}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

function NextSegmentForm({
  jobId,
  lastSegment,
  onSubmitted,
}: {
  jobId: string;
  lastSegment?: SegmentResponse;
  onSubmitted: () => void;
}) {
  const [prompt, setPrompt] = useState(lastSegment?.prompt ?? "");
  const [duration, setDuration] = useState(lastSegment?.duration_seconds ?? 5.0);
  const [faceswapEnabled, setFaceswapEnabled] = useState(
    lastSegment?.faceswap_enabled ?? false,
  );
  const [faceswapMethod, setFaceswapMethod] = useState(
    lastSegment?.faceswap_method ?? "reactor",
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      setError("Prompt is required");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const body: SegmentCreate = {
        prompt: prompt.trim(),
        duration_seconds: duration,
        faceswap_enabled: faceswapEnabled,
        faceswap_method: faceswapEnabled ? faceswapMethod : null,
        faceswap_image: faceswapEnabled
          ? lastSegment?.faceswap_image ?? null
          : null,
        faceswap_faces_index: faceswapEnabled
          ? lastSegment?.faceswap_faces_index ?? null
          : null,
        faceswap_faces_order: faceswapEnabled
          ? lastSegment?.faceswap_faces_order ?? null
          : null,
        loras: lastSegment?.loras ?? null,
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
    <Card sx={{ mt: 3, border: "2px solid", borderColor: "primary.main" }}>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2 }}>
          <PlayArrow
            sx={{ verticalAlign: "middle", mr: 0.5 }}
            color="primary"
          />
          Next Segment
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          label="Prompt"
          fullWidth
          multiline
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          sx={{ mb: 2 }}
        />
        <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
          <TextField
            label="Duration (sec)"
            type="number"
            value={duration}
            onChange={(e) => setDuration(parseFloat(e.target.value) || 5)}
            slotProps={{ htmlInput: { step: 0.5, min: 1, max: 10 } }}
            sx={{ width: 150 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={faceswapEnabled}
                onChange={(e) => setFaceswapEnabled(e.target.checked)}
              />
            }
            label="Faceswap"
          />
          {faceswapEnabled && (
            <TextField
              label="Method"
              select
              size="small"
              value={faceswapMethod}
              onChange={(e) => setFaceswapMethod(e.target.value)}
              sx={{ width: 150 }}
            >
              <MenuItem value="reactor">ReActor</MenuItem>
              <MenuItem value="facefusion">FaceFusion</MenuItem>
            </TextField>
          )}
        </Box>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? "Submitting..." : "Submit Next Segment"}
        </Button>
      </CardContent>
    </Card>
  );
}
