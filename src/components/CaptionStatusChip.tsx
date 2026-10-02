import { useState } from "react";
import { Chip, CircularProgress, Stack, Tooltip } from "@mui/material";

import { requestImageDescribe } from "../api/client";
import { ltxError } from "../api/ltx";
import {
  CAPTION_HALVES, type CaptionHalfName, captionLabel, captionTooltip,
} from "../lib/captionStatus";
import {
  noteCaptionTicket, refreshCaptionStatus, useCaptionStatus, useCaptionStore,
} from "../stores/captionStore";

/**
 * "Scene: In queue (#3)" / "Motion: Captioning…" / "Scene: Failed: retry" for one image,
 * wherever it is shown (console#564) -- one pill PER HALF (console#590). Nothing at all for a
 * half with no caption in flight or failed.
 *
 * THE ONE INDICATOR of a caption in progress. A view does not add a spinner line or relabel
 * its button "Describing…" beside it (console#590): the button only disables while its half
 * is in flight, and "it carries on if you close this" is in the pill's tooltip.
 *
 * Reads the shared caption store (one poll for the whole page), so it costs no request of
 * its own and says the same thing in every view. "Failed: retry" asks for THAT HALF again --
 * the same describe the modal's button makes.
 *
 * `half` picks one; without it both are shown (scene first), stacked when `overlay`.
 * `overlay` pins them to a bottom corner of a thumbnail (the parent must be position:
 * relative); clicks on them never reach the thumbnail underneath.
 *
 * `includeDatasetCaptions`: also show a dataset's TRAINING caption of this image while it is
 * in line (Datasets). Elsewhere those are not "this image's caption" -- they write the set's
 * caption, not the image's description -- so they are left out.
 */
export default function CaptionStatusChip({
  path, half, overlay = false, corner = "left", size = "small", includeDatasetCaptions = false,
}: {
  path: string | null | undefined;
  half?: CaptionHalfName;
  overlay?: boolean;
  corner?: "left" | "right";
  size?: "small" | "medium";
  includeDatasetCaptions?: boolean;
}) {
  const halves = half ? [half] : CAPTION_HALVES;
  const training = useCaptionStore((s) => (includeDatasetCaptions && path
    ? s.queue?.entries?.find((e) => e.path === path && e.kind === "dataset")
    : undefined));
  if (!path) return null;
  const chips = halves.map((h) => (
    <HalfChip key={h} path={path} half={h} overlay={overlay} size={size} />
  ));
  if (training) {
    const running = training.status === "running";
    chips.push(
      <Tooltip key="training" title="This image's training caption is being made for the dataset">
        <Chip
          size={size} color="info" variant="outlined"
          label={running ? "Training caption: Captioning…"
            : `Training caption: In queue (#${training.position})`}
          icon={running ? <CircularProgress size={10} sx={{ ml: 0.75 }} /> : undefined}
          onClick={overlay ? (e) => e.stopPropagation() : undefined}
          sx={overlay ? OVERLAY_CHIP : undefined}
        />
      </Tooltip>,
    );
  }
  if (!overlay) {
    return <>{chips}</>;
  }
  return (
    <Stack
      spacing={0.5} alignItems={corner === "left" ? "flex-start" : "flex-end"}
      sx={{
        position: "absolute", [corner]: 4, bottom: 4, zIndex: 2, maxWidth: "calc(100% - 8px)",
        pointerEvents: "none", "& > *": { pointerEvents: "auto" },
      }}
    >
      {chips}
    </Stack>
  );
}

const OVERLAY_CHIP = {
  maxWidth: "100%", height: 20, fontSize: 11, bgcolor: "background.paper", opacity: 0.92,
  "& .MuiChip-label": { px: 0.75 },
};

function HalfChip({ path, half, overlay, size }: {
  path: string; half: CaptionHalfName; overlay: boolean; size: "small" | "medium";
}) {
  const status = useCaptionStatus(path, half);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const label = captionLabel(status);
  if (!status || !label) return null;
  const sx = overlay ? OVERLAY_CHIP : undefined;

  const retry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      noteCaptionTicket(await requestImageDescribe(path, { halves: [half] }));
      refreshCaptionStatus();
    } catch (err) {
      setRetryError(ltxError(err));
    } finally {
      setRetrying(false);
    }
  };

  if (status.state === "failed") {
    return (
      <Tooltip title={retryError ?? captionTooltip(status)}>
        <Chip
          size={size} color="error" variant={overlay ? "filled" : "outlined"}
          label={retrying ? `${half === "scene" ? "Scene" : "Motion"}: Retrying…` : label}
          onClick={retry} onMouseDown={(e) => e.stopPropagation()} sx={sx}
        />
      </Tooltip>
    );
  }
  const running = status.state === "running";
  return (
    <Tooltip title={captionTooltip(status)}>
      <Chip
        size={size} color="info" variant="outlined" label={label}
        icon={running ? <CircularProgress size={10} sx={{ ml: 0.75 }} /> : undefined}
        onClick={overlay ? (e) => e.stopPropagation() : undefined}
        sx={sx}
      />
    </Tooltip>
  );
}
