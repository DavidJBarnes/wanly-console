import { describe, it, expect } from "vitest";
import { parseImageInUse, describeHolders } from "./imageDeleteConflict";

const conflict = (overrides = {}) => ({
  response: {
    status: 409,
    data: {
      detail: {
        message: "Image is still referenced; pass force=true to delete anyway",
        path: "s3://wanly-images/2026-07-09/x.png",
        job_ids: ["job-1"],
        segment_ids: ["seg-1", "seg-2"],
        ...overrides,
      },
    },
  },
});

describe("parseImageInUse", () => {
  it("extracts the holders so the user can go look at them", () => {
    const out = parseImageInUse(conflict())!;
    expect(out.jobIds).toEqual(["job-1"]);
    expect(out.segmentIds).toEqual(["seg-1", "seg-2"]);
    expect(out.path).toBe("s3://wanly-images/2026-07-09/x.png");
  });

  it("returns null for anything that is not a 409", () => {
    // A network failure must never be reported to the user as "image in use".
    expect(parseImageInUse({ response: { status: 500, data: {} } })).toBeNull();
    expect(parseImageInUse({ message: "Network Error" })).toBeNull();
    expect(parseImageInUse(undefined)).toBeNull();
  });

  it("returns null when a 409 names no holders", () => {
    // The API contradicting itself. Better to fall back to ordinary error handling than to
    // render "still used by 0 things".
    expect(parseImageInUse(conflict({ job_ids: [], segment_ids: [] }))).toBeNull();
  });

  it("survives a malformed detail without throwing", () => {
    expect(parseImageInUse({ response: { status: 409, data: { detail: "oops" } } })).toBeNull();
    expect(parseImageInUse({ response: { status: 409, data: {} } })).toBeNull();
    expect(
      parseImageInUse({ response: { status: 409, data: { detail: { job_ids: "nope" } } } }),
    ).toBeNull();
  });
});

describe("describeHolders", () => {
  it("reads naturally at one and at many", () => {
    expect(describeHolders({ path: "", jobIds: ["a"], segmentIds: [] })).toBe("1 job");
    expect(describeHolders({ path: "", jobIds: ["a", "b"], segmentIds: [] })).toBe("2 jobs");
    expect(describeHolders({ path: "", jobIds: [], segmentIds: ["s"] })).toBe("1 segment");
    expect(describeHolders({ path: "", jobIds: ["a"], segmentIds: ["s", "t"] })).toBe(
      "1 job and 2 segments",
    );
  });
});
