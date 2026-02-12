import { useEffect, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import {
  Groups,
  PlayArrow,
  HourglassEmpty,
  QuestionAnswer,
  ErrorOutline,
  Timer,
  Movie,
  CheckCircle,
} from "@mui/icons-material";
import { getStats, getWorkers } from "../api/client";
import type { StatsResponse, WorkerResponse } from "../api/types";

function formatRunTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function formatVideoTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  }
  return `${m}m ${s}s`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface StatCardProps {
  label: string;
  value: string | number;
  color: string;
  icon: React.ReactNode;
}

function StatCard({ label, value, color, icon }: StatCardProps) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, py: 2 }}>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 2,
            bgcolor: `${color}18`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [workers, setWorkers] = useState<WorkerResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getStats(), getWorkers()])
      .then(([s, w]) => {
        setStats(s);
        setWorkers(w);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    const interval = setInterval(() => {
      Promise.all([getStats(), getWorkers()])
        .then(([s, w]) => {
          setStats(s);
          setWorkers(w);
        })
        .catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Box sx={{ textAlign: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const onlineWorkers = workers.filter((w) => w.status !== "offline").length;
  const runningSegments =
    (stats?.segments_by_status.processing ?? 0) + (stats?.segments_by_status.claimed ?? 0);
  const pendingJobs = stats?.jobs_by_status.pending ?? 0;
  const awaitingJobs = stats?.jobs_by_status.awaiting ?? 0;
  const failedSegments = stats?.segments_by_status.failed ?? 0;
  const avgRunTime = stats?.avg_segment_run_time;
  const totalVideoTime = stats?.total_video_time ?? 0;
  const totalCompleted = stats?.total_segments_completed ?? 0;

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Dashboard
      </Typography>

      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            label="Workers Online"
            value={onlineWorkers}
            color="#4caf50"
            icon={<Groups />}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            label="Running Segments"
            value={runningSegments}
            color="#2196f3"
            icon={<PlayArrow />}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            label="Pending Jobs"
            value={pendingJobs}
            color="#e91e63"
            icon={<HourglassEmpty />}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            label="Awaiting Prompt"
            value={awaitingJobs}
            color="#00bcd4"
            icon={<QuestionAnswer />}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            label="Failed Segments"
            value={failedSegments}
            color="#f44336"
            icon={<ErrorOutline />}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            label="Avg Run Time"
            value={avgRunTime != null ? formatRunTime(avgRunTime) : "-"}
            color="#ff9800"
            icon={<Timer />}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            label="Total Video Time"
            value={formatVideoTime(totalVideoTime)}
            color="#9c27b0"
            icon={<Movie />}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            label="Total Completed"
            value={totalCompleted}
            color="#4caf50"
            icon={<CheckCircle />}
          />
        </Grid>
      </Grid>

      <Typography variant="h6" sx={{ mb: 2 }}>
        Worker Performance
      </Typography>
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Worker</TableCell>
                <TableCell align="right">Segments</TableCell>
                <TableCell align="right">Avg Run Time</TableCell>
                <TableCell align="right">Last Active</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {stats?.worker_stats && stats.worker_stats.length > 0 ? (
                stats.worker_stats.map((w) => (
                  <TableRow key={w.worker_name}>
                    <TableCell>{w.worker_name}</TableCell>
                    <TableCell align="right">{w.segments_completed}</TableCell>
                    <TableCell align="right">{formatRunTime(w.avg_run_time)}</TableCell>
                    <TableCell align="right">
                      {w.last_seen ? timeAgo(w.last_seen) : "-"}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} sx={{ textAlign: "center", color: "text.secondary" }}>
                    No worker data yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
}
