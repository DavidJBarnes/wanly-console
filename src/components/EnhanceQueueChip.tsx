import { useState } from "react";
import { Chip, CircularProgress, Menu, MenuItem, Tooltip } from "@mui/material";

import { clearEnhanceQueue, queueEnhance } from "../api/client";
import { useEnhanceQueue, useEnhanceStore } from "../stores/enhanceStore";

/** The enhancer's queue, wherever you are on the page (console#719). Silent when idle. */
export default function EnhanceQueueChip() {
  const q = useEnhanceQueue();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  if (!q || (q.waiting.length === 0 && q.failed.length === 0)) return null;

  const apply = useEnhanceStore.getState().apply;
  const close = () => setAnchor(null);
  const failed = q.failed.length;
  const name = q.running?.split("/").pop();
  const label = [
    q.waiting.length ? `Enhancing ${q.waiting.length}` : "",
    failed ? `${failed} failed` : "",
  ].filter(Boolean).join(", ");

  return (
    <>
      <Tooltip title={name ? `Enhancing ${name}` : q.waiting.length ? "Waiting for the enhancer" : "Enhance prompt failed"}>
        <Chip
          size="small"
          icon={q.waiting.length ? <CircularProgress size={12} sx={{ ml: 0.75 }} /> : undefined}
          label={label}
          color={failed ? "warning" : "default"}
          variant="outlined"
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ fontWeight: 600 }}
        />
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        {failed > 0 && (
          <MenuItem
            onClick={() => {
              close();
              void queueEnhance(q.failed.map((f) => f.path), true).then((r) => apply(r.status));
            }}
          >
            Retry {failed} failed
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            close();
            void clearEnhanceQueue().then(apply);
          }}
        >
          {q.waiting.length ? "Cancel the queue" : "Dismiss"}
        </MenuItem>
      </Menu>
    </>
  );
}
