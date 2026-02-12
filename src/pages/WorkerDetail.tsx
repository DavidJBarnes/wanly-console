import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  IconButton,
} from "@mui/material";
import { ArrowBack, Circle } from "@mui/icons-material";
import { useParams, useNavigate } from "react-router";
import { getWorker } from "../api/client";
import type { WorkerResponse, WorkerStatus } from "../api/types";

const STATUS_CONFIG: Record<WorkerStatus, { color: string; label: string }> = {
  "online-idle": { color: "#4caf50", label: "Idle" },
  "online-busy": { color: "#ff9800", label: "Busy" },
  offline: { color: "#9e9e9e", label: "Offline" },
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

export default function WorkerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [worker, setWorker] = useState<WorkerResponse | null>(null);
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

  useEffect(() => {
    fetchWorker();
    const interval = setInterval(fetchWorker, 10000);
    return () => clearInterval(interval);
  }, [fetchWorker]);

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
