import { Box, Typography, useTheme } from "@mui/material";
import { DIP_THRESHOLD, TAIL, median } from "../lib/identityHelpers";

/** Per-frame cosine, already stored by the daemon in identity_metrics.series.
 *
 *  WHY THIS EXISTS: start and end alone cannot distinguish a clip that decayed steadily
 *  from one that held and then dipped on the final frames. Those two produce identical
 *  headline numbers and call for opposite fixes — and it matters more than a display
 *  detail, because the daemon seeds the NEXT segment from the LAST frame. If that frame
 *  is a blink or a motion blur, the continuation inherits the worst moment of the clip
 *  and every later segment compounds an artifact that was never really there.
 *
 *  Observed on a real 2-segment job: seg1 read 0.851 -> 0.506 while the fitted slope was
 *  POSITIVE (+3.5e-4/frame). Endpoints falling while the trend rises is exactly the shape
 *  the summary stats cannot express. */


interface Props {
  metrics: Record<string, unknown> | null | undefined;
}

export default function IdentityTrajectory({ metrics }: Props) {
  const theme = useTheme();

  const series = (metrics?.series as number[] | undefined) ?? undefined;
  const stride = (metrics?.stride as number | undefined) ?? 1;
  if (!series || series.length < 8) return null;

  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const span = Math.max(hi - lo, 0.02); // guard a flat clip from dividing by ~0
  const mean = series.reduce((a, b) => a + b, 0) / series.length;

  const W = 600;
  const H = 120;
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / span) * H;
  const points = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  // Is the final frame representative of where the clip actually settled?
  const end = series[series.length - 1];
  const body = series.slice(-TAIL, -2);
  const bodyMedian = body.length >= 4 ? median(body) : null;
  const dip = bodyMedian != null ? bodyMedian - end : null;
  const isDip = dip != null && dip >= DIP_THRESHOLD;

  // If it IS a dip, the fix is to seed the next segment from the best frame in the tail
  // rather than strictly the last one — so show what that frame would have been worth.
  const tail = series.slice(-TAIL);
  const bestTail = Math.max(...tail);
  const bestOffset = tail.length - 1 - tail.lastIndexOf(bestTail);

  const line = theme.palette.mode === "dark" ? theme.palette.primary.light : theme.palette.primary.main;

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">Per-frame trajectory</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        Cosine for every scored frame. The next segment is seeded from the <strong>last</strong>{" "}
        frame, so a dip at the right-hand edge propagates into everything that follows.
        {stride > 1 && ` Sampled every ${stride} frames.`}
      </Typography>

      <Box
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          p: 1,
          overflowX: "auto",
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: 120, display: "block" }}
        >
          {/* the clip's own mean — makes "the end is below typical" visible at a glance */}
          <line
            x1={0}
            x2={W}
            y1={y(mean)}
            y2={y(mean)}
            stroke={theme.palette.text.disabled}
            strokeDasharray="4 4"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={points}
            fill="none"
            stroke={line}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={x(series.length - 1)}
            cy={y(end)}
            r={3}
            fill={isDip ? theme.palette.error.main : theme.palette.success.main}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </Box>

      <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          y-axis {lo.toFixed(3)} – {hi.toFixed(3)} (dashed = mean {mean.toFixed(3)})
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {series.length} samples
        </Typography>
      </Box>

      <Typography
        variant="caption"
        component="div"
        sx={{ mt: 1, fontFamily: "monospace", wordBreak: "break-word" }}
      >
        last {TAIL}: {tail.map((v) => v.toFixed(3)).join("  ")}
      </Typography>

      {isDip ? (
        <Typography variant="caption" component="div" color="error.main" sx={{ mt: 1 }}>
          <strong>The final frame is a dip, not the settled state.</strong> The clip sits around{" "}
          {bodyMedian!.toFixed(3)} through its tail and ends at {end.toFixed(3)} —{" "}
          {dip!.toFixed(3)} lower. The next segment is seeded from that frame. The best frame in
          the last {TAIL} scores {bestTail.toFixed(3)} ({bestOffset} frames from the end), so
          re-anchoring — or seeding from the best tail frame instead of the last — would start the
          continuation {(bestTail - end).toFixed(3)} higher.
        </Typography>
      ) : (
        <Typography variant="caption" component="div" color="text.secondary" sx={{ mt: 1 }}>
          The final frame is consistent with the tail (median {bodyMedian?.toFixed(3) ?? "—"}), so
          the endpoint reflects where the clip actually settled — any loss here is real drift, not
          a bad frame.
        </Typography>
      )}
    </Box>
  );
}
