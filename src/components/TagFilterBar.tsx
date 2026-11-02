import { useEffect } from "react";
import { Box, Button, Typography } from "@mui/material";
import type { TagCount } from "../api/types";
import { isTagSelected } from "../lib/tagFilter";
import { splitByPerson } from "../lib/tagGroups";
import { useTagStore } from "../stores/tagStore";
import TagChip from "./TagChip";
import TagGroupRule from "./TagGroupRule";

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
  // Videos and the Add from repo dialog do not load the vocabulary themselves.
  const { titleTags1, fetchTags } = useTagStore();
  useEffect(() => { if (!titleTags1.length) fetchTags(); }, [titleTags1.length, fetchTags]);

  if (counts.length === 0 && selected.length === 0) return null;

  const [people, other] = splitByPerson(counts, (c) => c.tag, titleTags1);
  const pill = ({ tag, count }: TagCount) => {
    const on = isTagSelected(selected, tag);
    return (
      // A tag that is a character's name shows the character's icon (console#658, #684).
      <TagChip
        key={tag}
        size="small"
        character={tag}
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
  };

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75, mb: 2 }}>
      {people.map(pill)}
      {people.length > 0 && other.length > 0 && <TagGroupRule />}
      {other.map(pill)}
      {selected.length > 0 && (
        <Button size="small" onClick={onClear}>
          Clear
        </Button>
      )}
    </Box>
  );
}
