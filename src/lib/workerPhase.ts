import type { WorkerPhase } from "../api/types";

/**
 * What a worker is doing right now, when that is something other than "ready"
 * (wanly-gpu-daemon#189).
 *
 * A busy worker must never look offline. On 2026-10-12 3090a read "Offline" for 10+ minutes
 * while it downloaded a 650 MB LoRA after a mode switch, and a training run waited behind it
 * with nothing on the page saying why. The worker now reports a phase on every heartbeat and
 * this turns it into the status the card shows in place of Idle / Busy / Offline.
 *
 * Null when there is nothing to say: no phase (an older worker or API), `ready`, or an
 * OFFLINE row -- a worker that stopped heartbeating is not "syncing" any more, whatever it
 * last said; that case gets `lastPhaseNote` instead.
 */
export interface PhaseStatus {
  color: string;
  label: string;
  /** The worker's own sentence: file, MB, rate, ETA, files left; or "starting comfyui". */
  detail: string;
  /** 0-100 when the phase carries byte progress, else null. */
  pct: number | null;
}

export const PHASE_COLOR = "#0288d1";

const LABELS: Record<string, string> = {
  booting: "Booting",
  switching_mode: "Switching mode",
  syncing_loras: "Syncing LoRAs",
  fetching_lora: "Fetching LoRA",
};

function isActive(phase: WorkerPhase | null | undefined): phase is WorkerPhase {
  return !!phase && !!phase.phase && phase.phase !== "ready";
}

export function phaseStatus(worker: {
  status: string;
  phase?: WorkerPhase | null;
}): PhaseStatus | null {
  const p = worker.phase;
  if (worker.status === "offline" || !isActive(p)) return null;
  let label = LABELS[p.phase] ?? p.phase.replace(/_/g, " ");
  if (p.phase === "switching_mode" && p.from_mode && p.to_mode) {
    label = `Switching ${p.from_mode} → ${p.to_mode}`;
  }
  const total = p.total_bytes ?? 0;
  const pct = total > 0 && p.done_bytes != null
    ? Math.max(0, Math.min(100, Math.round((p.done_bytes / total) * 100)))
    : null;
  return { color: PHASE_COLOR, label, detail: p.detail || label, pct };
}

/** "Last reported: Downloading Payton_v2_final ..." for an offline row whose last word was a
 *  phase -- the honest version: it says what it was doing, not that it still is. */
export function lastPhaseNote(worker: {
  status: string;
  phase?: WorkerPhase | null;
}): string | null {
  const p = worker.phase;
  if (worker.status !== "offline" || !isActive(p)) return null;
  return `Last reported: ${p.detail || LABELS[p.phase] || p.phase}`;
}
