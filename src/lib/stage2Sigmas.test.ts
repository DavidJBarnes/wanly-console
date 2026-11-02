import { describe, it, expect } from "vitest";
import { stage2SigmasProblem } from "./stage2Sigmas";

describe("stage2SigmasProblem", () => {
  it.each(["", "  ", "0.85, 0.725, 0.4219, 0.0", "0.7,0", "1, .5, 0"])("accepts %j", (text) => {
    expect(stage2SigmasProblem(text)).toBeNull();
  });

  it.each([
    ["0.5", "between 2"],
    ["1.5, 0", "1 or below"],
    ["0.4, 0.7, 0", "lower than"],
    ["0.7, 0.7, 0", "lower than"],
    ["0.7, 0.4", "End at 0"],
    ["1e-1, 0", "plain decimals"],
    ["0.7, -0.1, 0", "plain decimals"],
    ["0.7, abc, 0", "plain decimals"],
  ])("refuses %j", (text, why) => {
    expect(stage2SigmasProblem(text)).toContain(why);
  });
});
