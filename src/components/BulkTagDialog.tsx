import { useState } from "react";
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  TextField, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";

import { ltxError } from "../api/ltx";
import { bulkUpdateImageTags, type BulkTagResult } from "../api/client";
import type { TagCount } from "../api/types";
import { useTagStore } from "../stores/tagStore";

/**
 * Tag many selected images at once (console#517).
 *
 * The same tag string is applied to every selection; the server merges or strips it per
 * image and dedupes case/space variants, so typing "Kelly" over images that already carry
 * "kelly " is safe. A refusal (500-char overflow) writes nothing at all, which is why the
 * error stays in the dialog rather than becoming a partial-success snackbar.
 */
export default function BulkTagDialog({
  imageUris, tagCounts, onClose, onDone,
}: {
  imageUris: string[];
  tagCounts: TagCount[];
  onClose: () => void;
  onDone: (mode: "add" | "remove", results: BulkTagResult[]) => void;
}) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { titleTags1, titleTags2 } = useTagStore();

  const words = tags.split(",").map((t) => t.trim()).filter(Boolean);

  const apply = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await bulkUpdateImageTags(imageUris, words.join(", "), mode);
      onDone(mode, res.results);
      onClose();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      if (detail && typeof detail === "object" && !Array.isArray(detail)) {
        const { message, paths } = detail as { message?: string; paths?: string[] };
        setError(`${message ?? "Refused"} (${paths?.length ?? 0} image${(paths?.length ?? 0) === 1 ? "" : "s"})`);
      } else {
        setError(ltxError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const appendTag = (name: string) => {
    const current = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (!current.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setTags([...current, name].join(", "));
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {mode === "add" ? "Add" : "Remove"} tags on {imageUris.length} image{imageUris.length === 1 ? "" : "s"}
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <ToggleButtonGroup
          value={mode}
          exclusive
          size="small"
          onChange={(_, next) => next && setMode(next)}
          sx={{ mb: 2 }}
        >
          <ToggleButton value="add">Add</ToggleButton>
          <ToggleButton value="remove">Remove</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          size="small"
          fullWidth
          autoFocus
          label="Tags (comma separated)"
          placeholder="Kelly, Missionary"
          value={tags}
          disabled={busy}
          onChange={(e) => setTags(e.target.value)}
        />
        {words.length > 0 && (
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1 }}>
            {words.map((t, i) => (
              <Chip key={`${t}-${i}`} label={t} size="small"
                onDelete={() => setTags(words.filter((_, j) => j !== i).join(", "))} />
            ))}
          </Box>
        )}
        {mode === "remove" && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            Removes whole-tag matches only — removing “Kelly” leaves “KellyTeacher” alone.
            Scene descriptions on the images are never touched.
          </Typography>
        )}
        {(titleTags1.length > 0 || titleTags2.length > 0) && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">Vocabulary</Typography>
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
              {[...titleTags1, ...titleTags2].map((tag) => (
                <Chip key={tag.id} label={tag.name} size="small" variant="outlined"
                  disabled={busy} onClick={() => appendTag(tag.name)} />
              ))}
            </Box>
          </Box>
        )}
        {tagCounts.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary">In use</Typography>
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
              {tagCounts.slice(0, 30).map((tc) => (
                <Chip key={tc.tag} label={tc.tag} size="small"
                  disabled={busy} onClick={() => appendTag(tc.tag)} />
              ))}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={apply} disabled={busy || words.length === 0}>
          {mode === "add" ? "Add" : "Remove"} on {imageUris.length}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
