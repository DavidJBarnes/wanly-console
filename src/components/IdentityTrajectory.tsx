import { Box, Chip, Stack, Typography, useTheme } from "@mui/material";
import { DIP_THRESHOLD, TAIL, median } from "../lib/identityHelpers";
import { buildTracks, type Track } from "../lib/trajectorySeries";

/** The four axes a clip is judged on, over time, on one chart.
 *
 *  Start and end alone cannot tell a clip that decayed steadily from one that held and then
 *  dipped on the final frames. Those produce identical headline numbers and call for opposite
 *  fixes — and it matters beyond display, because the next segment is seeded from the LAST
 *  frame. A blink or motion blur there propagates into everything that follows.
 *
 *  All four together because they trade against each other: high motion with a dead face,
 *  or identity held while detail collapses, are the failures that any single axis misses. */

interface Props {
  metrics: Record<string, unknown> | null | undefined;
}

const W = 600;
const H = 130;

export default function IdentityTrajectory({ metrics }: Props) {
  const theme = useTheme();
  const tracks = buildTracks(metrics);
  const identity = tracks.find((t) => t.key === "identity");
  if (tracks.length === 0) return null;

  const colours: Record<Track["key"], string> = {
    identity: theme.palette.primary.main,
    expression: theme.palette.secondary.main,
    motion: theme.palette.warning.main,
    detail: theme.palette.success.main,
  };

  const stride = (metrics?.stride as number | undefined) ?? 1;
  // Older clips measured identity against the segment's own start frame, which on a
  // continuation is the already-drifted last frame. Say which, rather than letting the two be
  // read as the same number.
  const vsGroundTruth = (metrics?.series_ref as string | undefined) === "ground_truth";

  // Dip detection stays on identity alone: it exists to decide whether the seed frame for the
  // NEXT segment is representative, and that is an identity question.
  const s = identity?.raw ?? [];
  const end = s.length ? s[s.length - 1] : null;
  const body = s.slice(-TAIL, -2);
  const bodyMedian = body.length >= 4 ? median(body) : null;
  const dip = bodyMedian != null && end != null ? bodyMedian - end : null;
  const isDip = dip != null && dip >= DIP_THRESHOLD;

  const path = (t: Track) =>
    t.points
      .map((v, i) => `${((i / (t.points.length - 1)) * W).toFixed(1)},${(H - v * H).toFixed(1)}`)
      .join(" ");

  return (
    <Box sx={{ mt: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ mr: 1 }}>
          Per-frame trajectory
        </Typography>
        {tracks.map((t) => (
          <Chip
            key={t.key}
            size="small"
            variant="outlined"
            sx={{ borderColor: colours[t.key], color: colours[t.key] }}
            label={`${t.label} ${t.min.toFixed(t.precision)}–${t.max.toFixed(t.precision)}`}
          />
        ))}
      </Stack>

      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1, overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: H, display: "block" }}
        >
          {tracks.map((t) => (
            <polyline
              key={t.key}
              points={path(t)}
              fill="none"
              stroke={colours[t.key]}
              strokeWidth={t.key === "identity" ? 1.8 : 1.1}
              // The non-identity axes sit behind, so the line that drives the seeding decision
              // stays readable when all four overlap.
              opacity={t.key === "identity" ? 1 : 0.65}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {identity && end != null && (
            <circle
              cx={W}
              cy={H - identity.points[identity.points.length - 1] * H}
              r={3.5}
              fill={isDip ? theme.palette.error.main : theme.palette.success.main}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        Lines are rolling means, each normalised to its own range — the chart shows <em>when</em>{" "}
        something moved; the ranges above are the raw per-frame extremes and carry{" "}
        <em>how much</em>. Identity is measured against{" "}
        {vsGroundTruth ? "segment 0's start frame" : "this segment's own start frame"}
        {stride > 1 && `, sampled every ${stride} frames`}.
      </Typography>

      {isDip && (
        <Typography variant="caption" component="div" color="error.main" sx={{ mt: 1 }}>
          <strong>The final frame is a dip, not the settled state</strong> — tail median{" "}
          {bodyMedian!.toFixed(3)} vs {end!.toFixed(3)} ending. The next segment seeds from that
          frame, so this propagates.
        </Typography>
      )}
    </Box>
  );
}
