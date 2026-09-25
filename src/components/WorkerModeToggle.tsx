import { useCallback, useEffect, useState } from "react";
import {
  Box, CircularProgress, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import { Movie, PhotoCamera } from "@mui/icons-material";

import { getWorkerMode, setWorkerMode } from "../api/client";
import { ltxError } from "../api/ltx";
import type { WorkerResponse } from "../api/types";

/**
 * Render or caption, on the worker card (wanly-gpu-docker#131).
 *
 * THE PROBLEM IT SOLVES. A box that runs both the render stack and the captioner is
 * continuously `online-busy` while a job is queued, and the captioner's busy guard then
 * refuses captions rather than fighting the render for VRAM. So starting a job meant losing
 * captioning until the queue drained. Flipping to caption stops everything that CLAIMS work:
 * queued jobs simply wait, untouched, and the card is the captioner's. Flipping back starts
 * the stack and the backlog goes.
 *
 * IT ASKS THE BOX, and does not read a column. The container is the only thing that knows
 * what is actually running -- it can be restarted, or flipped by a call that never came
 * through the API -- so a stored copy would be a second answer free to be wrong. The cost is
 * one request per card, which is why it is skipped entirely for workers where the question
 * has no meaning (below).
 *
 * A BOX THAT DOES NOT ANSWER RENDERS NOTHING. The row still shows, with its status and its
 * services; it just cannot be flipped. An error chip on every offline worker would be noise
 * on exactly the rows where the operator already knows something is wrong.
 *
 * A SWITCH IS NOT INSTANT, and that is the design working rather than a delay to hide.
 * Stopping the render daemon lets the segment in flight FINISH -- up to ~27 minutes -- so a
 * flip made mid-render costs nothing. The box accepts and reports `pending_mode` until it
 * lands, and this polls for that: the chip says what is happening rather than snapping to a
 * mode the box is not in yet. It also means the flip survives a page reload, because the
 * state lives on the box and not in this component.
 */

/** Can this box be flipped at all?
 *
 * Both halves have to exist: something that claims work to turn off, and something that does
 * not to leave on. A pure render pod has no caption mode and a captions-only box has no
 * render mode -- offering a toggle there is offering a button that can only fail. */
const CLAIMS_WORK = ["ltx-engine", "lora-trainer"];

export function canSwitchMode(worker: WorkerResponse): boolean {
  const provides = worker.provides ?? [];
  if (provides.length === 0) return false;          // never reported; nothing to reason from
  return provides.some((p) => CLAIMS_WORK.includes(p))
    && provides.some((p) => !CLAIMS_WORK.includes(p));
}

export default function WorkerModeToggle({
  worker, onChanged,
}: {
  worker: WorkerResponse;
  onChanged?: () => void;
}) {
  const [mode, setMode] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await getWorkerMode(worker.id);
      setMode(m.mode);
      setPending(m.pending_mode);
      // The box reports why the last switch failed; it failed long after the click, so this
      // is the only way to hear about it at all.
      setError(m.mode_error);
      return m.pending_mode;
    } catch {
      // Unreachable box. Stays null, renders nothing -- see the note above.
      setMode(null);
      return null;
    }
  }, [worker.id]);

  useEffect(() => {
    if (worker.status === "offline") return;
    void load();
  }, [load, worker.status]);

  // While a switch is running, ask again until it lands. 5s: the wait is dominated by a
  // render finishing, so polling faster only adds requests.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      void load().then((still) => {
        if (!still) onChanged?.();
      });
    }, 5000);
    return () => clearInterval(t);
  }, [pending, load, onChanged]);

  if (mode === null) return null;

  const busy = pending !== null;

  const flip = async (next: string) => {
    setError(null);
    // Optimistic only about the REQUEST, never about the mode: the chip goes to "switching"
    // and the box decides when it is done.
    setPending(next);
    try {
      const m = await setWorkerMode(worker.id, next);
      setMode(m.mode);
      setPending(m.pending_mode);
      if (!m.pending_mode) onChanged?.();
    } catch (e) {
      // The box's own refusal, passed through by the API verbatim -- "MODE=caption leaves
      // nothing to run" is text that says what to do about it.
      setError(ltxError(e));
      setPending(null);
    }
  };

  const set = async (target: string) => {
    if (busy || target === mode) return;
    await flip(target);
  };

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 34 }}>
        Mode
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={pending ?? mode}
        sx={{ "& .MuiToggleButton-root": { py: 0.15, px: 1, textTransform: "none" } }}
      >
        {/* BOTH options are always shown, selected or not. A single chip showing only the
            current state reads as a label among the capability chips beside it -- which is
            exactly how "Rendering" next to "trainer" got read as "this box is in trainer
            mode". Two buttons say, without a tooltip, that this is a choice and what the
            other choice is. */}
        <ToggleButton value="ltx-engine" disabled={busy} onClick={() => set("ltx-engine")}>
          <Movie sx={{ fontSize: 15, mr: 0.5 }} />
          Render
        </ToggleButton>
        <ToggleButton value="caption" disabled={busy} onClick={() => set("caption")}>
          <PhotoCamera sx={{ fontSize: 15, mr: 0.5 }} />
          Caption
        </ToggleButton>
      </ToggleButtonGroup>
      {busy && (
        <Tooltip title={
          pending === "caption"
            ? "Switching when the segment in flight finishes — nothing is lost."
            : "Starting the render stack…"
        }>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <CircularProgress size={12} />
            <Typography variant="caption" color="text.secondary">
              {pending === "caption" ? "after current job" : "starting"}
            </Typography>
          </Box>
        </Tooltip>
      )}
      {error && !busy && (
        <Tooltip title={error}>
          <Typography variant="caption" color="error">failed</Typography>
        </Tooltip>
      )}
    </Box>
  );
}
