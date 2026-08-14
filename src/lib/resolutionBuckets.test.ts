import { describe, it, expect } from "vitest";
import {
  BUCKET_AREA_480P,
  BUCKET_AREA_720P,
  bucketResolution,
  describeBucket,
} from "./resolutionBuckets";

const dims = (w: number, h: number, area: number) => {
  const r = bucketResolution(w, h, area);
  return [r.width, r.height];
};

describe("bucketResolution", () => {
  it("area-matches an SDXL portrait instead of pinning the short side", () => {
    // Short-side scaling gave 480x704 = 337,920 px, 15% under bucket.
    expect(dims(832, 1216, BUCKET_AREA_480P)).toEqual([528, 768]);
    expect(dims(1216, 832, BUCKET_AREA_480P)).toEqual([768, 528]);
  });

  it("area-matches a square source", () => {
    // Short-side scaling gave 480x480 = 230,400 px, 42% under bucket. 624 rather than 640 is
    // what the area formula yields: sqrt(399360)/1024 puts each side at 631.9 px, and 624 is the
    // nearer multiple of 16 (640 is 8.05 px away, 624 is 7.9). The ticket's hand-computed 640 is
    // 2.6% over the bucket where 624 is 2.5% under — same magnitude, opposite sign.
    expect(dims(1024, 1024, BUCKET_AREA_480P)).toEqual([624, 624]);
    expect(dims(1024, 1024, BUCKET_AREA_720P)).toEqual([960, 960]);
  });

  it("passes a native bucket straight through", () => {
    expect(dims(832, 480, BUCKET_AREA_480P)).toEqual([832, 480]);
    expect(dims(480, 832, BUCKET_AREA_480P)).toEqual([480, 832]);
    expect(dims(1280, 720, BUCKET_AREA_720P)).toEqual([1280, 720]);
    expect(dims(720, 1280, BUCKET_AREA_720P)).toEqual([720, 1280]);
  });

  it("snaps a near miss onto the native bucket", () => {
    // 832x480 asked for at 720p lands on 1264x736 by area — inside 5% of 1280x720, which is a
    // resolution the model was actually trained on.
    const r = bucketResolution(832, 480, BUCKET_AREA_720P);
    expect([r.width, r.height]).toEqual([1280, 720]);
    expect(r.snapped).toBe(true);
  });

  it("does not snap when the aspect ratio is genuinely different", () => {
    const r = bucketResolution(832, 1216, BUCKET_AREA_480P);
    expect(r.snapped).toBe(false);
  });

  it("upscales a source smaller than the bucket", () => {
    // Generating below bucket area is worse than upscaling into it, so small sources scale up.
    const r = bucketResolution(512, 512, BUCKET_AREA_480P);
    expect(r.width).toBeGreaterThan(512);
    expect(r.height).toBeGreaterThan(512);
    expect(r.areaRatio).toBeGreaterThan(0.95);
  });

  it("keeps every dimension a positive multiple of 16", () => {
    const sources: Array<[number, number]> = [
      [1, 1],
      [4000, 3],
      [3, 4000],
      // Extreme enough that the scaled short side rounds to zero without the floor.
      [10000, 1],
      [1, 10000],
      [1920, 1080],
      [1024, 1024],
      [832, 1216],
    ];
    for (const area of [BUCKET_AREA_480P, BUCKET_AREA_720P]) {
      for (const [w, h] of sources) {
        const r = bucketResolution(w, h, area);
        expect(r.width % 16).toBe(0);
        expect(r.height % 16).toBe(0);
        expect(r.width).toBeGreaterThanOrEqual(16);
        expect(r.height).toBeGreaterThanOrEqual(16);
      }
    }
  });

  it("lands within a few percent of the target area for ordinary aspects", () => {
    const sources: Array<[number, number]> = [
      [1024, 1024],
      [832, 1216],
      [1216, 832],
      [1920, 1080],
      [768, 1344],
      [512, 512],
    ];
    for (const area of [BUCKET_AREA_480P, BUCKET_AREA_720P]) {
      for (const [w, h] of sources) {
        const r = bucketResolution(w, h, area);
        expect(r.areaRatio).toBeGreaterThan(0.95);
        expect(r.areaRatio).toBeLessThan(1.05);
      }
    }
  });

  it("falls back to a native bucket when the source size is unknown", () => {
    expect(dims(0, 0, BUCKET_AREA_480P)).toEqual([832, 480]);
    expect(dims(0, 0, BUCKET_AREA_720P)).toEqual([1280, 720]);
  });
});

describe("describeBucket", () => {
  it("reports the area as a percentage of the bucket", () => {
    const r = bucketResolution(832, 1216, BUCKET_AREA_480P);
    expect(describeBucket(832, 1216, r)).toBe("832x1216 -> 528x768 (102% of bucket area)");
  });

  it("calls out a native bucket", () => {
    const r = bucketResolution(832, 480, BUCKET_AREA_480P);
    expect(describeBucket(832, 480, r)).toBe(
      "832x480 -> 832x480 (100% of bucket area, native bucket)",
    );
  });
});
