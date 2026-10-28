import { describe, expect, it } from "vitest";
import type { TitleTagResponse } from "../api/types";
import { ACTION_GROUP, actionPrompt, actionTagNames } from "./tagGroups";

const tag = (name: string, description: string | null): TitleTagResponse => ({
  id: name, name, group: ACTION_GROUP, description, created_at: "", updated_at: "",
});
const ACTIONS = [tag("Missionary", "He thrusts steadily."), tag("POV", "The camera looks down."),
                 tag("Pawg", null)];

describe("actionPrompt (wanly-api#486)", () => {
  it("uses every Action tag, in the image's order", () => {
    expect(actionPrompt("Joana, POV, Missionary", ACTIONS))
      .toBe("The camera looks down.\nHe thrusts steadily.");
  });
  it("matches case-insensitively and uses each tag once", () => {
    expect(actionPrompt("missionary, MISSIONARY", ACTIONS)).toBe("He thrusts steadily.");
  });
  it("is null with no Action tag that has a description", () => {
    expect(actionPrompt("Joana, Pawg", ACTIONS)).toBeNull();
    expect(actionPrompt("", ACTIONS)).toBeNull();
    expect(actionPrompt(null, ACTIONS)).toBeNull();
  });
});

describe("actionTagNames (console#709)", () => {
  it("names every Action tag, described or not, in the image's order, once, as spelled", () => {
    expect(actionTagNames("Joana, pawg, Missionary, missionary", ACTIONS)).toEqual(["Pawg", "Missionary"]);
  });
  it("is empty when the image has no Action tag", () => {
    expect(actionTagNames("Joana", ACTIONS)).toEqual([]);
    expect(actionTagNames(null, ACTIONS)).toEqual([]);
  });
});
