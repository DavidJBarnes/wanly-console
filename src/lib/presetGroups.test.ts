import { describe, it, expect } from "vitest";
import { UNGROUPED, collectGroups, filterByGroups, groupOf } from "./presetGroups";

const p = (name: string) => ({ name });

describe("groupOf", () => {
  it("takes the text before the first spaced hyphen", () => {
    expect(groupOf("Final - Doggystyle (front facing)")).toBe("Final");
    expect(groupOf("Final - Doggystyle - front")).toBe("Final");
  });

  it("ignores hyphens that are not the separator", () => {
    // "Wan-2.2 base" is one name. Matching a bare hyphen would invent a "Wan" group.
    expect(groupOf("Wan-2.2 base")).toBeNull();
    expect(groupOf("k3llydw")).toBeNull();
  });

  it("has no group when the name starts with the separator", () => {
    expect(groupOf(" - orphan")).toBeNull();
  });
});

describe("collectGroups", () => {
  it("lists each group once, alphabetically", () => {
    expect(collectGroups([p("Test - b"), p("Final - a"), p("Final - c")])).toEqual([
      "Final",
      "Test",
    ]);
  });

  it("treats groups case-insensitively, keeping the first spelling", () => {
    expect(collectGroups([p("Final - a"), p("final - b")])).toEqual(["Final"]);
  });

  it("adds Ungrouped last, and only when something is ungrouped", () => {
    expect(collectGroups([p("Final - a"), p("k3llydw")])).toEqual(["Final", UNGROUPED]);
    expect(collectGroups([p("Final - a")])).toEqual(["Final"]);
  });

  it("derives from whatever list it is given — which is how it follows the archived toggle", () => {
    const all = [p("Final - a"), p("Retired - b")];
    expect(collectGroups(all)).toEqual(["Final", "Retired"]);
    expect(collectGroups(all.slice(0, 1))).toEqual(["Final"]);
  });
});

describe("filterByGroups", () => {
  const presets = [p("Final - a"), p("Test - b"), p("k3llydw")];

  it("shows everything when no pill is selected", () => {
    expect(filterByGroups(presets, new Set())).toEqual(presets);
  });

  it("narrows to one group", () => {
    expect(filterByGroups(presets, new Set(["Final"])).map((x) => x.name)).toEqual(["Final - a"]);
  });

  it("unions multiple selected groups", () => {
    expect(filterByGroups(presets, new Set(["Final", "Test"])).map((x) => x.name)).toEqual([
      "Final - a",
      "Test - b",
    ]);
  });

  it("selects the ungrouped presets via the Ungrouped pill", () => {
    expect(filterByGroups(presets, new Set([UNGROUPED])).map((x) => x.name)).toEqual(["k3llydw"]);
  });

  it("matches the pill against the name case-insensitively", () => {
    expect(filterByGroups([p("final - a")], new Set(["Final"]))).toHaveLength(1);
  });
});
