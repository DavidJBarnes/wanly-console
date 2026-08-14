import { describe, it, expect } from "vitest";
import {
  describeFilter,
  hasFilter,
  isTagSelected,
  parseTagParam,
  serializeTagParam,
  toggleTag,
} from "./imageFilter";

describe("parseTagParam", () => {
  it("splits on commas and trims", () => {
    expect(parseTagParam("Kelly, Missionary")).toEqual(["Kelly", "Missionary"]);
  });

  it("drops empty segments rather than sending blank tags", () => {
    // The API rejects a filter that filters nothing, and ",,Kelly," is easy to produce by
    // hand-editing the URL.
    expect(parseTagParam(",,Kelly,")).toEqual(["Kelly"]);
    expect(parseTagParam("")).toEqual([]);
    expect(parseTagParam(null)).toEqual([]);
  });

  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    expect(parseTagParam("Kelly,kelly")).toEqual(["Kelly"]);
  });
});

describe("serializeTagParam", () => {
  it("joins with commas", () => {
    expect(serializeTagParam(["Kelly", "Missionary"])).toBe("Kelly,Missionary");
  });

  it("returns null for an empty selection so the param is dropped", () => {
    expect(serializeTagParam([])).toBeNull();
    expect(serializeTagParam(["  "])).toBeNull();
  });
});

describe("toggleTag", () => {
  it("adds then removes", () => {
    expect(toggleTag([], "Kelly")).toEqual(["Kelly"]);
    expect(toggleTag(["Kelly"], "Kelly")).toEqual([]);
  });

  it("matches case-insensitively so a tag cannot be selected twice", () => {
    expect(toggleTag(["Kelly"], "kelly")).toEqual([]);
  });

  it("keeps the other tags in order", () => {
    expect(toggleTag(["Kelly", "Missionary"], "Kelly")).toEqual(["Missionary"]);
  });
});

describe("isTagSelected", () => {
  it("is case-insensitive", () => {
    expect(isTagSelected(["Kelly"], "kelly")).toBe(true);
    expect(isTagSelected(["Kelly"], "KellyYoung")).toBe(false);
  });
});

describe("hasFilter", () => {
  it("is true for either control and false for neither", () => {
    expect(hasFilter("", [])).toBe(false);
    expect(hasFilter("   ", [])).toBe(false);
    expect(hasFilter("00111", [])).toBe(true);
    expect(hasFilter("", ["Kelly"])).toBe(true);
  });
});

describe("describeFilter", () => {
  it("names both controls, tags first", () => {
    expect(describeFilter("00111", ["Kelly", "Missionary"])).toBe('Kelly + Missionary + "00111"');
    expect(describeFilter("", ["Kelly"])).toBe("Kelly");
    expect(describeFilter("00111", [])).toBe('"00111"');
  });
});
