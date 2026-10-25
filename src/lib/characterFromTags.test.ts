import { describe, expect, it } from "vitest";

import type { Character } from "../api/ltx";
import { guessCharacterFromTags } from "./characterFromTags";

const char = (name: string, extra: Partial<Character> = {}): Character =>
  ({ id: `c-${name}`, name, ...extra } as unknown as Character);

const chars = [
  char("Chelsey"),
  char("David"),
  char("Kelly-2000"),
  char("Kelly-2026"),
  char("DavidChelsey", { kind: "pair", members: ["David", "Chelsey"] }),
  char("Payton", { hidden: true }),
];
const pick = (tags: string | null) => guessCharacterFromTags(tags, chars)?.name ?? null;

describe("guessCharacterFromTags (console#696)", () => {
  it("matches a tag that is a character's name, ignoring case", () => {
    expect(pick("Doggystyle, chelsey")).toBe("Chelsey");
  });

  it("aliases KellyYoung to Kelly-2000 and Kelly to Kelly-2026", () => {
    expect(pick("KellyYoung, Missionary")).toBe("Kelly-2000");
    expect(pick("Kelly, Missionary")).toBe("Kelly-2026");
  });

  it("does not treat other Kelly tags as either Kelly", () => {
    expect(pick("KellyBangs, KellyTeacher")).toBeNull();
  });

  it("prefers a pair whose members are all tagged, and says which tags", () => {
    expect(guessCharacterFromTags("Cowgirl, Chelsey, David", chars))
      .toEqual({ name: "DavidChelsey", matched: ["David", "Chelsey"] });
  });

  it("takes one member alone when the other is not tagged", () => {
    expect(pick("David, Cowgirl")).toBe("David");
  });

  it("never picks a hidden character", () => {
    expect(pick("Payton")).toBeNull();
  });

  it("is null with no tags or no matching tag", () => {
    expect(pick(null)).toBeNull();
    expect(pick("")).toBeNull();
    expect(pick("POV, Panties")).toBeNull();
  });

  it("reports the tag as the image spells it", () => {
    expect(guessCharacterFromTags("kellyyoung", chars)).toEqual({ name: "Kelly-2000", matched: ["kellyyoung"] });
  });
});
