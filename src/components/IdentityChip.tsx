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
            <div>{fmt(mean)} vs start frame — how far this generation drifted</div>
            <div>{fmt(meanRef)} vs identity reference — is it the character</div>
            {drift != null && <div>drift {drift >= 0 ? "+" : ""}{drift.toFixed(3)} over {frames} frames</div>}
            {!!noFace && <div>{noFace} frames with no face detected</div>}
          </>
        }
      >
        <Chip
          size={size}
          color={band(mean)}
          variant="outlined"
          icon={drifting ? <TrendingDownIcon /> : <TrendingFlatIcon />}
          label={`${label ? `${label} ` : ""}${fmt(mean, 2)}`}
          onClick={() => setOpen(true)}
          sx={{ cursor: "pointer" }}
        />
      </Tooltip>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Identity{segment ? ` — segment ${segment.index}` : ""}</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            Two references, because they answer different questions. A low mean with a flat
            line is a weak-identity problem (dataset or LoRA); a good mean with a steep line is
            drift over time. The fixes are different.
          </Typography>

          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell>vs start frame</TableCell>
                <TableCell align="right"><strong>{fmt(mean)}</strong></TableCell>
                <TableCell sx={{ color: "text.secondary" }}>drift of this generation</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>vs identity reference</TableCell>
                <TableCell align="right"><strong>{fmt(meanRef)}</strong></TableCell>
                <TableCell sx={{ color: "text.secondary" }}>is it the character</TableCell>
              </TableRow>
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
