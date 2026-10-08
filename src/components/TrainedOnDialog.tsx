import { useEffect, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Stack, Tooltip, Typography,
} from "@mui/material";
import { getFileUrl, getTrainedOn } from "../api/client";
import type { TrainedOn, TrainedOnGroup } from "../api/types";
import { isClip } from "../lib/datasets";
import { apiErrorText } from "../lib/trainingJob";
import { diffSummary, groupTitle } from "../lib/trainedOn";

const THUMB = 88;

/**
 * What a run trained on (wanly-api#422): every group's images and captions exactly as trained,
 * and how each dataset differs now.
 *
 * THE RUN IS THE RECORD (wanly-api#419). A dataset stays the subject's living set after it
 * trains, so "which images were in v2" is answered here, not on the Datasets page. An image
 * removed from the set since is still shown -- faded and marked -- because v2 learned from it.
 */
export default function TrainedOnDialog({ jobId, title, onClose }: {
  jobId: string;
  title: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<TrainedOn | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    getTrainedOn(jobId)
      .then((d) => { if (live) setData(d); })
      .catch((e: unknown) => { if (live) setError(apiErrorText(e, "could not load it")); });
    return () => { live = false; };
  }, [jobId]);

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{title} — trained on</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="warning">{error}</Alert>}
        {!data && !error && <CircularProgress size={22} />}
        <Stack spacing={3}>
          {data?.groups.map((g) => <Group key={g.group_index} g={g} />)}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function Group({ g }: { g: TrainedOnGroup }) {
  const diff = diffSummary(g);
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
        <Typography variant="subtitle1">{groupTitle(g)}</Typography>
        {diff && (
          <Tooltip title="How the dataset differs now. The run trained on exactly the images below.">
            <Chip size="small" variant="outlined" label={diff} />
          </Tooltip>
        )}
      </Box>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        {g.images.map((img) => {
          const gone = img.still_in_dataset === false;
          return (
            <Tooltip key={img.uri}
              title={`${gone ? "Removed from the dataset since. " : ""}${img.caption ?? ""}`}>
              <Box component="a" href={getFileUrl(img.uri)} target="_blank" rel="noopener noreferrer"
                   sx={{ position: "relative", display: "block", opacity: gone ? 0.45 : 1 }}>
                {isClip(img.uri) ? (
                  <Box component="video" src={getFileUrl(img.uri)} muted preload="metadata"
                       sx={{ width: THUMB, height: THUMB, objectFit: "cover", borderRadius: 1,
                             display: "block", bgcolor: "black" }} />
                ) : (
                  <Box component="img" src={getFileUrl(img.uri)} loading="lazy"
                       sx={{ width: THUMB, height: THUMB, objectFit: "cover", borderRadius: 1,
                             display: "block" }} />
                )}
                {gone && (
                  <Chip size="small" label="removed"
                        sx={{ position: "absolute", bottom: 4, left: 4, height: 20,
                              bgcolor: "rgba(255,255,255,0.9)" }} />
                )}
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
}
