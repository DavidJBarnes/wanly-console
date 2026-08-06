import { useState } from "react";
import {
  Box,
  Divider,
  IconButton,
  Popover,
  Tooltip,
  Typography,
} from "@mui/material";
import NotesIcon from "@mui/icons-material/Notes";

/**
 * The prompt behind a segment, on demand.
 *
 * The timeline had no way to see it at all, and showing every prompt inline would drown the
 * table -- they run to several sentences each. So: one small button per row.
 *
 * It also shows the TEMPLATE when wildcards were resolved. That is not a detail: the <face>
 * wildcard holds four variants that fire at random on every job, and they are the deformation
 * text that costs roughly 0.13 identity. Without this there is no way to tell after the fact
 * which variant a given segment drew, so two segments of the "same" job can differ for reasons
 * invisible in the UI.
 */

interface Props {
  index: number;
  prompt: string;
  promptTemplate?: string | null;
  negativePrompt?: string | null;
}

export default function SegmentPromptPopover({
  index,
  prompt,
  promptTemplate,
  negativePrompt,
}: Props) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  // Only interesting when the template actually differs — the API stores it unconditionally,
  // so an equal value just means "no wildcards in this prompt".
  const resolvedFromTemplate = !!promptTemplate && promptTemplate !== prompt;

  return (
    <>
      <Tooltip title={resolvedFromTemplate ? "Prompt (wildcards resolved)" : "Prompt"}>
        <IconButton size="small" onClick={(e) => setAnchorEl(e.currentTarget)}>
          <NotesIcon
            fontSize="small"
            // A quiet hint that this row drew from a wildcard, without opening the popover.
            color={resolvedFromTemplate ? "primary" : "inherit"}
          />
        </IconButton>
      </Tooltip>

      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { maxWidth: 560, p: 2 } } }}
      >
        <Typography variant="subtitle2" gutterBottom>
          Segment {index} prompt
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
          {prompt || <em>(empty)</em>}
        </Typography>

        {resolvedFromTemplate && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Template — one of the wildcard's options was chosen at random for this segment
            </Typography>
            <Typography
              variant="body2"
              sx={{ whiteSpace: "pre-wrap", color: "text.secondary", fontStyle: "italic" }}
            >
              {promptTemplate}
            </Typography>
          </>
        )}

        {negativePrompt && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Negative
            </Typography>
            <Box component={Typography} variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
              {negativePrompt}
            </Box>
          </>
        )}
      </Popover>
    </>
  );
}
