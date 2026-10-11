import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink } from "react-router";
import {
  Avatar, Box, Chip, List, ListItemAvatar, ListItemButton, ListItemText, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";

import { listTrainingJobs } from "../api/client";
import type { TrainingJob } from "../api/types";
import { POLL_INTERVAL_FAST } from "../constants";
import { useCharacterIcons } from "../hooks/useCharacterIcons";
import { dateTimeLabel } from "../lib/dateTime";
import { historyRows, isLiveStatus } from "../lib/trainingHistory";
import type { TrainArch } from "../lib/trainingJob";

const STATUS_COLOR: Record<TrainingJob["status"], "default" | "info" | "success" | "error" | "warning"> = {
  pending: "default", claimed: "info", running: "info",
  completed: "success", failed: "error", cancelled: "warning",
};

/**
 * Every LoRA run, SDXL and LTX, newest first (console#664): the right-hand panel of
 * /characters. A row opens the run on its character's page, where its full card is.
 * Polls only while a run is live.
 */
export default function TrainingHistoryPanel() {
  const [jobs, setJobs] = useState<TrainingJob[] | null>(null);
  const [error, setError] = useState(false);
  const [arch, setArch] = useState<TrainArch | "all">("all");
  const icons = useCharacterIcons();

  const load = useCallback(() => {
    listTrainingJobs({ limit: 500 })
      .then((j) => { setJobs(j); setError(false); })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    let live = true;
    listTrainingJobs({ limit: 500 })
      .then((j) => { if (live) { setJobs(j); setError(false); } })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, []);

  const anyLive = (jobs ?? []).some((j) => isLiveStatus(j.status));
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(load, POLL_INTERVAL_FAST);
    return () => clearInterval(t);
  }, [anyLive, load]);

  const rows = historyRows(jobs ?? [], arch);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>Training history</Typography>
        <ToggleButtonGroup size="small" exclusive value={arch}
                           onChange={(_, v) => { if (v) setArch(v); }}>
          <ToggleButton value="all" sx={{ py: 0.25, px: 1 }}>All</ToggleButton>
          <ToggleButton value="sdxl" sx={{ py: 0.25, px: 1 }}>SDXL</ToggleButton>
          <ToggleButton value="ltx" sx={{ py: 0.25, px: 1 }}>LTX</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      {error && (
        <Typography variant="body2" color="warning.main">Could not load training runs.</Typography>
      )}
      {jobs && rows.length === 0 && !error && (
        <Typography variant="body2" color="text.secondary">No runs yet.</Typography>
      )}
      <List dense disablePadding>
        {rows.map((r) => (
          <ListItemButton key={r.id} component={RouterLink} sx={{ px: 0.5, borderRadius: 1 }}
                          to={`/characters/${encodeURIComponent(r.character)}?run=${r.id}`}>
            <ListItemAvatar sx={{ minWidth: 36 }}>
              <Avatar src={icons.get(r.character.toLowerCase())} alt={r.character}
                      imgProps={{ loading: "lazy" }} sx={{ width: 28, height: 28, fontSize: 13 }}>
                {r.character.charAt(0)}
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              primary={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                    {r.character} v{r.version}
                  </Typography>
                  <Chip size="small" variant="outlined" label={r.arch.toUpperCase()}
                        color={r.arch === "sdxl" ? "secondary" : "primary"}
                        sx={{ height: 18, fontSize: 10 }} />
                </Box>
              }
              secondary={
                <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Tooltip title={r.whenKind}>
                    <span>{r.when ? dateTimeLabel(r.when) : "—"}</span>
                  </Tooltip>
                  {r.status !== "completed" && (
                    <Chip size="small" label={r.status} color={STATUS_COLOR[r.status]}
                          sx={{ height: 16, fontSize: 10 }} />
                  )}
                </Box>
              }
              secondaryTypographyProps={{ component: "div", variant: "caption" }}
            />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}
