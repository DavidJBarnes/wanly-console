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

/** Clip length for the shape column.
 *
 * Under LTX the duration is derived, not chosen: 241 frames at 24 fps is
 * 10.041666666666666 seconds, and printing it raw put sixteen decimals in the
 * table. One decimal rather than none, because "nearly 10s" is a real
 * distinction from a clip that is exactly 10s at some other frame rate, and
 * this column exists to compare shapes.
 *
 * Display only — the row key still uses the raw value, so two clip lengths that
 * differ past the decimal cannot collide into one row.
 */
function formatClipSeconds(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

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

  // Segments claimed before the gpu_name column existed, or run by a pod whose worker row has
  // since been deleted, report "unknown". They carry no information about hardware, so they
  // would only pad the table with a row nobody can act on.
  const known = runtimes.filter((r) => r.gpu_name !== "unknown");

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

      <Card>
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
              {known.length > 0 ? (
                known.map((r) => (
                  <TableRow key={`${r.gpu_name}-${r.width}x${r.height}-${r.clip_seconds}`}>
                    <TableCell>{r.gpu_name.replace("NVIDIA GeForce ", "")}</TableCell>
                    <TableCell>
                      {r.width}&times;{r.height} · {formatClipSeconds(r.clip_seconds)}
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
                    No completed segments with a known GPU yet
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
