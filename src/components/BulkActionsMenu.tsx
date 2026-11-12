import { useState } from "react";
import {
  Button, Divider, ListItemIcon, ListItemText, Menu, MenuItem,
} from "@mui/material";
import {
  ArrowDropDown, AutoAwesome, Delete, DriveFileMove, LocalOffer, PhotoLibrary, Refresh,
} from "@mui/icons-material";

/**
 * Everything a multi-image selection can do, behind one button (console#761).
 *
 * The folder view and the filter/untagged view each used to hand-copy a row of buttons, and
 * they drifted: Enhance prompt (console#719) only ever reached one of them. One menu, one list.
 * An action whose handler is omitted is not offered in that view (e.g. Move, which makes no
 * sense for filter results spanning folders).
 */
export default function BulkActionsMenu({
  count, compact, onEnhance, onTag, onDataset, onMove, onDelete,
}: {
  count: number;
  compact?: boolean;
  /** `redo` re-enhances images that already have a prompt instead of skipping them. */
  onEnhance: (redo: boolean) => void;
  onTag: () => void;
  onDataset?: () => void;
  onMove?: () => void;
  onDelete: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const noun = `${count} image${count === 1 ? "" : "s"}`;

  return (
    <>
      <Button
        variant="contained"
        size={compact ? "small" : "medium"}
        endIcon={<ArrowDropDown />}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
      >
        {compact ? `Actions (${count})` : `Actions for ${noun}`}
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        <MenuItem onClick={run(() => onEnhance(false))}>
          <ListItemIcon><AutoAwesome fontSize="small" /></ListItemIcon>
          <ListItemText primary="Enhance prompt" secondary="Skips images that already have one" />
        </MenuItem>
        <MenuItem onClick={run(() => onEnhance(true))}>
          <ListItemIcon><Refresh fontSize="small" /></ListItemIcon>
          <ListItemText primary="Re-enhance prompt" secondary="Replaces existing prompts" />
        </MenuItem>
        <MenuItem onClick={run(onTag)}>
          <ListItemIcon><LocalOffer fontSize="small" /></ListItemIcon>
          <ListItemText primary="Tag…" />
        </MenuItem>
        {onDataset && (
          <MenuItem onClick={run(onDataset)}>
            <ListItemIcon><PhotoLibrary fontSize="small" /></ListItemIcon>
            <ListItemText primary="Add to a dataset…" />
          </MenuItem>
        )}
        {onMove && (
          <MenuItem onClick={run(onMove)}>
            <ListItemIcon><DriveFileMove fontSize="small" /></ListItemIcon>
            <ListItemText primary="Move…" />
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={run(onDelete)} sx={{ color: "error.main" }}>
          <ListItemIcon><Delete fontSize="small" color="error" /></ListItemIcon>
          <ListItemText primary={`Delete ${noun}…`} />
        </MenuItem>
      </Menu>
    </>
  );
}
