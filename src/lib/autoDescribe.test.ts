import { describe, expect, it } from "vitest";

import { shouldAutoDescribe } from "./autoDescribe";

const base = { tags: "Kelly", existing: null, inFlight: false };

describe("shouldAutoDescribe", () => {
  it("fires when an undescribed image gets its first tag", () => {
    expect(shouldAutoDescribe(base)).toBe(true);
  });

  it("does not re-describe an image that already has one", () => {
    // Re-describing is a deliberate act with its own button. Tagging must never overwrite
    // words the person already read and kept.
    expect(shouldAutoDescribe({ ...base, existing: "a woman on a sofa" })).toBe(false);
  });

  it("does not fire while one is already on its way", () => {
    // The tag box saves on a debounce, so this is asked repeatedly for one image. Without
    // this guard a pause mid-sentence costs a second GPU call.
    expect(shouldAutoDescribe({ ...base, inFlight: true })).toBe(false);
  });

  it("does not fire when the tags are being CLEARED", () => {
    expect(shouldAutoDescribe({ ...base, tags: null })).toBe(false);
    expect(shouldAutoDescribe({ ...base, tags: "" })).toBe(false);
    expect(shouldAutoDescribe({ ...base, tags: "   " })).toBe(false);
  });

  it("treats a whitespace-only existing description as absent", () => {
    // Nothing stores one, but a row edited by hand should not lock the image out of ever
    // being described.
    expect(shouldAutoDescribe({ ...base, existing: "   " })).toBe(true);
  });
});
