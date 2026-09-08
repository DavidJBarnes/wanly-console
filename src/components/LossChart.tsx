import { useState } from "react";
import { Box, Typography, useTheme } from "@mui/material";

import type { lossPath } from "../lib/trainingJob";

type Curve = ReturnType<typeof lossPath>;

/**
 * The run's average loss over steps. One series, so no legend: the caption names it.
 *
 * Deliberately small and unadorned -- a 2px line, the min and max as the only two labels,
 * and a crosshair with the exact value on hover. The y-axis is scaled to the data rather
 * than from zero, because a curve going 0.9 -> 0.7 is a flat line on a 0-based axis and
 * the whole point is to see whether it is still moving.
 */
export default function LossChart({
  curve, width, height, lastStep,
}: { curve: Curve; width: number; height: number; lastStep: number | null }) {
  const theme = useTheme();
  const [hover, setHover] = useState<number | null>(null);
  const { points, min, max } = curve;
  if (points.length < 2) return null;
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const h = hover === null ? null : points[hover];
  const line = theme.palette.primary.main;
  const ink = theme.palette.text.secondary;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].x - x) < Math.abs(points[best].x - x)) best = i;
    }
    setHover(best);
  };

  return (
    <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1.5 }}>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          avg loss{lastStep !== null ? ` · to step ${lastStep}` : ""}
          {h ? ` · step ${h.step}: ${h.loss.toFixed(3)}` : ` · ${points[points.length - 1].loss.toFixed(3)} now`}
        </Typography>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: "block", maxWidth: "100%", cursor: "crosshair" }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`average loss from ${max.toFixed(3)} to ${min.toFixed(3)}`}
        >
          <line x1={0} x2={width} y1={height - 4} y2={height - 4} stroke={ink} strokeOpacity={0.25} />
          <path d={d} fill="none" stroke={line} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {h && (
            <>
              <line x1={h.x} x2={h.x} y1={4} y2={height - 4} stroke={ink} strokeOpacity={0.5} strokeDasharray="2 2" />
              <circle cx={h.x} cy={h.y} r={4} fill={line} stroke={theme.palette.background.paper} strokeWidth={2} />
            </>
          )}
        </svg>
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height, py: 0.25 }}>
        <Typography variant="caption" color="text.secondary">{max.toFixed(3)}</Typography>
        <Typography variant="caption" color="text.secondary">{min.toFixed(3)}</Typography>
      </Box>
    </Box>
  );
}
