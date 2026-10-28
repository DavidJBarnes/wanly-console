import { describe, expect, it } from "vitest";
import { renderPrompt } from "../api/ltx";
import { submitPrompt } from "./captionRegion";
import {
  PROMPT_TOKEN, fillEnhanced, hasEnhancedRegion, submitEnhanced, unfillEnhanced, wantsEnhanced,
  withTriggers,
} from "./enhancedPrompt";

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

describe("filling <PROMPT> in the form (wanly-api#484)", () => {
  const SCRIPT = "This close-up video shows a woman by a pool.";
  const filled = `k3llydw, woman, <prompt>${SCRIPT}</prompt>`;

  it("fills the placeholder as a marked region", () => {
    expect(fillEnhanced(`k3llydw, woman, ${PROMPT_TOKEN}`, SCRIPT)).toBe(filled);
  });
  it("rewrites the region in place for a new frame, instead of appending", () => {
    expect(fillEnhanced(filled, "A man on a sofa.")).toBe("k3llydw, woman, <prompt>A man on a sofa.</prompt>");
  });
  it("submits the words, without markers", () => {
    expect(submitEnhanced(submitPrompt(filled))).toBe(`k3llydw, woman, ${SCRIPT}`);
  });
  it("keeps a bare placeholder for the API, and removes stray spellings", () => {
    expect(submitEnhanced(`a, ${PROMPT_TOKEN}`)).toBe(`a, ${PROMPT_TOKEN}`);
    expect(submitEnhanced("a, <prompt> b <Prompt>")).toBe("a,  b ");
  });
  it("is not an edit of the recipe once the placeholder is restored", () => {
    expect(unfillEnhanced(filled)).toBe(`k3llydw, woman, ${PROMPT_TOKEN}`);
  });
  it("scrubs angle-bracket tokens from the script -- the API would read them as wildcards", () => {
    expect(fillEnhanced(PROMPT_TOKEN, "She waits <SCENE> by the <colour> door."))
      .toBe("<prompt>She waits  by the  door.</prompt>");
  });
  it("knows whether the prompt wants it, filled or not", () => {
    expect(wantsEnhanced(`a, ${PROMPT_TOKEN}`)).toBe(true);
    expect(wantsEnhanced(filled)).toBe(true);
    expect(hasEnhancedRegion(filled)).toBe(true);
    expect(hasEnhancedRegion(`a, ${PROMPT_TOKEN}`)).toBe(false);
    expect(wantsEnhanced("a woman on a sofa")).toBe(false);
  });
  it("fills alongside a filled scene", () => {
    const p = fillEnhanced(`<scene>a pool</scene>. ${PROMPT_TOKEN}`, SCRIPT);
    expect(submitEnhanced(submitPrompt(p))).toBe(`a pool. ${SCRIPT}`);
  });
});
