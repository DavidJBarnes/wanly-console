import { describe, expect, it } from "vitest";
import { pickPreviousSegment } from "./previousSegment";
import type { SegmentResponse } from "../api/types";

const seg = (index: number, extra: Partial<SegmentResponse> = {}): SegmentResponse =>
  ({ id: `s${index}${extra.discarded ? "d" : ""}`, index, ...extra }) as SegmentResponse;

describe("pickPreviousSegment", () => {
  it("takes the highest index", () => {
    expect(pickPreviousSegment([seg(0), seg(1), seg(2)])?.index).toBe(2);
  });

  it("does not rely on array order", () => {
    // Response order is not guaranteed to be index order; taking the last element would
    // prefill from the middle of the chain.
    expect(pickPreviousSegment([seg(2), seg(0), seg(1)])?.index).toBe(2);
  });

  it("skips a discarded take at the same index as its replacement", () => {
    // What a re-roll leaves: the rejected take soft-deleted beside the one that replaced it.
    // Prefilling from the discarded one would silently restore the settings the user threw away.
    const kept = seg(0);
    const thrown = seg(0, { discarded: true });
    expect(pickPreviousSegment([thrown, kept])?.id).toBe(kept.id);
  });

  it("ignores a discarded segment even when it has the highest index", () => {
    expect(pickPreviousSegment([seg(0), seg(1, { discarded: true })])?.index).toBe(0);
  });

  it("returns null when there is nothing usable, so the form opens on defaults", () => {
    expect(pickPreviousSegment([])).toBeNull();
    expect(pickPreviousSegment(undefined)).toBeNull();
    expect(pickPreviousSegment([seg(0, { discarded: true })])).toBeNull();
  });
});
