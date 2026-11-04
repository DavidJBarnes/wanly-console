import { describe, expect, it } from "vitest";
import { editRow, fromRows, removeRow, textToOptions, toRows } from "./wildcardOptions";

describe("wildcardOptions", () => {
  it("bulk text drops blanks and trims", () => {
    expect(textToOptions("  a \n\n b\n")).toEqual(["a", "b"]);
  });

  it("toRows always gives at least one row", () => {
    expect(toRows([])).toHaveLength(1);
    expect(toRows(["x", "y"]).map((r) => r.text)).toEqual(["x", "y"]);
  });

  it("rows have unique ids", () => {
    const ids = toRows(["a", "b", "c"]).map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("plain edit changes the row in place", () => {
    const rows = toRows(["a", "b"]);
    const r = editRow(rows, 1, "bee");
    expect(r.rows.map((x) => x.text)).toEqual(["a", "bee"]);
    expect(r.rows[1].id).toBe(rows[1].id);
    expect(r.focus).toBe(1);
  });

  it("Enter at the end opens an empty row below and focuses it", () => {
    const r = editRow(toRows(["a", "b"]), 0, "a\n");
    expect(r.rows.map((x) => x.text)).toEqual(["a", "", "b"]);
    expect(r.focus).toBe(1);
  });

  it("a multi-line paste becomes several rows", () => {
    const r = editRow(toRows(["a"]), 0, "one\r\ntwo\nthree");
    expect(r.rows.map((x) => x.text)).toEqual(["one", "two", "three"]);
    expect(r.focus).toBe(2);
  });

  it("removing the last row leaves one empty row", () => {
    expect(removeRow(toRows(["a"]), 0).map((r) => r.text)).toEqual([""]);
  });

  it("fromRows trims and drops empty rows", () => {
    const rows = editRow(toRows(["  a "]), 0, "  a \n").rows;
    expect(fromRows(rows)).toEqual(["a"]);
  });
});
