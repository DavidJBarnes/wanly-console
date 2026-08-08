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

describe("stuck detection", () => {
  const NOW = new Date("2026-08-08T21:00:00Z");
  const pod = (over: Partial<RunPodWorker> = {}): RunPodWorker => ({
    id: "p1", name: "3090-1", status: "RUNNING", cost_per_hr: 0.22, gpu_type_id: null,
    created_at: "2026-08-08T20:55:00Z", runtime_ready: false, gpu_count: 0, ...over,
  });

  it("does not call a recently launched pod stuck", () => {
    const [b] = findBootingPods([pod()], [], NOW);
    expect(b.stuck).toBe(false);
    expect(b.ageSeconds).toBe(300);
  });

  it("does not call a slow cold boot stuck", () => {
    // Watched live: a healthy pod registered at 26.5 minutes, having reached "custom nodes
    // verified" at ~13. Anything at or under that observed-good boot MUST NOT be flagged --
    // this test exists to stop the threshold drifting back down.
    const [b] = findBootingPods([pod({ created_at: "2026-08-08T20:33:30Z" })], [], NOW);
    expect(b.ageSeconds).toBe(26 * 60 + 30);
    expect(b.stuck).toBe(false);
  });

  it("calls a pod stuck once it passes the window without registering", () => {
    const [b] = findBootingPods([pod({ created_at: "2026-08-08T20:10:00Z" })], [], NOW);
    expect(b.stuck).toBe(true);
    expect(b.reason).toContain("never registered");
  });

  it("ignores runtime_ready and gpu_count entirely", () => {
    // These CANNOT be used. Measured 2026-08-08: a pod that had registered and was accepting
    // work still reported runtime {} and gpus [], identical to one that billed 18 minutes while
    // torch inside reported zero CUDA devices. Judging on them flags healthy pods as dead.
    const healthy = findBootingPods([pod({ runtime_ready: false, gpu_count: 0 })], [], NOW);
    expect(healthy[0].stuck).toBe(false);
    const up = findBootingPods(
      [pod({ created_at: "2026-08-08T20:10:00Z", runtime_ready: true, gpu_count: 1 })], [], NOW);
    expect(up[0].stuck).toBe(true);
  });

  it("reports age even when it is not stuck, because that is what was missing", () => {
    // The operator judging "that's been 12 minutes, something is wrong" is most of the value;
    // the threshold only catches what they did not notice.
    const [b] = findBootingPods([pod()], [], NOW);
    expect(b.ageSeconds).not.toBeNull();
  });

  it("survives a pod with no creation time rather than calling it stuck", () => {
    const [b] = findBootingPods([pod({ created_at: null })], [], NOW);
    expect(b.ageSeconds).toBeNull();
    expect(b.stuck).toBe(false);
  });
});
