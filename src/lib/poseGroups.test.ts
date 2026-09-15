import { describe, expect, it } from "vitest";

import type { Pose } from "../api/ltx";
import { groupPosesByBook } from "./poseGroups";

/** Only the fields the grouping reads; a Pose is a large object and the rest is irrelevant. */
const pose = (name: string, book_name: string): Pose =>
  ({ id: name, name, book_name }) as Pose;

describe("groupPosesByBook", () => {
  it("groups consecutive poses under their book, preserving order", () => {
    expect(
      groupPosesByBook([pose("a", "10eros"), pose("b", "10eros"), pose("c", "sulphur")]),
    ).toEqual([
      ["10eros", [pose("a", "10eros"), pose("b", "10eros")]],
      ["sulphur", [pose("c", "sulphur")]],
    ]);
  });

  it("keeps a book together even when the API interleaves it", () => {
    // The catalog orders by book, but a re-sort must not split one book into two headings —
    // a Map keyed by name is what guarantees that, and this is the test that pins it.
    const groups = groupPosesByBook([pose("a", "10eros"), pose("b", "sulphur"), pose("c", "10eros")]);
    expect(groups.map(([name]) => name)).toEqual(["10eros", "sulphur"]);
    expect(groups[0][1].map((p) => p.name)).toEqual(["a", "c"]);
  });

  it("files a pose with no book under a fallback heading rather than dropping it", () => {
    expect(groupPosesByBook([pose("a", "")])).toEqual([["Unfiled", [pose("a", "")]]]);
  });

  it("returns nothing for no poses", () => {
    expect(groupPosesByBook([])).toEqual([]);
  });
});
