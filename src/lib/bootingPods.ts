import type { RunPodWorker } from "../api/client";
import type { WorkerResponse } from "../api/types";

/**
 * Which RunPod pods are up but have not registered as workers yet.
 *
 * There is a real gap between "RunPod says RUNNING" and "the worker appears on this page":
 * the container stages models, starts ComfyUI, verifies nodes and validates models before the
 * daemon registers. On a warm network volume that is ~90s; on a cold one it is 12+ minutes of
 * downloading. During that window the Workers page showed nothing at all, so a launch looked
 * like it had failed.
 *
 * Joined on name, because the launcher sets the pod name and the worker's FRIENDLY_NAME to the
 * same value — so a pod that has registered appears once, as a worker, not twice.
 */

export interface BootingPod {
  id: string;
  name: string;
  status: string | null;
  costPerHr: number | null;
  /** Seconds since RunPod rented it, or null if it did not report a creation time. */
  ageSeconds: number | null;
  /** True when this pod is not going to boot: rented and billing, with no container. */
  stuck: boolean;
  /** Why it is stuck, for the card to show instead of a spinner. */
  reason: string | null;
}

/**
 * How long a pod may go without registering as a worker before it is treated as broken.
 *
 * Age is the ONLY signal that discriminates. RunPod's pod record does not: measured 2026-08-08,
 * a pod that had already registered and was accepting work still reported `runtime: {}` and
 * `gpus: []`, byte-identical to one that had billed for eighteen minutes while torch inside it
 * said "CUDA unknown error ... available devices zero". Judging on those fields would have
 * flagged a healthy pod as dead.
 *
 * Twenty minutes, because the daemon registers only AFTER staging and validating models, and a
 * cold pod pulls ~37GB first -- so a slow-but-fine boot can legitimately take twelve or more.
 * The point is not to catch it fast; it is to catch it at all, and to show the elapsed time so
 * the operator can judge earlier than the threshold does.
 */
export const STUCK_AFTER_SECONDS = 20 * 60;

/** Has this pod already become a registered worker?
 *
 *  By pod id first, because that is the only identifier both sides agree on. Names diverge:
 *  a pod launched from the RunPod template is auto-named (valid_chocolate_cockroach) while its
 *  worker registers as runpod-<pod id>. Matching on name alone left such a pod showing as
 *  "Starting" forever, beside the worker it had already become.
 *
 *  Name is kept as a fallback for workers whose daemon predates reporting the pod id. */
function isRegistered(pod: RunPodWorker, workers: WorkerResponse[]): boolean {
  return workers.some(
    (w) =>
      (w.runpod_pod_id && w.runpod_pod_id === pod.id) ||
      (!!pod.name && w.friendly_name === pod.name),
  );
}

export function findBootingPods(
  pods: RunPodWorker[],
  workers: WorkerResponse[],
  now: Date = new Date(),
): BootingPod[] {
  return pods
    // A pod RunPod is deliberately shutting down is not "booting". Showing EXITED pods as
    // starting would be worse than showing nothing.
    .filter((p) => p.status === "RUNNING")
    .filter((p) => !isRegistered(p, workers))
    .map((p) => {
      const ageSeconds = p.created_at
        ? Math.max(0, Math.round((now.getTime() - new Date(p.created_at).getTime()) / 1000))
        : null;
      const stuck = ageSeconds !== null && ageSeconds >= STUCK_AFTER_SECONDS;
      return {
        id: p.id,
        name: p.name as string,
        status: p.status,
        costPerHr: p.cost_per_hr,
        ageSeconds,
        stuck,
        reason: stuck
          ? "Rented and billing but never registered as a worker. A healthy pod registers well "
            + "inside this window, even staging models cold. Most likely the host never attached "
            + "a GPU, which torch reports as zero available devices."
          : null,
      };
    });
}

/**
 * The hourly cost of a pod backing an already-registered worker, or null if this worker is not
 * a RunPod pod.
 *
 * This is the pod's ACTUAL rate as RunPod reports it, not the pre-launch quote shown in the
 * launch dialog — they are different numbers and only this one is what gets billed.
 */
export function costForWorker(
  worker: WorkerResponse,
  pods: RunPodWorker[],
): number | null {
  const pod = pods.find(
    (p) =>
      (worker.runpod_pod_id && p.id === worker.runpod_pod_id) ||
      p.name === worker.friendly_name,
  );
  return pod?.cost_per_hr ?? null;
}
