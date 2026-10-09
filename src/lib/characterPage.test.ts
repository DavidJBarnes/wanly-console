import { describe, expect, it } from "vitest";
import { characterPicture, characterSetHome, ownerOf } from "./characterPage";

const chars = [{ name: "Joana" }, { name: "DavidJoana" }];

describe("characterPicture", () => {
  it("prefers a chosen icon, then the dataset's anchor, then the old fallbacks", () => {
    expect(characterPicture({ icon_uri: "s3://i.png", image_uri: "s3://x.png" }, "s3://a.png")).toBe("s3://i.png");
    expect(characterPicture({ icon_uri: null, image_uri: "s3://x.png" }, "s3://a.png")).toBe("s3://a.png");
    expect(characterPicture({ icon_uri: null, image_uri: "s3://x.png" }, null)).toBe("s3://x.png");
  });
});

describe("ownerOf", () => {
  it("is the registered owner of a living character or composition set", () => {
    expect(ownerOf({ kind: "character", character: "Joana", archived_at: null }, chars)).toBe("Joana");
    expect(ownerOf({ kind: "composition", character: "DavidJoana", archived_at: null }, chars)).toBe("DavidJoana");
  });
  it("is nobody for archived, unassigned, regularization or unregistered sets", () => {
    expect(ownerOf({ kind: "character", character: "Joana", archived_at: "2026-10-08" }, chars)).toBeNull();
    expect(ownerOf({ kind: null, character: null, archived_at: null }, chars)).toBeNull();
    expect(ownerOf({ kind: "regularization", character: null, archived_at: null }, chars)).toBeNull();
    expect(ownerOf({ kind: "character", character: "Ghost", archived_at: null }, chars)).toBeNull();
  });
});

describe("characterSetHome", () => {
  it("lands on Images, or on Training with the run from an old /training?run= link", () => {
    expect(characterSetHome("Joana", null)).toBe("/characters/Joana?tab=images");
    expect(characterSetHome("Kelly-2000", "r1")).toBe("/characters/Kelly-2000?tab=training&run=r1");
  });
});
