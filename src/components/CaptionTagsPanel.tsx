import { useState } from "react";
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, Snackbar, Stack, Tooltip,
  Typography,
} from "@mui/material";
import { ContentCopy, ExpandMore } from "@mui/icons-material";

import type { TrainingJob } from "../api/types";
import {
  captionTagGroups, FLAG_SHARE, keptRows, promptText, strippedRows, TOP_N, type CaptionTagRow,
} from "../lib/captionTags";

const FLAG_HINT = "learned on the tag, not the trigger — prompt it or strip it";

/**
 * "Tags in captions" on an SDXL run (wanly-api#462): what WD14 named in the captions, so a
 * fixed feature the trigger did NOT learn (Joana's earrings) is visible before it surprises a
 * render. Click a tag to copy it; Copy flagged / Copy all shown give a prompt-ready string.
 * Tags are copied exactly as captioned, underscores and all: that is the token that trained.
 * Renders nothing for a run without a tally (every LTX run).
 */
export default function CaptionTagsPanel({ job }: { job: TrainingJob }) {
  const groups = captionTagGroups(job);
  const [copied, setCopied] = useState<string | null>(null);
  if (!groups) return null;

  const copy = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`Copied: ${text.length > 80 ? `${text.slice(0, 77)}…` : text}`);
    } catch {
      setCopied("Could not copy");
    }
  };

  const perGroup = groups.map((g) => ({ g, kept: keptRows(g), stripped: strippedRows(g) }));
  const flaggedTotal = perGroup.reduce((n, x) => n + x.kept.filter((r) => r.flagged).length, 0);
  const backfilled = job.caption_tags?.source === "backfill";

  const chip = (r: CaptionTagRow) => (
    <Tooltip
      key={r.tag}
      title={`${r.count} image${r.count === 1 ? "" : "s"} (${r.pct}%) — click to copy`
        + (r.flagged ? `. ${FLAG_HINT}` : "")}
    >
      <Chip
        size="small"
        variant={r.flagged ? "filled" : "outlined"}
        color={r.flagged ? "warning" : "default"}
        label={`${r.tag} · ${r.count} (${r.pct}%)`}
        onClick={() => copy(r.tag)}
      />
    </Tooltip>
  );

  return (
    <>
      <Accordion
        disableGutters
        elevation={0}
        sx={{ mt: 1.5, border: 1, borderColor: "divider", "&:before": { display: "none" } }}
      >
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="body2">
            Tags in captions
            {flaggedTotal > 0 && (
              <Typography component="span" variant="body2" color="warning.main">
                {` — ${flaggedTotal} on ≥${Math.round(FLAG_SHARE * 100)}% of images`}
              </Typography>
            )}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
            A tag the caption names is learned onto that tag, not the trigger. Highlighted tags
            are on at least half the images: {FLAG_HINT}.
            {backfilled && " Tallied after training from the run's caption files."}
          </Typography>
          <Stack spacing={2}>
            {perGroup.map(({ g, kept, stripped }, i) => {
              const flagged = kept.filter((r) => r.flagged);
              return (
                <Box key={`${g.label}-${i}`}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ mr: "auto" }}>
                      {g.label}
                      {g.kind && g.kind !== "identity" ? ` (${g.kind})` : ""}
                      <Typography component="span" variant="caption" color="text.secondary">
                        {` · ${g.images} images`}
                      </Typography>
                    </Typography>
                    <Button size="small" startIcon={<ContentCopy fontSize="small" />}
                            disabled={flagged.length === 0}
                            onClick={() => copy(promptText(flagged))}>
                      Copy flagged
                    </Button>
                    <Button size="small" startIcon={<ContentCopy fontSize="small" />}
                            disabled={kept.length === 0}
                            onClick={() => copy(promptText(kept))}>
                      Copy all shown
                    </Button>
                  </Box>
                  {kept.length > 0 ? (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {kept.map((r) => chip(r))}
                    </Box>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      No tags beyond the trigger.
                    </Typography>
                  )}
                  {(g.kept?.length ?? 0) > TOP_N && (
                    <Typography variant="caption" color="text.secondary" component="div">
                      Top {TOP_N} of {g.kept.length}.
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary" component="div"
                              sx={{ mt: 1, mb: 0.5 }}>
                    Baked into the trigger (stripped from the captions)
                  </Typography>
                  {stripped === null ? (
                    <Typography variant="caption" color="text.secondary" fontStyle="italic">
                      Not recorded for this run — it was tallied from its caption files, where
                      a stripped tag leaves no trace.
                    </Typography>
                  ) : stripped.length > 0 ? (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {stripped.map((r) => chip(r))}
                    </Box>
                  ) : (
                    <Typography variant="caption" color="text.secondary">None.</Typography>
                  )}
                </Box>
              );
            })}
          </Stack>
        </AccordionDetails>
      </Accordion>
      <Snackbar
        open={copied !== null}
        autoHideDuration={2000}
        onClose={() => setCopied(null)}
        message={copied ?? ""}
      />
    </>
  );
}
