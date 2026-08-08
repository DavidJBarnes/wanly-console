import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Rating,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { annotateSegment, getObservationTags } from "../api/client";
import type { SegmentResponse } from "../api/types";

/**
 * Recording what a human saw in a segment.
 *
 * This exists because the automated metrics cannot rank quality, which we know rather than
 * suspect: on the one controlled pair where both a measurement and a judgement exist, the
 * expression score ranked them backwards. A gaping mouth is the largest landmark excursion a
 * face can make, so the metric scores the very artifact that makes a segment look worse.
 *
 * So the rating is the ranking channel and the tags are labelled ground truth — enough of them
 * turns fixing that metric from guesswork into a fitting problem.
 *
 * Tags come from the server rather than a constant here, so a tag written by this dialog is the
 * same string later analysis groups on.
 */

interface Props {
  open: boolean;
  segment: SegmentResponse | null;
  onClose: () => void;
  onSaved: (updated: SegmentResponse) => void;
}

/** Tags are <location>-<condition>, so the prefix groups them into rows the eye can scan. */
function groupOf(tag: string): string {
  const location = tag.split("-")[0];
  if (["face", "mouth", "teeth", "identity", "eyes", "brows"].includes(location)) return "Face";
  if (["him", "her"].includes(location)) return "Motion";
  return "Body";
}

const GROUP_ORDER = ["Face", "Motion", "Body"];

export default function SegmentObservationDialog({ open, segment, onClose, onSaved }: Props) {
  const [vocabulary, setVocabulary] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload from the segment every time it opens. Keeping stale state across openings would let
  // you overwrite one segment's observations with another's, which is worse than losing them.
  useEffect(() => {
    if (!open || !segment) return;
    setError(null);
    setRating(segment.rating ?? null);
    setNotes(segment.notes ?? "");
    setSelected(new Set((segment.observation_tags ?? "").split(",").filter(Boolean)));
    getObservationTags()
      .then(setVocabulary)
      .catch(() => setError("Could not load the tag vocabulary"));
  }, [open, segment]);

  const toggle = (tag: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(tag)) next.add(tag);
      return next;
    });

  const handleSave = async () => {
    if (!segment) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await annotateSegment(segment.id, {
        // Sent explicitly rather than omitted when empty, so clearing a rating or blanking notes
        // actually clears them — a mistyped observation needs an undo.
        rating,
        notes,
        observation_tags: [...selected],
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const groups = GROUP_ORDER.map((name) => ({
    name,
    tags: vocabulary.filter((t) => groupOf(t) === name),
  })).filter((g) => g.tags.length > 0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Observations — segment {segment ? segment.index : ""}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Overall
            </Typography>
            <Rating
              value={rating}
              onChange={(_, value) => setRating(value)}
              size="large"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              One all-in score — enough to rank the arms of a test. The specifics go in tags.
            </Typography>
          </Box>

          {groups.map((group) => (
            <Box key={group.name}>
              <Typography variant="subtitle2" gutterBottom>
                {group.name}
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {group.tags.map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    size="small"
                    onClick={() => toggle(tag)}
                    color={selected.has(tag) ? "primary" : "default"}
                    variant={selected.has(tag) ? "filled" : "outlined"}
                    sx={{ cursor: "pointer" }}
                  />
                ))}
              </Stack>
            </Box>
          ))}

          <TextField
            label="Notes"
            multiline
            minRows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What did you actually see?"
            fullWidth
          />

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
