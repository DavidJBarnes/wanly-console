import type { ReactNode } from "react";
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography,
} from "@mui/material";

import { getFileUrl } from "../api/client";
import { sheetPanels } from "../lib/characterSheet";

/** A 1536x1024 sheet at any width, with the REAL / GENERATED panels outlined over it (never
 *  burned in -- the saved sheet is exactly what renders condition on). `labels` off gives a
 *  plain thumbnail. Clickable when `onClick` is given. */
export function SheetPreview({
  uri, alt, labels = true, onClick,
}: {
  uri: string;
  alt: string;
  labels?: boolean;
  onClick?: () => void;
}) {
  return (
    <Box onClick={onClick} sx={{
      position: "relative", width: "100%", aspectRatio: "1536 / 1024", bgcolor: "action.hover",
      borderRadius: 1, overflow: "hidden", cursor: onClick ? "zoom-in" : undefined,
    }}>
      <img src={getFileUrl(uri)} alt={alt}
           style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
      {labels && sheetPanels().map((p, i) => (
        <Box key={i} sx={{
          position: "absolute", top: 0, bottom: 0, left: `${p.leftPct}%`, width: `${p.widthPct}%`,
          border: 2, borderColor: p.kind === "real" ? "success.main" : "error.main",
          pointerEvents: "none",
        }}>
          <Typography variant="caption" sx={{
            position: "absolute", left: 4, bottom: 4, px: 0.5, borderRadius: 0.5, lineHeight: 1.3,
            bgcolor: "rgba(255,255,255,0.85)", color: p.kind === "real" ? "success.dark" : "error.dark",
            fontWeight: 700, fontSize: 10,
          }}>
            {p.label} · {p.caption}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/** A saved sheet, big (console#598): what a character renders with, readable at a glance.
 *  `actions` adds buttons beside Full size and Close. */
export function SheetViewerDialog({
  uri, title, subtitle, actions, onClose,
}: {
  uri: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog open fullWidth maxWidth="xl" onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box sx={{ maxWidth: "calc(75vh * 1.5)", mx: "auto" }}>
          <SheetPreview uri={uri} alt={title} />
        </Box>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          {subtitle ?? uri.split("/").pop()}
        </Typography>
      </DialogContent>
      <DialogActions>
        {actions}
        <Box sx={{ flexGrow: 1 }} />
        <Button href={getFileUrl(uri)} target="_blank" rel="noreferrer">Full size</Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
