import { describe, expect, it } from "vitest";

import type { LtxRecipeRef } from "../api/types";
import {
  contentLoraLine,
  editedFields,
  recipeTitle,
  trainingLinks,
  shortGraphHash,
  trainingLink,
} from "./recipeDisplay";

const full: LtxRecipeRef = {
  recipe: "Missionary POV",
  character: "k3lly2026",
  trigger: "k3lly2026",
  char_lora: "k3lly2026_v2",
  char_s1: 0.8,
  char_s2: 1.5,
  frames: 241,
  content_loras: [
    { name: "riding", s1: 0.6, s2: 0.6 },
    { name: "a_very_long_motion_lora_name", s1: 0.75, s2: 0.4 },
  ],
  checkpoint: "10Eros_v1.5_bf16",
  edited: ["prompt", "char_s1"],
  graph_sha256: "85649768667ba700abcdef1234567890",
};

describe("recipeTitle", () => {
  it("names the configuration the way the job that made it was named", () => {
    expect(recipeTitle(full)).toBe("Missionary POV — k3lly2026");
  });

  it("spells out the no-character sentinel instead of printing 'none'", () => {
    expect(recipeTitle({ ...full, character: "none", trigger: "" })).toBe(
      "Missionary POV (no character)"
    );
  });

  it("returns null for every kind of absent blob, including a malformed one", () => {
    expect(recipeTitle(null)).toBeNull();
    expect(recipeTitle(undefined)).toBeNull();
    expect(recipeTitle({} as LtxRecipeRef)).toBeNull();
  });
});

describe("editedFields", () => {
  it("translates the recorded codes into the words the form uses", () => {
    expect(editedFields(full)).toEqual(["prompt", "character strength (stage 1)"]);
    expect(editedFields({ ...full, edited: [
      null, "negative", "char_lora", null, "char_s2",
    ] })).toEqual(["negative prompt", "character LoRA", "character strength (stage 2)"]);
  });

  it("reads an unedited render as exactly that", () => {
    expect(editedFields({ ...full, edited: [] })).toEqual([]);
    expect(editedFields({ ...full, edited: undefined })).toEqual([]);
    expect(editedFields(null)).toEqual([]);
  });

  it("passes a future code through raw rather than making an edit invisible", () => {
    expect(editedFields({ ...full, edited: ["frames"] })).toEqual(["frames"]);
  });
});

describe("contentLoraLine", () => {
  it("matches RecipeForm's 'Fixed by the recipe' spelling", () => {
    expect(contentLoraLine({ name: "riding", s1: 0.6, s2: 0.6 })).toBe("riding @ 0.6/0.6");
  });
});

describe("shortGraphHash", () => {
  it("truncates to the eight characters you compare between segments", () => {
    expect(shortGraphHash(full)).toBe("85649768");
  });

  it("returns null when the blob predates the hash or the worker never reported it", () => {
    expect(shortGraphHash({ ...full, graph_sha256: undefined })).toBeNull();
    expect(shortGraphHash(null)).toBeNull();
  });
});

describe("trainingLink", () => {
  it("points at the character's runs with the name for a highlight", () => {
    expect(trainingLink(full)).toBe("/training?character=k3lly2026");
  });

  it("encodes the name, because a character could have been named for the URL bar", () => {
    expect(trainingLink({ ...full, character: "two words" })).toBe(
      "/training?character=two%20words"
    );
  });

  it("skips the link for no-character renders and absent blobs", () => {
    expect(trainingLink({ ...full, character: "none" })).toBeNull();
    expect(trainingLink(null)).toBeNull();
  });
});

describe("two people (console#473)", () => {
  const two = {
    recipe: "Bedroom", character: "p@y", trigger: "p@y", char_lora: "pay_v2_e05",
    char_s1: 0.8, char_s2: 1.5, frames: 241,
    characters: [
      { name: "p@y", trigger: "p@y", char_lora: "pay_v2_e05", s1: 0.8, s2: 1.5 },
      { name: "Me", trigger: "d@vid", char_lora: "david_v1_final", s1: 0.7, s2: 1.2 },
    ],
  };
  it("the title names both", () => {
    expect(recipeTitle(two)).toBe("Bedroom — p@y & Me");
  });
  it("one training link per person", () => {
    expect(trainingLinks(two).map((l) => l.name)).toEqual(["p@y", "Me"]);
    expect(trainingLinks(two)[1].href).toBe("/training?character=Me");
  });
  it("a legacy scalar blob still titles and links", () => {
    const one = { ...two, characters: undefined };
    expect(recipeTitle(one)).toBe("Bedroom — p@y");
    expect(trainingLinks(one)).toHaveLength(1);
  });
  it("the second character's edits have words", () => {
    expect(editedFields({ ...two, edited: ["char2_lora", "char2_s1"] })).toEqual([
      "second character's LoRA", "second character's strength (stage 1)",
    ]);
  });
});
