import { describe, expect, it } from "vitest";

import { lorasForCharacter, mergeLoraOptions } from "./loraOptions";

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

describe("lorasForCharacter (console#680)", () => {
  const all = [
    "DavidJoana_v2_final", "Joana_v1_final", "Joana_v3_e03", "Kelly-2000_v1_final",
    "Payton-Synthetic_v1_final", "Payton_v2_final", "Payton_v3_final", "k3llydw_v2",
    "karoline_v1_final", "Karoline_v3_final",
  ];

  it("lists the character's own runs, synthetic ones included", () => {
    expect(lorasForCharacter("Payton", all))
      .toEqual(["Payton-Synthetic_v1_final", "Payton_v2_final", "Payton_v3_final"]);
  });

  it("anchors at the start: a pair's LoRA is not a member's", () => {
    expect(lorasForCharacter("Joana", all)).toEqual(["Joana_v1_final", "Joana_v3_e03"]);
    expect(lorasForCharacter("DavidJoana", all)).toEqual(["DavidJoana_v2_final"]);
  });

  it("ignores case", () => {
    expect(lorasForCharacter("Karoline", all)).toEqual(["karoline_v1_final", "Karoline_v3_final"]);
  });

  it("does not treat another suffix as the same character", () => {
    expect(lorasForCharacter("Kelly", all)).toBeNull();
  });

  it("always keeps the current LoRA and the selected value", () => {
    expect(lorasForCharacter("Kelly-2000", all, ["k3llydw_v2", "none", null]))
      .toEqual(["k3llydw_v2", "Kelly-2000_v1_final"]);
  });

  it("gives up (null) when nothing matches or there is no name", () => {
    expect(lorasForCharacter("Newbie", all)).toBeNull();
    expect(lorasForCharacter("", all)).toBeNull();
    expect(lorasForCharacter(undefined, all)).toBeNull();
  });

  it("escapes the name", () => {
    expect(lorasForCharacter("Pay.on", all)).toBeNull();
  });
});
