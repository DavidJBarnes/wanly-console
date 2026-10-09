import { describe, expect, it } from "vitest";
import { anchorFirst, groupDerived, keepOnly, removedSource, rootOf } from "./lineage";
import type { DatasetDerived } from "../api/types";

const d = (from: string, how: DatasetDerived["how"]): DatasetDerived => ({ from, how });

describe("lineage grouping (wanly-api#445)", () => {
  const derived = {
    crop: d("photo", "crop"),
    edit: d("photo", "edit"),
    cropOfEdit: d("edit", "crop"),
    orphan: d("gone", "upscale"),
  };

  it("groups every derived image under its furthest ancestor still in the set", () => {
    const set = new Set(["photo", "crop", "edit", "cropOfEdit"]);
    expect(rootOf("cropOfEdit", derived, set)).toBe("photo");
    expect(rootOf("photo", derived, set)).toBe("photo");
  });

  it("keeps the page's order, each group where its earliest member falls", () => {
    const groups = groupDerived(["x", "crop", "photo", "edit", "cropOfEdit", "orphan"], derived);
    expect(groups.map((g) => g.head)).toEqual(["x", "photo", "orphan"]);
    expect(groups[1].members).toEqual([
      { uri: "photo", role: "original" }, { uri: "crop", role: "crop" },
      { uri: "edit", role: "edit" }, { uri: "cropOfEdit", role: "crop" },
    ]);
    expect(groups[2].members).toEqual([{ uri: "orphan", role: "upscale" }]);
  });

  it("says where a derived image came from when its source left the set", () => {
    const set = new Set(["orphan"]);
    expect(removedSource("orphan", derived, set)).toBe("gone");
    expect(removedSource("crop", derived, new Set(["crop", "photo"]))).toBeNull();
  });

  it("puts the anchor's group first; an anchor not in the set changes nothing", () => {
    const groups = groupDerived(["x", "photo", "crop"], derived);
    const has = (g: { members: { uri: string }[] }, u: string) => g.members.some((m) => m.uri === u);
    expect(anchorFirst(groups, "crop", has).map((g) => g.head)).toEqual(["photo", "x"]);
    expect(anchorFirst(groups, "nope", has)).toBe(groups);
    expect(anchorFirst(["a", "b", "c"], "c", (u, a) => u === a)).toEqual(["c", "a", "b"]);
  });

  it("keep only this drops the group's other members and nothing else", () => {
    const g = groupDerived(["photo", "crop", "x"], derived)[0];
    expect(keepOnly(["photo", "crop", "x"], g, "crop")).toEqual(["crop", "x"]);
  });
});
