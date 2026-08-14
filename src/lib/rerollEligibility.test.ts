import { describe, it, expect } from "vitest";
import type { SegmentResponse, SegmentStatus } from "../api/types";
import { canRerollSeed } from "./rerollEligibility";

const seg = (over: Partial<SegmentResponse>): SegmentResponse =>
  ({ index: 0, status: "completed", discarded: false, ...over }) as SegmentResponse;

describe("canRerollSeed", () => {
  it("allows a job with one finished take", () => {
    expect(canRerollSeed([seg({})])).toBe(true);
    expect(canRerollSeed([seg({ status: "failed" })])).toBe(true);
  });

  it("still allows it once earlier takes have been archived", () => {
    // The workflow is rolling repeatedly. Counting archived takes would hide the button after
    // the first use — the opposite of what it is for.
    expect(canRerollSeed([seg({ discarded: true }), seg({})])).toBe(true);
  });

  it("refuses once a successor segment exists", () => {
    // Segment 1 was generated from segment 0's last frame; replacing 0 orphans it.
    expect(canRerollSeed([seg({}), seg({ index: 1 })])).toBe(false);
  });

  it("refuses while the take is still running", () => {
    const running: SegmentStatus[] = ["pending", "claimed", "processing"];
    for (const status of running) {
      expect(canRerollSeed([seg({ status })])).toBe(false);
    }
  });

  it("refuses a job with no live take at all", () => {
    expect(canRerollSeed([])).toBe(false);
    expect(canRerollSeed([seg({ discarded: true })])).toBe(false);
  });
});
