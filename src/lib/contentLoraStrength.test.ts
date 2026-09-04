import { describe, expect, it } from "vitest";

import { parseContentLoraStrength } from "./contentLoraStrength";

describe("parseContentLoraStrength", () => {
  it("accepts decimals, which is the entire point (console#419)", () => {
    expect(parseContentLoraStrength("0.6")).toBe(0.6);
    expect(parseContentLoraStrength("1.25")).toBe(1.25);
    expect(parseContentLoraStrength(" 0.8 ")).toBe(0.8);
  });

  it("accepts a half-typed decimal, because the field parses on save, not per keystroke", () => {
    // "0." is what exists between the "0" and the "6". Rejecting it here would be harmless;
    // rejecting it in the field is what broke the input.
    expect(parseContentLoraStrength("0.")).toBe(0);
  });

  it("keeps a typed zero", () => {
    // 0 loads the LoRA with no weight — a real setting, and the way to measure what a LoRA
    // contributes. It must not be collapsed into "no value".
    expect(parseContentLoraStrength("0")).toBe(0);
    expect(parseContentLoraStrength("0.0")).toBe(0);
  });

  it("rejects empty, which is not an inherit for a LoRA the pose lists", () => {
    expect(parseContentLoraStrength("")).toBeNull();
    expect(parseContentLoraStrength("   ")).toBeNull();
  });

  it("rejects a typo rather than sending 0", () => {
    expect(parseContentLoraStrength("o.6")).toBeNull();
    expect(parseContentLoraStrength("abc")).toBeNull();
  });

  it("holds the engine's 0-2 bound, so a 422 does not arrive mid-segment", () => {
    expect(parseContentLoraStrength("2")).toBe(2);
    expect(parseContentLoraStrength("2.01")).toBeNull();
    expect(parseContentLoraStrength("-0.5")).toBeNull();
  });
});
