import { describe, it, expect } from "vitest";
import { findBootingPods, costForWorker } from "./bootingPods";
import type { RunPodWorker } from "../api/client";
import type { WorkerResponse } from "../api/types";

const pod = (name: string, status = "RUNNING", cost = 0.74): RunPodWorker =>
  ({ id: `pod-${name}`, name, status, cost_per_hr: cost, gpu_type_id: null });

const worker = (friendly_name: string, runpod_pod_id?: string): WorkerResponse =>
  ({ friendly_name, runpod_pod_id } as WorkerResponse);

describe("findBootingPods", () => {
  it("shows a pod that has not registered yet — the whole point", () => {
    // Between RunPod saying RUNNING and the daemon registering there is model staging,
    // ComfyUI start and node checks. That window showed nothing before.
    const out = findBootingPods([pod("new-worker")], []);
    expect(out.map((p) => p.name)).toEqual(["new-worker"]);
  });

  it("hides a pod once its worker registers, so it never appears twice", () => {
    const out = findBootingPods([pod("w1")], [worker("w1")]);
    expect(out).toEqual([]);
  });

  it("pairs by pod id when the names differ — the bug this fixes", () => {
    // Launched from the RunPod template: RunPod auto-names the pod, start.sh defaults
    // FRIENDLY_NAME to runpod-<pod id>. Matching on name alone left this showing as
    // "Starting" forever beside the worker it had already become.
    const p = { ...pod("valid_chocolate_cockroach"), id: "iihtdha72899sn" };
    const w = worker("runpod-iihtdha72899sn", "iihtdha72899sn");
    expect(findBootingPods([p], [w])).toEqual([]);
  });

  it("still shows a template-launched pod before its worker registers", () => {
    const p = { ...pod("valid_chocolate_cockroach"), id: "iihtdha72899sn" };
    expect(findBootingPods([p], []).map((x) => x.name)).toEqual(["valid_chocolate_cockroach"]);
  });

  it("ignores pods that are not RUNNING", () => {
    // An EXITED pod is shutting down. Showing it as "starting" would be worse than nothing.
    expect(findBootingPods([pod("gone", "EXITED")], [])).toEqual([]);
    expect(findBootingPods([pod("stopping", "TERMINATED")], [])).toEqual([]);
  });

  it("handles a mix", () => {
    const out = findBootingPods(
      [pod("registered"), pod("booting"), pod("dead", "EXITED")],
      [worker("registered"), worker("3090.zero")],
    );
    expect(out.map((p) => p.name)).toEqual(["booting"]);
  });

  it("carries the cost through so the card can show what it is burning", () => {
    expect(findBootingPods([pod("x", "RUNNING", 0.74)], [])[0].costPerHr).toBe(0.74);
  });
});

describe("costForWorker", () => {
  it("returns the pod's actual rate, not the launch-dialog quote", () => {
    expect(costForWorker(worker("w1"), [pod("w1", "RUNNING", 0.69)])).toBe(0.69);
  });

  it("matches by pod id even when the names differ", () => {
    // A template-launched pod is auto-named while its worker is runpod-<id>.
    const w = worker("runpod-abc", "pod-valid_chocolate_cockroach");
    const p = { ...pod("valid_chocolate_cockroach", "RUNNING", 0.74), id: "pod-valid_chocolate_cockroach" };
    expect(costForWorker(w, [p])).toBe(0.74);
  });

  it("returns null for a worker with no pod behind it", () => {
    // The 3090 is not a RunPod pod; it must not render a cost.
    expect(costForWorker(worker("3090.zero"), [pod("w1")])).toBeNull();
  });
});
