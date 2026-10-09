import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { ArrowForward, Close } from "@mui/icons-material";

import { getFileUrl } from "../api/client";
import type { FaceFix } from "../lib/faceFixes";
import { fixKindLabel, fixSizeLabel } from "../lib/faceFixes";
import { SMALL_FACE_PX } from "../lib/faceSize";

/**
 * The dataset card's "Fixes" view (wanly-console#642): every "Fix small faces" result beside
 * the photo it was made from, to check the crops at a glance -- the right person, both people
 * in a pair, nobody cut off -- with the result's remove (×) right there, so a bad crop goes in
 * one click. Display only: nothing here is a file, so nothing here is trained on.
 *
 * Thumbnails are `loading="lazy"` like the grid's (wanly-api#434): a set with forty fixes must
 * not fire eighty /files at once when the view opens.
 */
export default function FaceFixesView({
  fixes, pair, tile, busy, locked, onRemove,
}: {
  fixes: FaceFix[];
  pair: boolean;
  tile: number;
  busy: boolean;
  /** The set's read-only reason, or null: the × is off with this as its tooltip. */
  locked: string | null;
  onRemove: (uri: string) => void;
}) {
  const thumb = (uri: string, ring: string, title: string) => (
    // A link, as in the grid: middle-click and "open in new tab" work.
    <Box component="a" href={getFileUrl(uri)} target="_blank" rel="noopener noreferrer"
         title={title} sx={{ display: "block", cursor: "zoom-in" }}>
      <Box
        component="img" loading="lazy"
        src={getFileUrl(uri)}
        sx={{
          width: tile, height: tile, objectFit: "cover", borderRadius: 1,
          display: "block", border: "3px solid", borderColor: ring,
        }}
      />
    </Box>
  );

  return (
    <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap", mt: 2 }}>
      {fixes.map((f) => {
        // A result still under the line (or a pair crop that lost a face) did not help: red,
        // so it is the first thing the eye lands on.
        const stillSmall = f.afterPx === null || f.afterPx < SMALL_FACE_PX;
        return (
          <Box key={f.result}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Box sx={{ width: tile }}>
                {thumb(f.original, "divider", f.originalInSet
                  ? "The original — open full size in a new tab"
                  : "The original, no longer in the set (kept in S3) — open full size")}
                <Typography variant="caption" color="text.secondary" align="center"
                            sx={{ display: "block", lineHeight: 1.6 }}>
                  {f.originalInSet ? "original" : "original (not in set)"}
                </Typography>
              </Box>
              <ArrowForward fontSize="small" color="action" sx={{ mb: 2.5 }} />
              <Box sx={{ width: tile }}>
                <Box sx={{ position: "relative", width: tile, height: tile }}>
                  {thumb(f.result, stillSmall ? "error.main" : "success.main",
                    "The result — open full size in a new tab")}
                  {/* The same remove as the grid's: no confirm, the file stays in the bucket. */}
                  <Tooltip title={locked ?? (f.kind === "upscale"
                    ? "Remove from the dataset (its original is not in the set either)"
                    : "Remove this crop from the dataset; the photo counts as small again")}>
                    <Box component="span" sx={{ position: "absolute", top: 4, right: 4 }}>
                      <IconButton
                        size="small"
                        aria-label={`Remove ${f.result.split("/").pop()}`}
                        disabled={busy || Boolean(locked)}
                        onClick={() => onRemove(f.result)}
                        sx={{
                          bgcolor: "rgba(255,255,255,0.9)", boxShadow: 1,
                          "&:hover": { bgcolor: "error.main", color: "error.contrastText" },
                          "&.Mui-disabled": { bgcolor: "rgba(255,255,255,0.6)" },
                        }}
                      >
                        <Close sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Box>
                  </Tooltip>
                </Box>
                <Typography variant="caption" color="text.secondary" align="center"
                            sx={{ display: "block", lineHeight: 1.6 }}>
                  {fixKindLabel(f, pair)}
                </Typography>
              </Box>
            </Box>
            <Tooltip title={f.beforeUnknown
              ? "Face size at training size. The original's measurement was not kept when it was upscaled in place."
              : `Face size at training size${pair ? " (the smaller of the two faces)" : ""}, before → after.`}>
              <Typography variant="caption" align="center"
                          color={stillSmall ? "error.main" : "success.main"}
                          sx={{ display: "block", fontWeight: 500 }}>
                {fixSizeLabel(f, pair)}
              </Typography>
            </Tooltip>
          </Box>
        );
      })}
    </Box>
  );
}
