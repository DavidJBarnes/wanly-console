import { describe, expect, it } from "vitest";

import { mergeLoraOptions } from "./loraOptions";

describe("mergeLoraOptions", () => {
  it("offers bucket LoRAs that no character uses yet", () => {
    // The reason the dropdown exists. Before #395 the list came from characters only, so a
    // never-used LoRA was unpickable and a new character could not be created for it.
    expect(mergeLoraOptions([], ["k3lly2026_v2.safetensors"])).toEqual(["k3lly2026_v2"]);
  });

  it("keeps a character's own LoRA even once it has left the bucket", () => {
    // Otherwise opening that character's edit dialog shows an empty LoRA field, and saving
    // writes the blank back — losing the setting by looking at it.
    expect(mergeLoraOptions(["retired_v1"], ["current_v2.safetensors"]))
      .toEqual(["current_v2", "retired_v1"]);
  });

  it("does not list one LoRA twice because the two sources spell it differently", () => {
    // The bucket carries the extension, a character row may not. Both render fine, so the
    // only symptom would be a duplicated dropdown entry.
    expect(mergeLoraOptions(["p@y"], ["p@y.safetensors"])).toEqual(["p@y"]);
  });

  it("drops empties rather than offering a blank row", () => {
    expect(mergeLoraOptions(["", "  "], [".safetensors"])).toEqual([]);
  });

  it("sorts, so the list does not reorder itself between loads", () => {
    expect(mergeLoraOptions([], ["b.safetensors", "a.safetensors"])).toEqual(["a", "b"]);
  });
});
