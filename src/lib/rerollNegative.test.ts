import { describe, expect, it } from "vitest";

import { rerollNegativeToSend } from "./rerollNegative";

describe("rerollNegativeToSend", () => {
  it("posts nothing when the box matches the take, so an untouched dialog rolls only the seed", () => {
    expect(rerollNegativeToSend("blurry", "blurry")).toBeUndefined();
    expect(rerollNegativeToSend("blurry", "  blurry  ")).toBeUndefined();
  });

  it("treats text over a NULL take as the field just sitting there, not a clear", () => {
    // The prefill of a NULL-negative take is "", so this is the untouched case for older
    // rows — posting anything here would freeze the live default into a snapshot.
    expect(rerollNegativeToSend(null, "")).toBeUndefined();
    expect(rerollNegativeToSend(null, "   ")).toBeUndefined();
  });

  it("posts an explicit drop only when clearing over a take that had a value", () => {
    // The API stores NULL, and the claim resolves the live Settings default again. A take
    // with no negative has nothing to drop, which is the rule above.
    expect(rerollNegativeToSend("blurry", "")).toBe("");
  });

  it("posts the typed text when the negative actually changes", () => {
    expect(rerollNegativeToSend("blurry", "worse")).toBe("worse");
    expect(rerollNegativeToSend(null, "hazy")).toBe("hazy");
  });
});
