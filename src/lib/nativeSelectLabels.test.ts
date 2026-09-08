import { describe, it, expect } from "vitest";

/**
 * A native select ALWAYS renders one of its options, so its label has nowhere to sit unshrunk.
 * MUI decides whether to shrink by looking at `value`, which means a select whose default is
 * the empty string gets a full-size label painted straight over the visible option:
 *
 *     "Score against" over "no reference (weak check)"  — Datasets crop dialog, 2026-09-08
 *
 * The other two native selects in the app escaped it only because their values are never
 * empty. That is luck, not a rule, so this asserts the rule.
 *
 * Sources are read with import.meta.glob rather than node:fs — the app tsconfig carries no
 * node types, and `npm run build` runs tsc over this file. A source scan rather than a render
 * test because vite.config.ts is node-env and pure-logic only; there is no component runner.
 */
const SOURCES = import.meta.glob("../**/*.tsx", {
  query: "?raw", eager: true, import: "default",
}) as Record<string, string>;

describe("every native select with a label shrinks it", () => {
  it("reads the component sources at all", () => {
    // Guards the guard: a glob that matched nothing would make the next test pass vacuously.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(10);
  });

  it("recognises the shape it is guarding against", () => {
    const sample = '<TextField select SelectProps={{ native: true }} label="X" />';
    expect(offendersIn("sample.tsx", sample)).toEqual(["sample.tsx:1"]);
  });

  it("finds no TextField that would overlap its label", () => {
    const offenders = Object.entries(SOURCES).flatMap(([f, s]) => offendersIn(f, s));
    expect(offenders).toEqual([]);
  });
});

function offendersIn(file: string, src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<TextField\b[\s\S]*?>/g)) {
    const block = m[0];
    if (!block.includes("native: true")) continue;
    if (!/\blabel="/.test(block)) continue;
    if (block.includes("shrink")) continue;
    out.push(`${file}:${src.slice(0, m.index).split("\n").length}`);
  }
  return out;
}
