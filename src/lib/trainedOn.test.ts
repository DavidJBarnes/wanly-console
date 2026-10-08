import { describe, expect, it } from "vitest";

import type { TrainedOnGroup } from "../api/types";
import { diffSummary, groupTitle } from "./trainedOn";

const g = (over: Partial<TrainedOnGroup> = {}): TrainedOnGroup => ({
  group_index: 0, kind: "identity", dataset_name: "Joana", dataset_name_as_trained: "Joana",
  dataset_exists: true, num_repeats: 10, windows: 1,
  images: [{ uri: "s3://b/a.jpg" }, { uri: "s3://b/b.jpg" }],
  added_since: [], removed_since: [], ...over,
});

describe("trained-on (wanly-api#422)", () => {
  it("titles a group by its dataset now, repeats included", () => {
    expect(groupTitle(g())).toBe("Joana — identity · 2 × 10");
  });

  it("says the name it trained under when that differs", () => {
    expect(groupTitle(g({ dataset_name_as_trained: "Joana v4" })))
      .toBe("Joana (trained as “Joana v4”) — identity · 2 × 10");
  });

  it("says when the dataset is gone", () => {
    expect(groupTitle(g({ dataset_exists: false, dataset_name: "Joana v1",
                          dataset_name_as_trained: "Joana v1" })))
      .toBe("Joana v1 — dataset deleted — identity · 2 × 10");
    expect(diffSummary(g({ dataset_exists: false }))).toBeNull();
  });

  it("summarises how the set moved on", () => {
    expect(diffSummary(g())).toBe("unchanged since");
    expect(diffSummary(g({ added_since: ["x", "y"], removed_since: ["z"] })))
      .toBe("+2 added, −1 removed since");
  });
});
