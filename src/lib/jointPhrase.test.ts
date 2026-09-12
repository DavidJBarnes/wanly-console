import { describe, expect, it } from "vitest";

import { renderPrompt, splitJointPhrase } from "../api/ltx";

/** A JOINT character (wanly-api#102) carries BOTH identities in one trigger, joined by
 *  " and ". A two-person pose must split it so each pair fills its own placeholder --
 *  otherwise both triggers land in <TRIGGER> and <TRIGGER2> is left empty, which is what
 *  made a joint render hold Payton and drop David. */
const JOINT = "p@yton, woman and d@vid, man";

describe("splitJointPhrase", () => {
  it("splits a joint phrase into its two caption pairs", () => {
    expect(splitJointPhrase(JOINT)).toEqual(["p@yton, woman", "d@vid, man"]);
  });

  it("still splits the legacy ampersand form", () => {
    expect(splitJointPhrase("p@yton, woman & d@vid, man"))
      .toEqual(["p@yton, woman", "d@vid, man"]);
  });

  it("leaves a single phrase whole", () => {
    expect(splitJointPhrase("p@yton, woman")).toEqual(["p@yton, woman"]);
  });

  it("does not mangle a trigger that merely contains ' and '", () => {
    // No comma -- not the caption-pair shape, so not a joint phrase.
    expect(splitJointPhrase("rock and roll")).toEqual(["rock and roll"]);
  });
});

describe("renderPrompt with a joint character", () => {
  it("fills each placeholder with its own pair", () => {
    expect(renderPrompt("<TRIGGER> and <TRIGGER2>, a scene", [JOINT]))
      .toBe("p@yton, woman and d@vid, man, a scene");
  });

  it("places each trigger beside its person in the action", () => {
    expect(renderPrompt("<TRIGGER> grips <TRIGGER2>", [JOINT]))
      .toBe("p@yton, woman grips d@vid, man");
  });

  it("keeps the whole phrase for a one-person pose", () => {
    // Splitting here would leave the second identity nowhere to go -- dropping it.
    expect(renderPrompt("<TRIGGER>, a scene", [JOINT]))
      .toBe("p@yton, woman and d@vid, man, a scene");
  });

  it("leaves an ordinary single character untouched", () => {
    expect(renderPrompt("<TRIGGER> and <TRIGGER2>", ["p@yton, woman"]))
      .toBe("p@yton, woman and <TRIGGER2>");
  });
});
