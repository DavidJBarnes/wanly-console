import { describe, expect, it } from "vitest";
import { poseWarnings, renderPrompt, TRIGGER_PLACEHOLDER } from "../api/ltx";
import type { Character } from "../api/ltx";

const chars: Character[] = [
  { id: "1", name: "k3lly2026", char_lora: "k3lly2026_v2", trigger: "k3lly2026", strength_stage_1: 0.8, strength_stage_2: 1.5 },
  { id: "2", name: "p@y", char_lora: "pay_v2_e05", trigger: "p@y", strength_stage_1: 0.8, strength_stage_2: 1.5 },
];

describe("poseWarnings", () => {
  it("says nothing about a well-formed template", () => {
    expect(poseWarnings(`${TRIGGER_PLACEHOLDER}, a woman standing`, chars)).toEqual([]);
  });

  it("warns, but does not block, when nothing names the subject", () => {
    // Legitimate but unusual: a shot that never names the subject still renders. The point
    // is that producing one SILENTLY is the problem, not producing one at all.
    const w = poseWarnings("a woman standing", chars);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain(TRIGGER_PLACEHOLDER);
  });

  it("catches a hardcoded character, which is the mistake #212 exists to undo", () => {
    const w = poseWarnings("k3lly2026, a woman standing", chars);
    expect(w.join(" ")).toContain("k3lly2026");
  });

  it("does not fire on a trigger that merely appears inside another word", () => {
    // Substring matching would flag any prompt containing the letters. Word boundaries
    // keep "payment" from reading as the character "p@y".
    expect(poseWarnings(`${TRIGGER_PLACEHOLDER}, counting payment slips`, chars)).toEqual([]);
  });

  it("treats a trigger with regex characters literally", () => {
    // "p@y" is tame, but a trigger is free text: a "." or "+" compiled into a pattern
    // would match things it should not, or throw.
    const odd: Character[] = [
      { id: "3", name: "a.b", char_lora: "l", trigger: "a.b", strength_stage_1: 0.8, strength_stage_2: 1.5 },
    ];
    expect(poseWarnings(`${TRIGGER_PLACEHOLDER}, axb standing`, odd)).toEqual([]);
    expect(poseWarnings(`${TRIGGER_PLACEHOLDER}, a.b standing`, odd).join(" ")).toContain("a.b");
  });
});

describe("renderPrompt", () => {
  it("fills every occurrence, not just the first", () => {
    expect(renderPrompt(`${TRIGGER_PLACEHOLDER} and ${TRIGGER_PLACEHOLDER}`, "k9")).toBe("k9 and k9");
  });

  it("leaves a template with no placeholder untouched", () => {
    expect(renderPrompt("a woman standing", "k9")).toBe("a woman standing");
  });
});
