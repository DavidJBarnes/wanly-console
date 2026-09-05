import { describe, expect, it } from "vitest";

import { initialNegativeOverride, negativeOverrideToSend } from "./poseNegativeOverride";

const DEFAULT = "static, still image, frozen, no motion, blurry, low quality";

describe("the pose editor's negative prompt", () => {
  it("opens empty for a pose that inherits, NOT on the resolved default", () => {
    // The whole bug: showing the resolved value here is what let a Save pin it.
    const inheriting = { negative_prompt: DEFAULT, negative_prompt_override: null };
    expect(initialNegativeOverride(inheriting)).toBe("");
  });

  it("opens on the pose's own words when it really has some", () => {
    const owned = { negative_prompt: "hands", negative_prompt_override: "hands" };
    expect(initialNegativeOverride(owned)).toBe("hands");
  });

  it("opens empty for a brand new pose", () => {
    expect(initialNegativeOverride(null)).toBe("");
  });

  it("round-trips an inheriting pose back to inheriting (console#430)", () => {
    // Open a pose that inherits, touch nothing, save. It must still inherit afterwards —
    // this is exactly the sequence that pinned all 16 production poses to a copy of the
    // default and left the Settings field unreachable.
    const inheriting = { negative_prompt: DEFAULT, negative_prompt_override: null };
    expect(negativeOverrideToSend(initialNegativeOverride(inheriting))).toBeNull();
  });

  it("round-trips a real override unchanged", () => {
    const owned = { negative_prompt: "hands", negative_prompt_override: "hands" };
    expect(negativeOverrideToSend(initialNegativeOverride(owned))).toBe("hands");
  });

  it("treats a cleared box as inherit, never as 'render with no negative'", () => {
    expect(negativeOverrideToSend("")).toBeNull();
    expect(negativeOverrideToSend("   ")).toBeNull();
  });
});
