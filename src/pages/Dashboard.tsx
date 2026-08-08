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
  HourglassEmpty,
  QuestionAnswer,
  Timer,
  Schedule,
} from "@mui/icons-material";
import { getStats, getWorkers, getSegmentRuntimes, type SegmentRuntimeGroup } from "../api/client";
import type { StatsResponse, WorkerResponse } from "../api/types";
import { POLL_INTERVAL_SLOW } from "../constants";

function formatRunTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

/** Longer-form duration for totals that can run to hours. */
function formatLongDuration(seconds: number): string {
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
  const [runtimes, setRuntimes] = useState<SegmentRuntimeGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getStats(), getWorkers()])
      .then(([s, w]) => {
        setStats(s);
        setWorkers(w);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Separate from the main load: this is supplementary, and it should never be able to blank
    // the dashboard if the query is slow or the endpoint is unavailable.
    getSegmentRuntimes()
      .then(setRuntimes)
      .catch(() => setRuntimes([]));

    const interval = setInterval(() => {
      Promise.all([getStats(), getWorkers()])
        .then(([s, w]) => {
          setStats(s);
          setWorkers(w);
        })
        .catch(() => {});
    }, POLL_INTERVAL_SLOW);
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
  const pendingJobs = stats?.jobs_by_status.pending ?? 0;
  const awaitingJobs = stats?.jobs_by_status.awaiting ?? 0;
  const avgRunTime = stats?.avg_segment_run_time_24h;
  const totalQueueTime = stats?.total_queue_time ?? 0;

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
            label="Avg Run Time (last 24 hrs)"
            value={avgRunTime != null ? formatRunTime(avgRunTime) : "-"}
            color="#ff9800"
            icon={<Timer />}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 3 }}>
          <StatCard
            label="Total Queue Time"
            value={formatLongDuration(totalQueueTime)}
            color="#9c27b0"
            icon={<Schedule />}
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

      <Card sx={{ mt: 3 }}>
        <CardContent sx={{ pb: 1 }}>
          <Typography variant="h6">Run time by GPU and shape</Typography>
          <Typography variant="body2" color="text.secondary">
            Grouped by shape as well as GPU — the same card runs 480p/3s in ~5 minutes and
            720&times;1056/5s in ~30, so a combined average would describe nothing.
          </Typography>
        </CardContent>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>GPU</TableCell>
                <TableCell>Shape</TableCell>
                <TableCell align="right">Runs</TableCell>
                <TableCell align="right">Median</TableCell>
                <TableCell align="right">Avg</TableCell>
                <TableCell align="right">Range</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runtimes.length > 0 ? (
                runtimes.map((r) => (
                  <TableRow key={`${r.gpu_name}-${r.width}x${r.height}-${r.clip_seconds}`}>
                    <TableCell>{r.gpu_name.replace("NVIDIA GeForce ", "")}</TableCell>
                    <TableCell>
                      {r.width}&times;{r.height} · {r.clip_seconds}s
                    </TableCell>
                    <TableCell align="right">{r.samples}</TableCell>
                    <TableCell align="right">{formatRunTime(r.median_seconds)}</TableCell>
                    <TableCell align="right" sx={{ color: "text.secondary" }}>
                      {formatRunTime(r.avg_seconds)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: "text.secondary" }}>
                      {formatRunTime(r.min_seconds)}–{formatRunTime(r.max_seconds)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} sx={{ textAlign: "center", color: "text.secondary" }}>
                    No completed segments recorded yet
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
