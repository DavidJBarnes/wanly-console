import { describe, expect, it } from "vitest";

import { overrideNumber } from "./overrideValue";

describe("overrideNumber", () => {
  it("treats empty as inherit", () => {
    expect(overrideNumber("")).toBeNull();
    expect(overrideNumber("   ")).toBeNull();
  });

  it("keeps a typed zero, which is the entire point", () => {
    // 0 and "" are both falsy. img_compression 0 bypasses the encode; a content strength of
    // 0 loads the LoRA with no weight. Turning either into null renders at the stack
    // default and looks like a finding about the LoRA rather than a bug in the form.
    expect(overrideNumber("0")).toBe(0);
    expect(overrideNumber(" 0 ")).toBe(0);
    expect(overrideNumber("0.0")).toBe(0);
  });

  it("passes ordinary values through", () => {
    expect(overrideNumber("0.6")).toBe(0.6);
    expect(overrideNumber("18")).toBe(18);
    expect(overrideNumber("1.5")).toBe(1.5);
  });

  it("does not turn a typo into a silent inherit", () => {
    // "o.6" reaching the API as null would store "use the stack" and the user would never
    // learn their value was dropped.
    expect(overrideNumber("o.6")).toBeNull();
    expect(overrideNumber("abc")).toBeNull();
  });
});
