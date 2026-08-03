import { useState } from "react";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingFlatIcon from "@mui/icons-material/TrendingFlat";
import type { SegmentResponse, IdentityAggregate } from "../api/types";

/** Cosine bands. ArcFace on buffalo_l: ~0.4 is the same-person threshold, 0.6+ is a solid
 *  match, 0.8+ is strong. These are deliberately not "good/bad" — a profile-heavy clip
 *  legitimately scores lower than a frontal one, so colour is a hint, not a verdict. */
function band(v: number | null | undefined): "success" | "warning" | "error" | "default" {
  if (v == null) return "default";
  if (v >= 0.7) return "success";
  if (v >= 0.5) return "warning";
  return "error";
}

/** Total drift across the clip, which is more readable than a per-frame slope. */
function totalDrift(slope: number | null, frames: number | null): number | null {
  if (slope == null || !frames || frames < 2) return null;
  return slope * (frames - 1);
}

function fmt(v: number | null | undefined, digits = 3): string {
  return v == null ? "—" : v.toFixed(digits);
}

interface Props {
  /** A scored segment, or a job-level aggregate. */
  segment?: SegmentResponse;
  aggregate?: IdentityAggregate | null;
  label?: string;
  size?: "small" | "medium";
}

export default function IdentityChip({ segment, aggregate, label, size = "small" }: Props) {
  const [open, setOpen] = useState(false);

  const mean = segment ? segment.identity_mean_cos : aggregate?.mean_cos ?? null;
  const meanRef = segment ? segment.identity_mean_cos_ref : aggregate?.mean_cos_ref ?? null;

  // HEADLINE THE CUMULATIVE NUMBER, not the per-segment one.
  //
  // "vs start" measures drift within a segment, from ITS OWN first frame. For a
  // continuation that first frame is the previous segment's LAST frame, which has already
  // drifted - so a segment can look internally stable while identity has collapsed since
  // the job began. Observed on a real 2-segment job: seg1 read 0.785 vs start (green,
  // "healthy") while sitting at 0.544 vs the job's original image - visibly a different
  // person. Showing the reassuring number is worse than showing none.
  // For a job badge, headline the worst segment's cumulative score rather than the average:
  // an average over segments hides a late collapse, which is the shape multi-segment drift
  // actually takes.
  // Trajectory against the job's ground truth: seg0 frame 0. Loss is start - end, and a
  // continuation begins where the previous segment ended, so these chain across the job.
  const startRef = segment ? segment.identity_start_cos_ref : aggregate?.start_cos_ref ?? null;
  const endRef = segment ? segment.identity_end_cos_ref : aggregate?.end_cos_ref ?? null;
  const loss = startRef != null && endRef != null ? startRef - endRef : null;

  const cumulative =
    endRef ??
    (aggregate
      ? aggregate.min_cos_ref ?? aggregate.mean_cos_ref ?? aggregate.mean_cos
      : meanRef ?? mean);
  const local = mean;
  const showsBoth = meanRef != null && mean != null && Math.abs(meanRef - mean) > 0.005;
  const slope = segment ? segment.identity_slope : aggregate?.slope ?? null;
  const frames = segment ? segment.identity_frames : aggregate?.frames ?? null;
  const noFace = segment ? segment.identity_no_face : aggregate?.no_face ?? null;

  // Nothing scored — older segments predate the feature. Render nothing rather than a
  // misleading zero.
  if (mean == null && meanRef == null) return null;

  const drift = totalDrift(slope, frames);
  const drifting = drift != null && drift <= -0.02;

  const yawBands = (segment?.identity_metrics as
    | { yaw_bands?: Record<string, { n: number; mean: number; min: number }> }
    | null
    | undefined)?.yaw_bands;

  return (
    <>
      <Tooltip
        title={
          <>
            {startRef != null && endRef != null ? (
              <div>
                <strong>{fmt(startRef)} → {fmt(endRef)}</strong> against segment 0's start
                frame — lost {loss == null ? "—" : loss.toFixed(3)}
              </div>
            ) : (
              <div><strong>{fmt(meanRef)}</strong> against segment 0's start frame (mean)</div>
            )}
            {showsBoth && (
              <div>{fmt(mean)} within this segment only — a continuation starts from the
                previous segment's last frame, so this can look healthy when identity is gone
              </div>
            )}
            {!!noFace && <div>{noFace} frames with no face detected</div>}
          </>
        }
      >
        <Chip
          size={size}
          color={band(cumulative)}
          variant="outlined"
          icon={drifting ? <TrendingDownIcon /> : <TrendingFlatIcon />}
          label={
            startRef != null && endRef != null
              ? `${label ? `${label} ` : ""}${fmt(startRef, 2)}→${fmt(endRef, 2)}`
              : `${label ? `${label} ` : ""}${fmt(cumulative, 2)}${showsBoth ? ` (${fmt(local, 2)})` : ""}`
          }
          onClick={() => setOpen(true)}
          sx={{ cursor: "pointer" }}
        />
      </Tooltip>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Identity{segment ? ` — segment ${segment.index}` : ""}</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            Everything here is measured against <strong>segment 0's start frame</strong> —
            that image defines the character, and nothing else is used. The headline is the
            trajectory: where identity started and where it ended. Judge by the loss.
          </Typography>

          <Table size="small">
            <TableBody>
              {startRef != null && endRef != null && (
                <TableRow>
                  <TableCell>trajectory</TableCell>
                  <TableCell align="right">
                    <strong>{fmt(startRef)} → {fmt(endRef)}</strong>
                  </TableCell>
                  <TableCell sx={{ color: "text.secondary" }}>
                    lost {loss == null ? "—" : loss.toFixed(3)} across this segment
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell>mean vs seg 0 start</TableCell>
                <TableCell align="right">{fmt(meanRef)}</TableCell>
                <TableCell sx={{ color: "text.secondary" }}>
                  averaged over every frame
                </TableCell>
              </TableRow>
              {/* For segment 0 these two are the SAME image, so one number measured twice.
                  Showing both implies two independent readings. */}
              {showsBoth && (
                <TableRow>
                  <TableCell>mean vs own start</TableCell>
                  <TableCell align="right">{fmt(mean)}</TableCell>
                  <TableCell sx={{ color: "text.secondary" }}>
                    within this segment only
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell>drift over clip</TableCell>
                <TableCell align="right">
                  {drift == null ? "—" : `${drift >= 0 ? "+" : ""}${drift.toFixed(3)}`}
                </TableCell>
                <TableCell sx={{ color: "text.secondary" }}>
                  {slope == null ? "" : `${slope.toExponential(2)}/frame`}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>frames</TableCell>
                <TableCell align="right">{frames ?? "—"}</TableCell>
                <TableCell sx={{ color: "text.secondary" }}>
                  {noFace ? `${noFace} with no face detected` : "face found in every frame"}
                </TableCell>
              </TableRow>
              {segment?.identity_face_px_p50 != null && (
                <TableRow>
                  <TableCell>face size (median)</TableCell>
                  <TableCell align="right">{Math.round(segment.identity_face_px_p50)} px</TableCell>
                  <TableCell sx={{ color: "text.secondary" }}>
                    max yaw {segment.identity_yaw_max == null ? "—" : `${Math.round(segment.identity_yaw_max)}°`}
                  </TableCell>
                </TableRow>
              )}
              {aggregate?.min_cos_ref != null && (
                <TableRow>
                  <TableCell>lowest segment</TableCell>
                  <TableCell align="right"><strong>{fmt(aggregate.min_cos_ref)}</strong></TableCell>
                  <TableCell sx={{ color: "text.secondary" }}>
                    segment #{aggregate.min_cos_ref_segment_index} — cumulative low point
                  </TableCell>
                </TableRow>
              )}
              {aggregate?.worst_segment_index != null && (
                <TableRow>
                  <TableCell>worst segment</TableCell>
                  <TableCell align="right">#{aggregate.worst_segment_index}</TableCell>
                  <TableCell sx={{ color: "text.secondary" }}>
                    slope {aggregate.worst_segment_slope?.toExponential(2)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {yawBands && Object.keys(yawBands).length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2">By head angle</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Cosine legitimately falls off with pose, so a low overall mean on a
                profile-heavy clip means something different than on a frontal one.
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>|yaw|</TableCell>
                    <TableCell align="right">frames</TableCell>
                    <TableCell align="right">mean</TableCell>
                    <TableCell align="right">min</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(yawBands).map(([k, v]) => (
                    <TableRow key={k}>
                      <TableCell>{k}°</TableCell>
                      <TableCell align="right">{v.n}</TableCell>
                      <TableCell align="right">{v.mean.toFixed(3)}</TableCell>
                      <TableCell align="right">{v.min.toFixed(3)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
