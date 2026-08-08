import { describe, it, expect } from "vitest";
import { findBootingPods, costForWorker } from "./bootingPods";
import type { RunPodWorker } from "../api/client";
import type { WorkerResponse } from "../api/types";

const pod = (name: string, status = "RUNNING", cost = 0.74): RunPodWorker =>
  ({ id: `pod-${name}`, name, status, cost_per_hr: cost, gpu_type_id: null });

const worker = (friendly_name: string): WorkerResponse =>
  ({ friendly_name } as WorkerResponse);

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
    expect(costForWorker("w1", [pod("w1", "RUNNING", 0.69)])).toBe(0.69);
  });

  it("returns null for a worker with no pod behind it", () => {
    // The 3090 is not a RunPod pod; it must not render a cost.
    expect(costForWorker("3090.zero", [pod("w1")])).toBeNull();
  });
});
