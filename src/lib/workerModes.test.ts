import { describe, expect, it } from "vitest";

import type { WorkerModeResponse } from "../api/types";
import {
  canonicalMode, describePending, describeScene, describeUnload, describeVram, modeToSend,
  modeView, summaryParts,
} from "./workerModes";

const info = (o: Partial<WorkerModeResponse>): WorkerModeResponse => ({
  mode: "ltx-engine", equipped: [], services: [], changed: false, pending_mode: null,
  mode_error: null, ...o,
});

describe("reading a box's mode in either spelling", () => {
  it("the old names mean the four modes", () => {
    expect(canonicalMode("ltx-engine")).toBe("render");
    expect(canonicalMode("caption")).toBe("motion");
    expect(canonicalMode("edit")).toBe("edit");
    expect(canonicalMode("nonsense")).toBeNull();
  });

  it("a four-mode box: mode_name wins and its modes are what it can enter", () => {
    const v = modeView(info({ mode: "train", mode_name: "train", pending_mode_name: "motion",
                              modes: ["render", "train", "motion", "edit"] }));
    expect(v).toEqual({ current: "train", pending: "motion",
                        available: ["render", "train", "motion", "edit"], fourModes: true });
  });

  it("a box from before #164 is read from its old fields and offered no train mode", () => {
    const v = modeView(info({ mode: "caption", pending_mode: "ltx-engine",
                              equipped: ["ltx-engine", "lora-trainer", "image-description"] }));
    expect(v.current).toBe("motion");
    expect(v.pending).toBe("render");
    expect(v.available).toEqual(["render", "motion"]);
    expect(v.fourModes).toBe(false);
  });

  it("an older box is sent the old names; a four-mode box the new ones", () => {
    expect(modeToSend("motion", false)).toBe("caption");
    expect(modeToSend("render", false)).toBe("ltx-engine");
    expect(modeToSend("motion", true)).toBe("motion");
  });
});

describe("what the card says", () => {
  it("a pending switch mid-render waits for the segment", () => {
    expect(describePending("motion", true)).toBe("finishing segment, then motion");
    expect(describePending("motion", false)).toBe("switching to motion");
  });

  it("VRAM in GB, or nothing when the box does not say", () => {
    expect(describeVram({ vram_used_mib: 23654, vram_total_mib: 24576 }))
      .toBe("VRAM 23.1 / 24.0 GB");
    expect(describeVram(null)).toBeNull();
  });

  it("the last unload, and a refusal over the limit in words", () => {
    expect(describeUnload({ from: "render", to: "train", found_mib: 23142, after_mib: 410,
                            limit_mib: 8192, seconds: 6.2, ok: true }))
      .toBe("Last switch render → train: 22.6 → 0.4 GB in 6 s");
    expect(describeUnload({ from: "ltx-engine", to: "motion", found_mib: 23142,
                            after_mib: 15000, limit_mib: 8192, seconds: 90, ok: false }))
      .toContain("over the 8.0 GB limit, switch refused");
    expect(describeUnload(null)).toBeNull();
  });
});

describe("the per-mode summary", () => {
  it("counts with units, links to the queue, and keeps the reason", () => {
    const parts = summaryParts([
      { mode: "render", count: 4, unit: "segments", reason: null },
      { mode: "motion", count: 12, unit: "captions", reason: "no GPU in motion mode" },
      { mode: "edit", count: 0, unit: "edits", reason: null },
      { mode: "train", count: 1, unit: "runs", reason: null },
    ]);
    expect(parts.map((p) => p.text)).toEqual(
      ["render: 4 segments", "motion: 12 captions", "train: 1 run"]);
    expect(parts[0].to).toBe("/jobs");
    expect(parts[1].reason).toBe("no GPU in motion mode");
    expect(parts[2].to).toBe("/training");
  });

  it("scene captions are labelled apart, and a down scene service says fallback", () => {
    expect(describeScene({ depth: 3, up: true })).toBe("scene captions: 3");
    expect(describeScene({ depth: 0, up: false })).toContain("fallback");
    expect(describeScene({ depth: 0, up: true })).toBeNull();
  });
});
