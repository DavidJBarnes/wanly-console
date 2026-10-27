import { describe, expect, it } from "vitest";
import { withTriggers } from "./enhancedPrompt";

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
