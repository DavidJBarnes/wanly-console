import { describe, expect, it } from "vitest";
import { renderPrompt } from "../api/ltx";
import { submitPrompt } from "./captionRegion";
import { PROMPT_TOKEN, withTriggers } from "./enhancedPrompt";

describe("withTriggers", () => {
  it("puts the trigger phrase in front", () => {
    expect(withTriggers(["k3llydw, woman"], "She turns toward the camera."))
      .toBe("k3llydw, woman, She turns toward the camera.");
  });
  it("keeps slot order for two characters", () => {
    expect(withTriggers(["d4vid, man", "p@yton, woman"], " A couple on a sofa. "))
      .toBe("d4vid, man, p@yton, woman, A couple on a sofa.");
  });
  it("adds nothing for no character or an empty phrase", () => {
    expect(withTriggers([], "A sofa.")).toBe("A sofa.");
    expect(withTriggers(["", undefined, null], "A sofa.")).toBe("A sofa.");
  });
});

describe("<PROMPT> (wanly-api#484)", () => {
  it("reaches the API exactly as written -- the API swaps the script in at the claim", () => {
    const p = `k3llydw, woman, ${PROMPT_TOKEN}`;
    expect(submitPrompt(p)).toBe(p);
    expect(submitPrompt(`<scene>a sofa</scene>, ${PROMPT_TOKEN}`)).toBe(`a sofa, ${PROMPT_TOKEN}`);
  });
  it("survives the trigger fill", () => {
    expect(renderPrompt(`<TRIGGER>, ${PROMPT_TOKEN}`, "k3llydw, woman"))
      .toBe(`k3llydw, woman, ${PROMPT_TOKEN}`);
  });
});
