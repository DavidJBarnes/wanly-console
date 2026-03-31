import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
} from "@mui/material";
import { ArrowBack, Circle, LinearScale } from "@mui/icons-material";
import { useParams, useNavigate, Link as RouterLink } from "react-router";
import { getWorker, getWorkerSegments } from "../api/client";
import StatusChip from "../components/StatusChip";
import type { WorkerResponse, WorkerStatus, WorkerSegmentResponse } from "../api/types";

const STATUS_CONFIG: Record<WorkerStatus, { color: string; label: string }> = {
  "online-idle": { color: "#4caf50", label: "Idle" },
  "online-busy": { color: "#ff9800", label: "Busy" },
  offline: { color: "#9e9e9e", label: "Offline" },
  draining: { color: "#f57f17", label: "Draining" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function timeAgo(iso: string) {
  const seconds = Math.floor(
    (Date.now() - new Date(iso).getTime()) / 1000,
  );
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function segRunTime(seg: WorkerSegmentResponse): string {
  if (!seg.claimed_at || !seg.completed_at) return "-";
  const ms = new Date(seg.completed_at).getTime() - new Date(seg.claimed_at).getTime();
  return formatDuration(ms / 1000);
}

export default function WorkerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [worker, setWorker] = useState<WorkerResponse | null>(null);
  const [segments, setSegments] = useState<WorkerSegmentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchWorker = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getWorker(id);
      setWorker(data);
      setError("");
    } catch {
      setError("Worker not found in registry");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchSegments = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getWorkerSegments(id);
      setSegments(data);
    } catch {
      // non-critical
    }
  }, [id]);

  useEffect(() => {
    fetchWorker();
    fetchSegments();
    const interval = setInterval(fetchWorker, 10000);
    return () => clearInterval(interval);
  }, [fetchWorker, fetchSegments]);

  if (loading) {
    return (
      <Box sx={{ textAlign: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !worker) {
    return (
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
          <IconButton onClick={() => navigate("/workers")}>
            <ArrowBack />
          </IconButton>
          <Typography variant="h4">Worker</Typography>
        </Box>
        <Alert severity="warning">{error || "Worker not found"}</Alert>
        {id && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            ID: {id}
          </Typography>
        )}
      </Box>
    );
  }

  const cfg = STATUS_CONFIG[worker.status];

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        <IconButton onClick={() => navigate("/workers")}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h4" sx={{ flex: 1 }}>
          {worker.friendly_name}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Circle sx={{ fontSize: 12, color: cfg.color }} />
          <Typography variant="body1" sx={{ fontWeight: 600, color: cfg.color }}>
            {cfg.label}
          </Typography>
        </Box>
      </Box>

      <Card>
        <CardContent>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(3, 1fr)" },
              gap: 2,
            }}
          >
            <MetaItem label="Hostname" value={worker.hostname} />
            <MetaItem label="IP Address" value={worker.ip_address} />
            <MetaItem label="ComfyUI" value={worker.comfyui_running ? "Running" : "Stopped"} />
            <MetaItem
              label="sd-scripts"
              value={
                !worker.sd_scripts
                  ? "N/A"
                  : worker.sd_scripts.sd_scripts_training
                    ? `Training: ${worker.sd_scripts.sd_scripts_training_info?.output_name ?? "unknown"}`
                    : worker.sd_scripts.sd_scripts_installed
                      ? "Idle"
                      : "Not installed"
              }
            />
            <MetaItem
              label="A1111"
              value={
                !worker.a1111
                  ? "N/A"
                  : worker.a1111.a1111_running
                    ? "Running"
                    : worker.a1111.a1111_installed
                      ? "Stopped"
                      : "Not installed"
              }
            />
            <MetaItem label="Last Heartbeat" value={timeAgo(worker.last_heartbeat)} />
            <MetaItem label="Registered" value={formatDate(worker.registered_at)} />
            <MetaItem label="Updated" value={formatDate(worker.updated_at)} />
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mt: 2, pt: 1.5, borderTop: "1px solid", borderColor: "divider" }}
          >
            ID: {worker.id}
          </Typography>
        </CardContent>
      </Card>

      {worker.sd_scripts?.sd_scripts_training && worker.sd_scripts.sd_scripts_training_info && (
        <Card sx={{ mt: 3 }}>
          <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 1 }}>
            <LinearScale sx={{ fontSize: 20, color: "#ff9800" }} />
            <Typography variant="h6">LoRA Training</Typography>
          </Box>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {worker.sd_scripts.sd_scripts_training_info.output_name}
            </Typography>

            {worker.sd_scripts.sd_scripts_training_info.pct_complete != null && (
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">Progress</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {worker.sd_scripts.sd_scripts_training_info.pct_complete.toFixed(1)}%
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={worker.sd_scripts.sd_scripts_training_info.pct_complete}
                  sx={{ height: 8, borderRadius: 4 }}
                />
              </Box>
            )}

            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 2 }}>
              {worker.sd_scripts.sd_scripts_training_info.current_epoch != null && (
                <MetaItem
                  label="Epoch"
                  value={
                    worker.sd_scripts.sd_scripts_training_info.max_epochs
                      ? `${worker.sd_scripts.sd_scripts_training_info.current_epoch} / ${worker.sd_scripts.sd_scripts_training_info.max_epochs}`
                      : `${worker.sd_scripts.sd_scripts_training_info.current_epoch}`
                  }
                />
              )}
              {worker.sd_scripts.sd_scripts_training_info.current_step != null && (
                <MetaItem label="Step" value={worker.sd_scripts.sd_scripts_training_info.current_step.toLocaleString()} />
              )}
              {worker.sd_scripts.sd_scripts_training_info.current_loss != null && (
                <MetaItem label="Loss" value={worker.sd_scripts.sd_scripts_training_info.current_loss.toFixed(4)} />
              )}
              <MetaItem label="PID" value={String(worker.sd_scripts.sd_scripts_training_info.pid)} />
            </Box>
          </CardContent>
        </Card>
      )}

      {segments.length > 0 && (
        <Card sx={{ mt: 3 }}>
          <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
            <Typography variant="h6">Work History</Typography>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Job</TableCell>
                  <TableCell sx={{ width: 60 }}>Seg</TableCell>
                  <TableCell>Prompt</TableCell>
                  <TableCell sx={{ width: 100 }}>Status</TableCell>
                  <TableCell sx={{ width: 100 }}>Run Time</TableCell>
                  <TableCell sx={{ width: 140 }}>Completed</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {segments.map((seg) => (
                  <TableRow key={seg.id}>
                    <TableCell>
                      <Typography
                        variant="body2"
                        component={RouterLink}
                        to={`/jobs/${seg.job_id}`}
                        sx={{
                          color: "primary.main",
                          textDecoration: "none",
                          "&:hover": { textDecoration: "underline" },
                        }}
                      >
                        {seg.job_name}
                      </Typography>
                    </TableCell>
                    <TableCell>{seg.index}</TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
                        {seg.prompt}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <StatusChip status={seg.status} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{segRunTime(seg)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {seg.completed_at ? formatDate(seg.completed_at) : "-"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
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
