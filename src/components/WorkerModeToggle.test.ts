import { describe, expect, it } from "vitest";

import { canSwitchMode } from "./WorkerModeToggle";
import type { WorkerResponse } from "../api/types";

const w = (provides: string[] | null): WorkerResponse =>
  ({ id: "w", friendly_name: "3090.zero", provides } as unknown as WorkerResponse);

describe("which boxes can be switched at all", () => {
  it("a box with both halves can", () => {
    expect(canSwitchMode(w(["ltx-engine", "lora-trainer", "image-description"]))).toBe(true);
  });

  it("a pure render pod cannot", () => {
    // There is nothing to leave running. Offering the toggle there is offering a button
    // whose only outcome is the box's "leaves nothing to run" refusal.
    expect(canSwitchMode(w(["ltx-engine"]))).toBe(false);
    expect(canSwitchMode(w(["ltx-engine", "lora-trainer"]))).toBe(false);
  });

  it("a captions-only box cannot", () => {
    // Already in the only mode it has; there is no render stack to start.
    expect(canSwitchMode(w(["image-description", "face-crop"]))).toBe(false);
  });

  it("a worker that has never reported what it provides cannot", () => {
    // NULL means never reported, which is not the same as reporting nothing. Guessing from
    // it would put a toggle on a row we know nothing about.
    expect(canSwitchMode(w(null))).toBe(false);
    expect(canSwitchMode(w([]))).toBe(false);
  });

  it("the trainer counts as claiming work", () => {
    // A training run holds the card as surely as a render does, so caption mode has to stop
    // it too -- and a trainer-plus-captioner box is therefore switchable.
    expect(canSwitchMode(w(["lora-trainer", "image-description"]))).toBe(true);
  });
});
