import { describe, expect, it } from "vitest";
import { lastPhaseNote, phaseStatus } from "./workerPhase";

const syncing = {
  phase: "syncing_loras",
  detail: "Downloading Payton_v2_final (358 / 650 MB, 0.4 MB/s, ETA 12m 10s), 1 file left",
  file: "Payton_v2_final.safetensors",
  done_bytes: 358 * 1024 * 1024,
  total_bytes: 650 * 1024 * 1024,
  eta_s: 730,
  files_remaining: 1,
};

describe("phaseStatus (wanly-gpu-daemon#189)", () => {
  it("shows a LoRA sync in place of the status, with the worker's own sentence", () => {
    const s = phaseStatus({ status: "online-idle", phase: syncing });
    expect(s?.label).toBe("Syncing LoRAs");
    expect(s?.detail).toContain("Payton_v2_final");
    expect(s?.detail).toContain("ETA");
    expect(s?.pct).toBe(55);
  });

  it("names both modes of a switch", () => {
    const s = phaseStatus({
      status: "online-idle",
      phase: { phase: "switching_mode", from_mode: "edit", to_mode: "render",
               detail: "Switching edit → render: starting comfyui" },
    });
    expect(s?.label).toBe("Switching edit → render");
    expect(s?.detail).toBe("Switching edit → render: starting comfyui");
    expect(s?.pct).toBeNull();
  });

  it("says nothing when ready, absent (older API) or null", () => {
    expect(phaseStatus({ status: "online-idle", phase: { phase: "ready", detail: "Ready" } })).toBeNull();
    expect(phaseStatus({ status: "online-idle" })).toBeNull();
    expect(phaseStatus({ status: "online-idle", phase: null })).toBeNull();
  });

  it("an unknown phase still renders its detail", () => {
    const s = phaseStatus({ status: "online", phase: { phase: "warming_up", detail: "Warming up X" } });
    expect(s?.label).toBe("warming up");
    expect(s?.detail).toBe("Warming up X");
  });

  it("an offline row is Offline, with what it last said as a note", () => {
    expect(phaseStatus({ status: "offline", phase: syncing })).toBeNull();
    expect(lastPhaseNote({ status: "offline", phase: syncing })).toContain("Last reported: Downloading");
    expect(lastPhaseNote({ status: "online-idle", phase: syncing })).toBeNull();
  });
});
