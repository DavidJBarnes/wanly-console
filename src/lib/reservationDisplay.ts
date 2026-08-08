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
  if (mins <= 0) return "expiring";
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m left` : `${hours}h left`;
}

/** What this reservation will do to the worker it eventually launches. */
export function describePolicy(reservation: GpuReservation): string {
  if (reservation.drain_after_jobs == null) return "runs until you stop it";
  const n = reservation.drain_after_jobs;
  return `drains after ${n} job${n === 1 ? "" : "s"}`;
}
