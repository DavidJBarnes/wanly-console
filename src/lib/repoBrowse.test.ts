import { describe, it, expect } from "vitest";
import { clampPage, pageCount, repoBrowseMode } from "./repoBrowse";

describe("repoBrowseMode", () => {
  it("shows the folder listing when nothing is open or filtering", () => {
    expect(repoBrowseMode(false, false)).toBe("folders");
  });

  it("shows the filter results when filtering with no folder open", () => {
    expect(repoBrowseMode(false, true)).toBe("search");
  });

  it("lets an open folder win over an active filter", () => {
    // Clicking into a folder is deliberate; a leftover tag filter must not hide it.
    expect(repoBrowseMode(true, true)).toBe("folder");
    expect(repoBrowseMode(true, false)).toBe("folder");
  });
});

describe("pageCount", () => {
  it("rounds up and never drops below one", () => {
    expect(pageCount(0, 24)).toBe(1);
    expect(pageCount(1, 24)).toBe(1);
    expect(pageCount(24, 24)).toBe(1);
    expect(pageCount(25, 24)).toBe(2);
  });

  it("guards against a non-positive page size", () => {
    expect(pageCount(25, 0)).toBe(1);
  });
});

describe("clampPage", () => {
  it("leaves an in-range page alone", () => {
    expect(clampPage(0, 100, 24)).toBe(0);
    expect(clampPage(1, 100, 24)).toBe(1);
  });

  it("pulls a page past the end back to the last real page", () => {
    // Filtering narrowed the set from 5 pages to 2 while sitting on page 4.
    expect(clampPage(4, 25, 24)).toBe(1);
  });

  it("floors a negative page at zero", () => {
    expect(clampPage(-3, 100, 24)).toBe(0);
  });
});
