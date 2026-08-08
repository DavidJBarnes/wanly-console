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
}

export function findBootingPods(
  pods: RunPodWorker[],
  workers: WorkerResponse[],
): BootingPod[] {
  const registered = new Set(workers.map((w) => w.friendly_name));
  return pods
    // A pod RunPod is deliberately shutting down is not "booting". Showing EXITED pods as
    // starting would be worse than showing nothing.
    .filter((p) => p.status === "RUNNING")
    .filter((p) => !!p.name && !registered.has(p.name))
    .map((p) => ({
      id: p.id,
      name: p.name as string,
      status: p.status,
      costPerHr: p.cost_per_hr,
    }));
}

/**
 * The hourly cost of a pod backing an already-registered worker, or null if this worker is not
 * a RunPod pod.
 *
 * This is the pod's ACTUAL rate as RunPod reports it, not the pre-launch quote shown in the
 * launch dialog — they are different numbers and only this one is what gets billed.
 */
export function costForWorker(
  workerName: string,
  pods: RunPodWorker[],
): number | null {
  const pod = pods.find((p) => p.name === workerName);
  return pod?.cost_per_hr ?? null;
}
