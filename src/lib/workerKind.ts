/**
 * What a worker IS, and the display decisions that follow (wanly-api#269).
 *
 * Extracted rather than left inline for the same reason workerBuild.ts was: these are
 * judgements with a right and a wrong answer, and one of them — the fleet count — is the
 * console's half of a bug the API had to be fixed for. A judgement worth getting right is
 * worth being able to test without rendering a page.
 */
import type { WorkerResponse } from "../api/types";

export function isService(w: Pick<WorkerResponse, "kind">): boolean {
  return w.kind === "service";
}

/**
 * Drain finishes what a worker holds and then stops it taking more. A service holds no
 * segments, so there is nothing to finish — the button would be inert on a row where every
 * other control does something, which is worse than its absence.
 */
export function canDrain(w: Pick<WorkerResponse, "kind" | "status">): boolean {
  if (isService(w)) return false;
  return w.status === "online-idle" || w.status === "online-busy";
}

export interface FleetCounts {
  liveRender: number;
  liveServices: number;
  total: number;
}

/**
 * COUNTED PER KIND, deliberately.
 *
 * "2 online" when one of them is a captioner that can never take a segment reads as capacity
 * that does not exist — and it reads that way hardest when the render fleet is down, which is
 * exactly when someone is looking at the number. That is the same mistake the API's
 * queue-health had to be fixed for in this ticket: it counted every worker row, so a healthy
 * service would have kept the `stalled` alarm quiet forever.
 *
 * A worker with no kind counts as render. The column is NOT NULL with a `render` default, so
 * this only matters for a response from an older API, and treating an unknown worker as one
 * that renders keeps the count meaning what it meant before.
 */
export function fleetCounts(workers: Pick<WorkerResponse, "kind" | "status">[]): FleetCounts {
  const live = workers.filter((w) => w.status !== "offline");
  return {
    liveRender: live.filter((w) => !isService(w)).length,
    liveServices: live.filter((w) => isService(w)).length,
    total: workers.length,
  };
}

/**
 * Sort order for the worker list. The service statuses need a place or they sort after
 * `offline`, which puts a live box below a dead one.
 *
 * Degraded above online, because a partly-broken service is the row worth reading first.
 */
export const STATUS_ORDER: Record<string, number> = {
  "online-busy": 0,
  draining: 1,
  "online-idle": 2,
  degraded: 3,
  online: 4,
  offline: 5,
};

export function byStatus(
  a: Pick<WorkerResponse, "status">,
  b: Pick<WorkerResponse, "status">,
): number {
  return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
}
