import { useCallback, useEffect, useState } from "react";
import { Chip, CircularProgress, Tooltip } from "@mui/material";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await getWorkerMode(worker.id);
      setMode(m.mode);
      setError(null);
    } catch {
      // Unreachable box. Stays null, renders nothing -- see the note above.
      setMode(null);
    }
  }, [worker.id]);

  useEffect(() => {
    if (worker.status === "offline") return;
    void load();
  }, [load, worker.status]);

  if (mode === null) return null;

  const captioning = mode === "caption";
  const next = captioning ? "ltx-engine" : "caption";

  const flip = async () => {
    setBusy(true);
    setError(null);
    try {
      const m = await setWorkerMode(worker.id, next);
      setMode(m.mode);
      onChanged?.();
    } catch (e) {
      // The box's own refusal, passed through by the API verbatim -- "MODE=caption leaves
      // nothing to run" is text that says what to do about it.
      setError(ltxError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tooltip
      title={
        error
          ? error
          : captioning
            ? "Captioning. Queued jobs are waiting — click to start rendering them."
            : "Rendering. Click to switch to captions; queued jobs will wait, nothing is lost."
      }
    >
      <Chip
        size="small"
        icon={busy ? undefined : captioning ? <PhotoCamera /> : <Movie />}
        label={busy ? "Switching…" : captioning ? "Captioning" : "Rendering"}
        color={error ? "error" : captioning ? "secondary" : "default"}
        variant={captioning ? "filled" : "outlined"}
        onClick={busy ? undefined : flip}
        onDelete={busy ? () => {} : undefined}
        deleteIcon={busy ? <CircularProgress size={14} /> : undefined}
        sx={{ cursor: busy ? "default" : "pointer" }}
      />
    </Tooltip>
  );
}
