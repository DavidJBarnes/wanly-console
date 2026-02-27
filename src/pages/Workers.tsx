import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  Alert,
  IconButton,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Tooltip,
} from "@mui/material";
import {
  Circle,
  Computer,
  Timer,
  DeleteOutline,
  PowerSettingsNew,
  Edit,
} from "@mui/icons-material";
import { getWorkers, deleteWorker, drainWorker, renameWorker } from "../api/client";
import type { WorkerResponse, WorkerStatus } from "../api/types";

const STATUS_CONFIG: Record<WorkerStatus, { color: string; label: string }> = {
  "online-idle": { color: "#4caf50", label: "Idle" },
  "online-busy": { color: "#ff9800", label: "Busy" },
  offline: { color: "#9e9e9e", label: "Offline" },
  draining: { color: "#f57f17", label: "Draining" },
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
  const [deleteConfirm, setDeleteConfirm] = useState<WorkerResponse | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [drainConfirm, setDrainConfirm] = useState<WorkerResponse | null>(null);
  const [draining, setDraining] = useState(false);

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

  const handleDelete = async (worker: WorkerResponse) => {
    setDeleting(true);
    try {
      await deleteWorker(worker.id);
      setDeleteConfirm(null);
      fetchWorkers();
    } catch {
      setError("Failed to delete worker");
    } finally {
      setDeleting(false);
    }
  };

  const handleDrain = async (worker: WorkerResponse) => {
    setDraining(true);
    try {
      await drainWorker(worker.id);
      setDrainConfirm(null);
      fetchWorkers();
    } catch {
      setError("Failed to drain worker");
    } finally {
      setDraining(false);
    }
  };

  const sorted = [...workers].sort((a, b) => {
    const order: Record<string, number> = {
      "online-busy": 0,
      draining: 1,
      "online-idle": 2,
      offline: 3,
    };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });

  const onlineCount = workers.filter(
    (w) => w.status !== "offline",
  ).length;

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
            <WorkerCard
              worker={worker}
              onDelete={setDeleteConfirm}
              onDrain={setDrainConfirm}
              onRenamed={fetchWorkers}
            />
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

      <Dialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete Worker</DialogTitle>
        <DialogContent>
          <Typography>
            Remove <strong>{deleteConfirm?.friendly_name}</strong> from the
            registry? It will re-register on next heartbeat if still running.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!drainConfirm}
        onClose={() => setDrainConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Drain Worker</DialogTitle>
        <DialogContent>
          <Typography>
            Drain <strong>{drainConfirm?.friendly_name}</strong>? It will finish
            its current job and then stop accepting new work.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDrainConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => drainConfirm && handleDrain(drainConfirm)}
            disabled={draining}
          >
            {draining ? "Draining..." : "Drain"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function WorkerCard({
  worker,
  onDelete,
  onDrain,
  onRenamed,
}: {
  worker: WorkerResponse;
  onDelete: (w: WorkerResponse) => void;
  onDrain: (w: WorkerResponse) => void;
  onRenamed: () => void;
}) {
  const cfg = STATUS_CONFIG[worker.status];
  const canDrain = worker.status === "online-idle" || worker.status === "online-busy";
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(worker.friendly_name);

  const handleSave = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === worker.friendly_name) {
      setEditing(false);
      setEditName(worker.friendly_name);
      return;
    }
    try {
      await renameWorker(worker.id, trimmed);
      onRenamed();
    } catch {
      setEditName(worker.friendly_name);
    }
    setEditing(false);
  };

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
          {editing ? (
            <TextField
              size="small"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") {
                  setEditName(worker.friendly_name);
                  setEditing(false);
                }
              }}
              autoFocus
              sx={{ flex: 1, mr: 1 }}
              slotProps={{ htmlInput: { style: { fontSize: "1.25rem", fontWeight: 600 } } }}
            />
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", flex: 1, mr: 1, minWidth: 0 }}>
              <Typography variant="h6" noWrap sx={{ flex: 1 }}>
                {worker.friendly_name}
              </Typography>
              <Tooltip title="Rename worker">
                <IconButton
                  size="small"
                  onClick={() => {
                    setEditName(worker.friendly_name);
                    setEditing(true);
                  }}
                  sx={{ ml: 0.5, color: "text.disabled" }}
                >
                  <Edit sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Circle sx={{ fontSize: 10, color: cfg.color }} />
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, color: cfg.color }}
            >
              {cfg.label}
            </Typography>
            {canDrain && (
              <Tooltip title="Drain worker">
                <IconButton
                  size="small"
                  sx={{ ml: 0.5, color: "#f57f17" }}
                  onClick={() => onDrain(worker)}
                >
                  <PowerSettingsNew fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Delete worker">
              <IconButton
                size="small"
                color="error"
                onClick={() => onDelete(worker)}
                sx={{ ml: 0.5 }}
              >
                <DeleteOutline fontSize="small" />
              </IconButton>
            </Tooltip>
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
