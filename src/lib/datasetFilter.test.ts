import { describe, expect, it } from "vitest";

import { datasetGroup, matchesShow, parseShow, showCounts } from "./datasetFilter";
import { ownerLabel } from "./datasets";
import type { DatasetKind } from "../api/types";

/** The Datasets page filter (wanly-console#643). */
describe("dataset show filter", () => {
  const sets = (kinds: (DatasetKind | null)[]) => kinds.map((kind) => ({ kind }));

  it("groups by kind: character = single, composition = pair", () => {
    expect(datasetGroup({ kind: "character" })).toBe("singles");
    expect(datasetGroup({ kind: "composition" })).toBe("pairs");
    expect(datasetGroup({ kind: "regularization" })).toBe("regularization");
    expect(datasetGroup({ kind: null })).toBeNull();
    expect(datasetGroup({})).toBeNull();
  });

  it("agrees with the owner badge, so a 'Pair · x' card is never filtered as a single", () => {
    for (const kind of ["character", "composition", "regularization"] as const) {
      const badge = ownerLabel({ kind, character: "x", reg_class: "woman" })!;
      expect(matchesShow({ kind }, "pairs")).toBe(badge.startsWith("Pair ·"));
      expect(matchesShow({ kind }, "singles")).toBe(badge.startsWith("Character ·"));
    }
  });

  it("shows unassigned sets under All only", () => {
    expect(matchesShow({ kind: null }, "all")).toBe(true);
    expect(matchesShow({ kind: null }, "singles")).toBe(false);
    expect(matchesShow({ kind: null }, "pairs")).toBe(false);
  });

  it("reads ?show= back, unknown values as All", () => {
    expect(parseShow("pairs")).toBe("pairs");
    expect(parseShow("singles")).toBe("singles");
    expect(parseShow(null)).toBe("all");
    expect(parseShow("couples")).toBe("all");
  });

  it("counts each option", () => {
    expect(showCounts(sets(["character", "character", "composition", null, "regularization"])))
      .toEqual({ all: 5, singles: 2, pairs: 1, regularization: 1 });
  });
});
