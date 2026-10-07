import { useCallback, useEffect, useState } from "react";
import {
  Box, CircularProgress, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import { AutoFixHigh, ModelTraining, Movie, Videocam } from "@mui/icons-material";

import { getWorkerMode, setWorkerMode } from "../api/client";
import { ltxError } from "../api/ltx";
import type { WorkerModeResponse, WorkerResponse } from "../api/types";
import {
  MODE_HELP, MODE_LABEL, MODES, describePending, describeUnload, describeVram, hasSeveralModes,
  modeToSend, modeView, type ModeName,
} from "../lib/workerModes";

/**
 * The box's mode, on the worker card: render, train, motion or edit (wanly-console#589).
 *
 * ONE MODE AT A TIME (wanly-gpu-docker#164). Each mode's model fills most of a 24 GB card --
 * the LTX render stack, the trainer, the 32B motion captioner, Qwen-Image-Edit -- so a box
 * does one of them, and switching is how the card changes hands. The box unloads the old
 * mode, checks the card actually emptied, and only then starts the new one.
 *
 * IT ASKS THE BOX, and does not read a column. The container is the only thing that knows
 * what is actually running -- it can be restarted, or switched by a call that never came
 * through the API -- so a stored copy would be a second answer free to be wrong.
 *
 * A BOX THAT DOES NOT ANSWER RENDERS NOTHING. The row still shows, with its status and its
 * services; it just cannot be switched.
 *
 * A SWITCH IS NOT INSTANT, and that is the design working rather than a delay to hide.
 * Leaving render lets the segment in flight FINISH -- up to ~27 minutes -- so a switch made
 * mid-render costs nothing. The box reports the pending mode until it lands, and this polls
 * for that: "finishing segment, then motion" rather than snapping to a mode the box is not in
 * yet. A training run is never interrupted: the box refuses the switch with the run named,
 * and that text is shown as it is.
 */

/** Can this box be switched at all? Two or more mode services means there is something to
 *  switch between; the box itself then says exactly which modes it can enter. */
export function canSwitchMode(worker: WorkerResponse): boolean {
  return hasSeveralModes(worker.provides);
}

const ICONS: Record<ModeName, typeof Movie> = {
  render: Movie, train: ModelTraining, motion: Videocam, edit: AutoFixHigh,
};

export default function WorkerModeToggle({
  worker, onChanged,
}: {
  worker: WorkerResponse;
  onChanged?: () => void;
}) {
  const [info, setInfo] = useState<WorkerModeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<ModeName | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await getWorkerMode(worker.id);
      setInfo(m);
      return m;
    } catch {
      // Unreachable box. Renders nothing -- see the note above.
      setInfo(null);
      return null;
    }
  }, [worker.id]);

  useEffect(() => {
    if (worker.status === "offline") return;
    void load();
  }, [load, worker.status]);

  const view = info ? modeView(info) : null;
  const pending = view?.pending ?? null;

  // While a switch is running, ask again until it lands. 5s: the wait is dominated by a
  // render finishing, so polling faster only adds requests.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      void load().then((m) => {
        if (m && !(m.pending_mode_name ?? m.pending_mode)) onChanged?.();
      });
    }, 5000);
    return () => clearInterval(t);
  }, [pending, load, onChanged]);

  if (!info || !view || view.available.length < 2) return null;

  const busy = pending !== null || asking !== null;

  const set = async (target: ModeName) => {
    if (busy || target === view.current || !view.available.includes(target)) return;
    setError(null);
    // Optimistic only about the REQUEST, never about the mode: the box decides when it lands.
    setAsking(target);
    try {
      const m = await setWorkerMode(worker.id, modeToSend(target, view.fourModes));
      setInfo((prev) => (prev ? {
        ...prev, mode: m.mode, pending_mode: m.pending_mode,
        mode_name: m.mode_name ?? prev.mode_name,
        pending_mode_name: m.pending_mode_name ?? null, mode_error: null,
      } : prev));
      if (!(m.pending_mode_name ?? m.pending_mode)) onChanged?.();
    } catch (e) {
      // The box's own refusal, passed through by the API verbatim: "training Joana v3 on this
      // box; switch to motion after it finishes" says exactly what to do about it.
      setError(ltxError(e));
    } finally {
      setAsking(null);
    }
  };

  // The box's own report of a switch that failed after the click (the card did not empty,
  // a service would not start) -- it is the only place that failure can surface.
  const shownError = error ?? (pending ? null : info.mode_error);
  const vram = describeVram(info.gpu);
  const unload = describeUnload(info.last_unload);
  const rendering = worker.status === "online-busy";

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 34 }}>
          Mode
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={pending ?? asking ?? view.current}
          sx={{ "& .MuiToggleButton-root": { py: 0.15, px: 1, textTransform: "none" } }}
        >
          {/* EVERY mode is always shown, selected or not. A single chip showing only the
              current state reads as a label among the capability chips beside it. All four
              buttons say, without a tooltip, that this is a choice and what the others are;
              one this box cannot enter is shown disabled with the reason. */}
          {MODES.map((m) => {
            const Icon = ICONS[m];
            const can = view.available.includes(m);
            return (
              <Tooltip key={m} title={can ? MODE_HELP[m] : `${worker.friendly_name} is not equipped for ${m} mode`}>
                <span>
                  <ToggleButton value={m} disabled={busy || !can} onClick={() => void set(m)}>
                    <Icon sx={{ fontSize: 15, mr: 0.5 }} />
                    {MODE_LABEL[m]}
                  </ToggleButton>
                </span>
              </Tooltip>
            );
          })}
        </ToggleButtonGroup>
        {(pending || asking) && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <CircularProgress size={12} />
            <Typography variant="caption" color="text.secondary">
              {pending ? describePending(pending, rendering) : `asking for ${asking}`}
            </Typography>
          </Box>
        )}
        {vram && (
          <Typography variant="caption" color="text.secondary">{vram}</Typography>
        )}
      </Box>
      {shownError && (
        <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.5 }}>
          {shownError}
        </Typography>
      )}
      {unload && !shownError && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
          {unload}
        </Typography>
      )}
    </Box>
  );
}
