import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  Alert,
} from "@mui/material";
import {
  Circle,
  Computer,
  Timer,
} from "@mui/icons-material";
import { getWorkers } from "../api/client";
import type { WorkerResponse, WorkerStatus } from "../api/types";

const STATUS_CONFIG: Record<WorkerStatus, { color: string; label: string }> = {
  "online-idle": { color: "#4caf50", label: "Idle" },
  "online-busy": { color: "#ff9800", label: "Busy" },
  offline: { color: "#9e9e9e", label: "Offline" },
};

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Workers() {
  const [workers, setWorkers] = useState<WorkerResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchWorkers = useCallback(async () => {
    try {
      const data = await getWorkers();
      setWorkers(data);
      setError("");
    } catch {
      setError("Failed to load workers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 10000);
    return () => clearInterval(interval);
  }, [fetchWorkers]);

  const sorted = [...workers].sort((a, b) => {
    const order: Record<string, number> = {
      "online-busy": 0,
      "online-idle": 1,
      offline: 2,
    };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });

  const onlineCount = workers.filter((w) => w.status !== "offline").length;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, mb: 3 }}>
        <Typography variant="h4">Workers</Typography>
        <Typography variant="body2" color="text.secondary">
          {onlineCount} online / {workers.length} total
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && workers.length === 0 && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      <Grid container spacing={2}>
        {sorted.map((worker) => (
          <Grid key={worker.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <WorkerCard worker={worker} />
          </Grid>
        ))}
      </Grid>

      {!loading && workers.length === 0 && (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <Typography color="text.secondary">
            No workers registered.
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function WorkerCard({ worker }: { worker: WorkerResponse }) {
  const cfg = STATUS_CONFIG[worker.status];

  return (
    <Card>
      <CardContent>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mb: 1.5,
          }}
        >
          <Typography variant="h6" noWrap sx={{ flex: 1, mr: 1 }}>
            {worker.friendly_name}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Circle sx={{ fontSize: 10, color: cfg.color }} />
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, color: cfg.color }}
            >
              {cfg.label}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          <InfoRow
            icon={<Computer sx={{ fontSize: 16 }} />}
            label={worker.hostname}
            secondary={worker.ip_address}
          />
          <InfoRow
            icon={<Timer sx={{ fontSize: 16 }} />}
            label={`Heartbeat ${timeAgo(worker.last_heartbeat)}`}
          />
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
            }}
          >
            <Circle
              sx={{
                fontSize: 8,
                color: worker.comfyui_running ? "#4caf50" : "#9e9e9e",
                ml: 0.25,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              ComfyUI {worker.comfyui_running ? "running" : "stopped"}
            </Typography>
          </Box>
        </Box>

        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{ mt: 1.5, pt: 1, borderTop: "1px solid", borderColor: "divider" }}
        >
          Registered {formatDate(worker.registered_at)}
        </Typography>
      </CardContent>
    </Card>
  );
}

function InfoRow({
  icon,
  label,
  secondary,
}: {
  icon: React.ReactNode;
  label: string;
  secondary?: string;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
      <Box sx={{ color: "text.secondary", display: "flex" }}>{icon}</Box>
      <Typography variant="body2">{label}</Typography>
      {secondary && (
        <Typography variant="body2" color="text.secondary">
          ({secondary})
        </Typography>
      )}
    </Box>
  );
}
