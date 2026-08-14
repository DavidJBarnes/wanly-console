import { describe, it, expect } from "vitest";
import type { SegmentResponse } from "../api/types";
import { groupTakes, orphanTakeIndices, takeSeed } from "./segmentTakes";

const seg = (over: Partial<SegmentResponse>): SegmentResponse =>
  ({ id: String(Math.random()), index: 0, discarded: false, created_at: "2026-08-14T10:00:00Z", ...over }) as SegmentResponse;

describe("groupTakes", () => {
  it("keeps only live segments in video order", () => {
    const one = seg({ index: 1 });
    const zero = seg({ index: 0 });
    const { live } = groupTakes([one, zero, seg({ index: 0, discarded: true })]);
    expect(live.map((s) => s.index)).toEqual([0, 1]);
  });

  it("files archived takes under the index they were replaced at", () => {
    const archived = seg({ index: 0, discarded: true });
    const { archivedByIndex } = groupTakes([seg({ index: 0 }), archived, seg({ index: 1 })]);
    expect(archivedByIndex.get(0)).toEqual([archived]);
    expect(archivedByIndex.has(1)).toBe(false);
  });

  it("orders archived takes newest first", () => {
    // The most recently archived one is what the current take is being compared against.
    const older = seg({ index: 0, discarded: true, created_at: "2026-08-14T09:00:00Z" });
    const newer = seg({ index: 0, discarded: true, created_at: "2026-08-14T11:00:00Z" });
    const { archivedByIndex } = groupTakes([seg({ index: 0 }), older, newer]);
    expect(archivedByIndex.get(0)).toEqual([newer, older]);
  });

  it("handles a job whose only take is archived", () => {
    // Possible mid-re-roll, before the replacement lands.
    const { live, archivedByIndex } = groupTakes([seg({ index: 0, discarded: true })]);
    expect(live).toEqual([]);
    expect(archivedByIndex.get(0)).toHaveLength(1);
  });
});

describe("takeSeed", () => {
  it("shows a seed the segment carries", () => {
    expect(takeSeed(seg({ seed: "150488800771430" }))).toBe("150488800771430");
  });

  it("shows nothing rather than a derived guess", () => {
    // job.seed + index cannot be computed honestly in the browser: 95% of job seeds exceed
    // 2**53, so the value held here has already been rounded.
    expect(takeSeed(seg({ seed: null }))).toBeNull();
  });

  it("keeps the seed as a string, digit for digit", () => {
    const big = "9223372036854775801";
    expect(takeSeed(seg({ seed: big }))).toBe(big);
    expect(String(Number(big))).not.toBe(big); // why it is not a number
  });
});

describe("orphanTakeIndices", () => {
  it("finds takes with no live sibling", () => {
    // Discarding a segment without re-rolling it is the ordinary flow, and those takes have
    // nothing to fold under. Rendered only under live segments, they would disappear.
    const groups = groupTakes([
      seg({ index: 0 }),
      seg({ index: 1, discarded: true }),
      seg({ index: 2, discarded: true }),
    ]);
    expect(orphanTakeIndices(groups)).toEqual([1, 2]);
  });

  it("ignores indices that do have a live take", () => {
    const groups = groupTakes([seg({ index: 0 }), seg({ index: 0, discarded: true })]);
    expect(orphanTakeIndices(groups)).toEqual([]);
  });

  it("returns them in video order", () => {
    const groups = groupTakes([
      seg({ index: 3, discarded: true }),
      seg({ index: 1, discarded: true }),
    ]);
    expect(orphanTakeIndices(groups)).toEqual([1, 3]);
  });
});
