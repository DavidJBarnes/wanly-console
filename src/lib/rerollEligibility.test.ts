import { describe, it, expect } from "vitest";
import type { JobStatus, SegmentResponse, SegmentStatus } from "../api/types";
import { rerollableSegment } from "./rerollEligibility";

const seg = (over: Partial<SegmentResponse>): SegmentResponse =>
  ({ id: `s${over.index ?? 0}`, index: 0, status: "completed", discarded: false, ...over }) as SegmentResponse;

const target = (segments: SegmentResponse[], status: JobStatus = "awaiting") =>
  rerollableSegment(segments, status);

describe("rerollableSegment", () => {
  it("offers a job with one finished take", () => {
    expect(target([seg({})])?.index).toBe(0);
    expect(target([seg({ status: "failed" })])?.index).toBe(0);
  });

  it("offers the CURRENT segment of a chain, not segment 0", () => {
    // console#424. "That take was close" applies to segment 3 as much as to segment 0.
    expect(target([seg({}), seg({ index: 1 }), seg({ index: 2 })])?.index).toBe(2);
  });

  it("still offers it once earlier takes have been archived", () => {
    // The workflow is rolling repeatedly. Counting archived takes would hide the button after
    // the first use — the opposite of what it is for.
    expect(target([seg({ discarded: true }), seg({})])?.index).toBe(0);
    expect(target([seg({}), seg({ index: 1, discarded: true }), seg({ index: 1 })])?.index).toBe(1);
  });

  it("refuses while the current take is still running", () => {
    const running: SegmentStatus[] = ["pending", "claimed", "processing"];
    for (const status of running) {
      expect(target([seg({}), seg({ index: 1, status })])).toBeNull();
    }
  });

  it("refuses a job with no live take at all", () => {
    expect(target([])).toBeNull();
    expect(target([seg({ discarded: true })])).toBeNull();
  });

  it("refuses a finalized job", () => {
    // Its stitched output describes the takes that were live when it was built.
    for (const status of ["finalized", "finalizing", "archived"] as JobStatus[]) {
      expect(target([seg({})], status)).toBeNull();
    }
  });
});
