import type { GpuReservation } from "../api/client";

/**
 * Presenting a pending reservation.
 *
 * A reservation spends money unattended once it fires, so it has to be visible while it waits
 * and cancellable from where it is visible. The countdown is the part that matters: "waiting"
 * says nothing about whether this is about to give up or about to run for another four hours.
 */

/** Whole minutes left, floored at 0 — an expired-but-not-yet-swept row must not show negative. */
export function minutesLeft(reservation: GpuReservation, now: Date = new Date()): number {
  const ms = new Date(reservation.expires_at).getTime() - now.getTime();
  return Math.max(0, Math.floor(ms / 60000));
}

export function describeWindow(reservation: GpuReservation, now: Date = new Date()): string {
  const mins = minutesLeft(reservation, now);
  if (mins <= 0) return "under a minute left";
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m left` : `${hours}h left`;
}

/**
 * How hard this reservation has actually tried.
 *
 * `attempts` existed on the model and was never displayed, and that omission hid a real bug: a
 * 3090 reservation sat through its entire window at attempts=0, never calling RunPod once,
 * because decide() gated on a price check that reports nothing for a GPU that places fine. The
 * card said "Waiting for a GPU", which described an activity that was not happening, and the
 * failure was only found by querying the database directly.
 *
 * A reservation that is not attempting is indistinguishable from one that is, unless this is on
 * screen. It is the difference between a silent failure and an obvious one.
 */
export function describeAttempts(reservation: GpuReservation): string {
  const n = reservation.attempts ?? 0;
  if (n === 0) return "no launch attempted yet";
  return n === 1 ? "1 launch attempted" : `${n} launches attempted`;
}

/** Which GPU this reservation is holding out for. Selectable since wanly-api#169, so a card that
 *  omits it cannot be read — "3090-1" is a name someone typed, not a fact about the request. */
export function describeGpu(reservation: GpuReservation): string {
  const gpu = reservation.gpu_type_id;
  if (!gpu) return "default GPU";
  return gpu.replace("NVIDIA GeForce ", "").replace("NVIDIA ", "");
}

/** What this reservation will do to the worker it eventually launches. */
export function describePolicy(reservation: GpuReservation): string {
  if (reservation.drain_after_jobs == null) return "runs until you stop it";
  const n = reservation.drain_after_jobs;
  return `drains after ${n} job${n === 1 ? "" : "s"}`;
}
