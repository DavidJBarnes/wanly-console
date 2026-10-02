import { useState } from "react";
import { Chip, CircularProgress, Tooltip } from "@mui/material";

import { requestImageDescribe } from "../api/client";
import { ltxError } from "../api/ltx";
import { captionLabel, type ImageCaptionStatus } from "../lib/captionStatus";
import {
  noteCaptionTicket, refreshCaptionStatus, useCaptionStatus, useCaptionStore,
} from "../stores/captionStore";

/**
 * "In caption queue (#3)" / "Captioning…" / "Failed: retry" for one image, wherever it is
 * shown (console#564). Nothing at all when the image has no caption in flight or failed.
 *
 * Reads the shared caption store (one poll for the whole page), so it costs no request of
 * its own and says the same thing in every view. "Failed: retry" asks for the caption again
 * -- the same describe the modal's button makes.
 *
 * `overlay` pins it to a bottom corner of a thumbnail (the parent must be position:
 * relative); clicks on it never reach the thumbnail underneath.
 *
 * `includeDatasetCaptions`: also show a dataset's TRAINING caption of this image while it is
 * in line (Datasets). Elsewhere those are not "this image's caption" -- they write the set's
 * caption, not the image's description -- so they are left out.
 */
export default function CaptionStatusChip({
  path, overlay = false, corner = "left", size = "small", includeDatasetCaptions = false,
}: {
  path: string | null | undefined;
  overlay?: boolean;
  corner?: "left" | "right";
  size?: "small" | "medium";
  includeDatasetCaptions?: boolean;
}) {
  const own = useCaptionStatus(path);
  const training = useCaptionStore((s) => (includeDatasetCaptions && path
    ? s.queue?.entries?.find((e) => e.path === path && e.kind === "dataset")
    : undefined));
  const depth = useCaptionStore((s) => s.queue?.depth ?? 0);
  const status: ImageCaptionStatus | undefined = own ?? (training
    ? {
        state: training.status, position: training.position, depth, error: null,
        busy: false, motionError: null, ticketId: null, finishedAt: null,
      }
    : undefined);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const label = captionLabel(status);
  if (!path || !status || !label) return null;

  const sx = overlay
    ? {
        position: "absolute" as const, [corner]: 4, bottom: 4, zIndex: 2,
        maxWidth: "calc(100% - 8px)",
        height: 20, fontSize: 11, bgcolor: "background.paper", opacity: 0.92,
        "& .MuiChip-label": { px: 0.75 },
      }
    : undefined;

  const retry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      noteCaptionTicket(await requestImageDescribe(path));
      refreshCaptionStatus();
    } catch (err) {
      setRetryError(ltxError(err));
    } finally {
      setRetrying(false);
    }
  };

  if (status.state === "failed") {
    return (
      <Tooltip title={retryError ?? status.error ?? "The caption failed"}>
        <Chip
          size={size} color="error" variant={overlay ? "filled" : "outlined"}
          label={retrying ? "Retrying…" : label} onClick={retry}
          onMouseDown={(e) => e.stopPropagation()} sx={sx}
        />
      </Tooltip>
    );
  }
  const running = status.state === "running";
  return (
    <Tooltip
      title={running
        ? "This image is being captioned now"
        : `Waiting its turn at the captioner -- ${status.depth} in the caption queue`}
    >
      <Chip
        size={size} color="info" variant="outlined" label={label}
        icon={running ? <CircularProgress size={10} sx={{ ml: 0.75 }} /> : undefined}
        onClick={overlay ? (e) => e.stopPropagation() : undefined}
        sx={sx}
      />
    </Tooltip>
  );
}
