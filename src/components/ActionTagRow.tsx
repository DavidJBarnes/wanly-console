import { useState } from "react";
import { Box, TextField } from "@mui/material";

import type { TitleTagResponse } from "../api/types";
import TagChip from "./TagChip";

/**
 * An Action tag and its description (wanly-api#486): the short "what happens" prompt Enhance
 * prompt sends to the Sulphur-2 enhancer for an image carrying this tag. Saved when the field
 * loses focus, and only when it changed. The caller keys it on the saved description, so a
 * new one from the server starts the field over rather than being synced into it.
 */
export default function ActionTagRow({ tag, onDelete, onSave }: {
  tag: TitleTagResponse;
  onDelete: () => void;
  onSave: (description: string) => Promise<void>;
}) {
  const saved = tag.description ?? "";
  const [text, setText] = useState(saved);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (text.trim() === saved.trim()) return;
    setError(null);
    onSave(text).catch(() => setError("Not saved -- try again"));
  };

  return (
    <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
      <TagChip label={tag.name} onDelete={onDelete} size="small" sx={{ mt: 0.75, flexShrink: 0 }} />
      <TextField
        size="small"
        fullWidth
        multiline
        maxRows={4}
        placeholder="What happens -- e.g. He thrusts into her with a steady rhythm as her moans build."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        error={Boolean(error)}
        helperText={error ?? undefined}
      />
    </Box>
  );
}
