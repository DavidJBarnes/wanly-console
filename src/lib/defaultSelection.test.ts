import { describe, expect, it } from "vitest";

import type { Character, Pose } from "../api/ltx";
import { preselectCharacter, preselectPose } from "./defaultSelection";

const char = (name: string, is_default?: boolean): Character =>
  ({ id: `c-${name}`, name, is_default } as unknown as Character);
const pose = (id: string, is_default?: boolean): Pose =>
  ({ id, name: id, is_default } as unknown as Pose);

describe("preselectCharacter (console#543)", () => {
  const chars = [char("alice"), char("bob", true), char("carol")];

  it("selects the default when nothing is selected", () => {
    expect(preselectCharacter("", chars)).toBe("bob");
  });

  it("keeps a selection that is already made — a pick or a carried-over one wins", () => {
    expect(preselectCharacter("carol", chars)).toBe("carol");
  });

  it("keeps the explicit 'no character' choice", () => {
    expect(preselectCharacter("none", chars)).toBe("none");
  });

  it("falls back to the first when there is no default, exactly as before", () => {
    expect(preselectCharacter("", [char("alice"), char("bob", false)])).toBe("alice");
  });

  it("treats an API that predates is_default as no default", () => {
    expect(preselectCharacter("", [char("alice"), char("bob")])).toBe("alice");
  });

  it("is blank when there are no characters", () => {
    expect(preselectCharacter("", [])).toBe("");
  });
});

describe("preselectPose (console#543)", () => {
  const poses = [pose("p1"), pose("p2"), pose("p3", true)];

  it("selects the default when nothing is selected", () => {
    expect(preselectPose("", poses)).toBe("p3");
  });

  it("keeps a selection that is already made", () => {
    expect(preselectPose("p2", poses)).toBe("p2");
  });

  it("falls back to the first when there is no default, exactly as before", () => {
    expect(preselectPose("", [pose("p1"), pose("p2")])).toBe("p1");
  });

  it("is blank when there are no poses", () => {
    expect(preselectPose("", [])).toBe("");
  });
});
