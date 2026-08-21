import { Box, Button, Chip, Typography } from "@mui/material";
import type { TagCount } from "../api/types";
import { isTagSelected } from "../lib/tagFilter";

interface Props {
  counts: TagCount[];
  selected: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
}

/**
 * The tag pills above a filtered grid — the Image Repo and Videos both use them. Clicking
 * narrows; every selection ANDs.
 *
 * Counts come from the API scoped to the CURRENT filter, which is what makes this navigable
 * rather than a guessing game: with Kelly selected, the pills left standing are the tags that
 * actually co-occur with Kelly, and a combination with nothing in it simply is not offered. A
 * selected tag always survives that filter (its count is the result count), so it can be clicked
 * off again.
 *
 * The list is what is USED, not the title_tags vocabulary. Production has drifted -- kellyteacher
 * is on 76 images and is not in the vocabulary -- and pills built from the vocabulary would
 * strand them. It also puts the fat-fingers ("pusy", "cowgirlowgirl", one image each) on screen
 * with their counts, which is the only way they will ever get cleaned up.
 *
 * Presentational on purpose: the caller owns where the counts come from and where the selection
 * is stored, so the same row serves images (/images/tag-counts) and videos (/jobs/tag-counts).
 */
export default function TagFilterBar({ counts, selected, onToggle, onClear }: Props) {
  if (counts.length === 0 && selected.length === 0) return null;

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75, mb: 2 }}>
      {counts.map(({ tag, count }) => {
        const on = isTagSelected(selected, tag);
        return (
          <Chip
            key={tag}
            size="small"
            label={
              <Box component="span" sx={{ display: "inline-flex", gap: 0.5 }}>
                <span>{tag}</span>
                <Typography component="span" variant="caption" sx={{ opacity: 0.7 }}>
                  {count}
                </Typography>
              </Box>
            }
            onClick={() => onToggle(tag)}
            color={on ? "primary" : "default"}
            variant={on ? "filled" : "outlined"}
            sx={{ cursor: "pointer" }}
          />
        );
      })}
      {selected.length > 0 && (
        <Button size="small" onClick={onClear}>
          Clear
        </Button>
      )}
    </Box>
  );
}
