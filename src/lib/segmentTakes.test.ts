import { describe, it, expect } from "vitest";
import type { SegmentResponse } from "../api/types";
import { allArchivedTakes, groupTakes, takeSeed } from "./segmentTakes";

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
  it("shows the seed an archived take carries", () => {
    expect(takeSeed(seg({ seed: "150488800771430" }))).toBe("150488800771430");
  });

  it("shows nothing for a live segment, which carries no seed of its own", () => {
    // A re-roll moves the new seed onto the job, so segment 0 is always the job seed and the
    // header is the one place it appears. Deriving job.seed + index here would be dishonest
    // anyway: 95% of job seeds exceed 2**53, so the value held in the browser is already
    // rounded.
    expect(takeSeed(seg({ seed: null }))).toBeNull();
  });

  it("keeps the seed as a string, digit for digit", () => {
    const big = "9223372036854775801";
    expect(takeSeed(seg({ seed: big }))).toBe(big);
    expect(String(Number(big))).not.toBe(big); // why it is not a number
  });
});

describe("allArchivedTakes", () => {
  it("lists takes by position, newest first within a position", () => {
    const oldZero = seg({ index: 0, discarded: true, created_at: "2026-08-14T09:00:00Z" });
    const newZero = seg({ index: 0, discarded: true, created_at: "2026-08-14T11:00:00Z" });
    const one = seg({ index: 1, discarded: true });
    const groups = groupTakes([seg({ index: 0 }), one, newZero, oldZero]);
    expect(allArchivedTakes(groups)).toEqual([newZero, oldZero, one]);
  });

  it("includes takes whose position has no live segment", () => {
    // Discarding without re-rolling is the ordinary flow; those takes have nothing to sit under
    // and would otherwise never render.
    const orphan = seg({ index: 1, discarded: true });
    const groups = groupTakes([seg({ index: 0 }), orphan]);
    expect(allArchivedTakes(groups)).toEqual([orphan]);
  });

  it("is empty for a job that has never been re-rolled", () => {
    expect(allArchivedTakes(groupTakes([seg({ index: 0 })]))).toEqual([]);
  });
});
