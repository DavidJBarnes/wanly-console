import { describe, expect, it } from "vitest";

import { byRecent, datasetNameProblem, datasetPrefix, parseTags } from "./datasets";
import type { Dataset } from "../api/types";

const ds = (over: Partial<Dataset> = {}): Dataset => ({
  id: "d", name: "n", tags: null, notes: null, images: [], prefix: null,
  created_at: null, updated_at: null, ...over,
});

describe("parseTags", () => {
  it("splits, trims and drops empties", () => {
    // ",,character, faces," is easy to produce by hand-editing a field.
    expect(parseTags(",,character, faces,")).toEqual(["character", "faces"]);
  });

  it("treats no tags and an empty string the same", () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });
});

describe("datasetNameProblem", () => {
  it("accepts the names people actually use", () => {
    expect(datasetNameProblem("p@y v2 faces")).toBeNull();
  });

  it("rejects what would break an S3 prefix", () => {
    // The name becomes part of every image's key, forever.
    expect(datasetNameProblem("a/b")).not.toBeNull();
    expect(datasetNameProblem("")).not.toBeNull();
    expect(datasetNameProblem("x".repeat(101))).not.toBeNull();
  });

  it("agrees with the API, so the dialog cannot offer a name that 422s", () => {
    // Same character class as app/schemas/datasets.py's NAME_RE.
    for (const ok of ["k3lly2026", "p@y", "a b", "a_b", "a.b", "a-b"]) {
      expect(datasetNameProblem(ok)).toBeNull();
    }
  });
});

describe("datasetPrefix", () => {
  it("matches what the API will build", () => {
    expect(datasetPrefix("p@y v2 faces")).toBe("dataset-p@y-v2-faces");
  });
});

describe("byRecent", () => {
  it("puts the one you just touched first", () => {
    const older = ds({ id: "a", updated_at: "2026-09-01T00:00:00Z" });
    const newer = ds({ id: "b", updated_at: "2026-09-07T00:00:00Z" });
    expect([older, newer].sort(byRecent)[0].id).toBe("b");
  });
});
