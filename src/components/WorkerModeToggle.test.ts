import { describe, expect, it } from "vitest";

import { canSwitchMode } from "./WorkerModeToggle";
import type { WorkerResponse } from "../api/types";

const w = (provides: string[] | null): WorkerResponse =>
  ({ id: "w", friendly_name: "3090.zero", provides } as unknown as WorkerResponse);

describe("which boxes can be switched at all", () => {
  it("a box with the render stack and a captioner can", () => {
    expect(canSwitchMode(w(["ltx-engine", "lora-trainer", "image-description"]))).toBe(true);
  });

  it("render plus trainer can now: train is a mode of its own (wanly-gpu-docker#164)", () => {
    // Before the four modes the trainer rode along in render, so this box had one mode and
    // no toggle. Now render and train are two modes, and the box can switch between them.
    expect(canSwitchMode(w(["ltx-engine", "lora-trainer"]))).toBe(true);
  });

  it("a pure render pod cannot", () => {
    // There is nothing to switch to. Offering the toggle there is offering a button whose
    // only outcome is the box's "leaves nothing to run" refusal.
    expect(canSwitchMode(w(["ltx-engine"]))).toBe(false);
    expect(canSwitchMode(w(["ltx-engine", "face-crop"]))).toBe(false);
  });

  it("a captions-only box cannot", () => {
    expect(canSwitchMode(w(["image-description", "face-crop"]))).toBe(false);
  });

  it("a worker that has never reported what it provides cannot", () => {
    // NULL means never reported, which is not the same as reporting nothing. Guessing from
    // it would put a toggle on a row we know nothing about.
    expect(canSwitchMode(w(null))).toBe(false);
    expect(canSwitchMode(w([]))).toBe(false);
  });
});
