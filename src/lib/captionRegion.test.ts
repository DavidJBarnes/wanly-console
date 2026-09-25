import { describe, expect, it } from "vitest";

import {
  fill,
  hasPlaceholder,
  hasRegion,
  regionText,
  restorePlaceholders,
  stripMarkers,
  wants,
} from "./captionRegion";

const TEMPLATE = "k3llydw, <SCENE>, she grips the edge of the sofa";
const DESC = "a woman in a red dress on a sofa";

const BOTH = "k3llydw, <SCENE>, she grips the edge of the sofa, <MOTION>";
const MOTION = "she leans forward as the light shifts";

describe("filling the placeholder", () => {
  it("wraps the description so the region can be found again", () => {
    expect(fill(TEMPLATE, "scene", DESC)).toBe(
      "k3llydw, <scene>a woman in a red dress on a sofa</scene>, she grips the edge of the sofa",
    );
  });

  it("REPLACES the words on a second fill instead of appending a second scene", () => {
    // The one-way paste this replaces could not do it: once <SCENE> was gone there was
    // nothing to aim at, and re-describing meant editing the sentence out by hand.
    const once = fill(TEMPLATE, "scene", DESC);
    const twice = fill(once, "scene", "a woman standing by a pool");
    expect(twice).toBe(
      "k3llydw, <scene>a woman standing by a pool</scene>, she grips the edge of the sofa",
    );
    expect(twice).not.toContain("red dress");
  });

  it("keeps edits made inside the region readable", () => {
    const edited = "k3llydw, <scene>a woman, hand on hip</scene>, she grips";
    expect(regionText(edited, "scene")).toBe("a woman, hand on hip");
  });

  it("trims the description, so a stray newline does not land in the prompt", () => {
    expect(fill(TEMPLATE, "scene", `  ${DESC}\n`)).toContain(`<scene>${DESC}</scene>`);
  });
});

describe("stripping before submit", () => {
  it("keeps the words and drops the markers", () => {
    expect(stripMarkers(fill(TEMPLATE, "scene", DESC))).toBe(
      "k3llydw, a woman in a red dress on a sofa, she grips the edge of the sofa",
    );
  });

  it("drops an unfilled placeholder entirely", () => {
    // A literal <SCENE> reaching the text encoder is garbage tokens — the reason the API
    // drops it rather than shipping it.
    expect(stripMarkers(TEMPLATE)).toBe("k3llydw, , she grips the edge of the sofa");
  });

  it("is idempotent, so stripping an already-clean prompt is safe", () => {
    const clean = stripMarkers(fill(TEMPLATE, "scene", DESC));
    expect(stripMarkers(clean)).toBe(clean);
  });

  it("leaves a prompt that never had a scene alone", () => {
    const plain = "k3llydw, a woman on a sofa, she grips";
    expect(stripMarkers(plain)).toBe(plain);
  });
});

describe("telling the two forms apart", () => {
  it("reads a filled prompt as a region, not a placeholder", () => {
    const filled = fill(TEMPLATE, "scene", DESC);
    expect(hasRegion(filled, "scene")).toBe(true);
    expect(hasPlaceholder(filled, "scene")).toBe(false);
  });

  it("reads a template as a placeholder, not a region", () => {
    expect(hasRegion(TEMPLATE, "scene")).toBe(false);
    expect(hasPlaceholder(TEMPLATE, "scene")).toBe(true);
  });

  it("does not mistake an opening tag for the bare token", () => {
    // The pairing is what distinguishes them. Matching case-insensitively without pairing
    // first would read `<scene>` as an unfilled placeholder and blank the description.
    expect(hasPlaceholder("a, <scene>words</scene>, b", "scene")).toBe(false);
  });

  it("handles a multi-line description", () => {
    const filled = fill(TEMPLATE, "scene", "a woman\non a sofa");
    expect(hasRegion(filled, "scene")).toBe(true);
    expect(stripMarkers(filled)).toContain("a woman\non a sofa");
  });
});

describe("did the user actually edit the prompt?", () => {
  it("a filled scene compares equal to its template", () => {
    // Filling <SCENE> is the recipe working as designed, not somebody changing the words.
    // Without this the `edited` flag would read "prompt" on every auto-filled render.
    expect(restorePlaceholders(fill(TEMPLATE, "scene", DESC))).toBe(TEMPLATE);
  });

  it("a real edit still shows up", () => {
    const filled = fill(TEMPLATE, "scene", DESC).replace("she grips", "she releases");
    expect(restorePlaceholders(filled)).not.toBe(TEMPLATE);
  });

  it("an edit made INSIDE the region is not a prompt edit", () => {
    // The scene is the frame's half of the prompt. Rewording it is not a departure from the
    // validated recipe, which is what `edited` records.
    const tweaked = "k3llydw, <scene>a woman, hand on hip</scene>, she grips the edge of the sofa";
    expect(restorePlaceholders(tweaked)).toBe(TEMPLATE);
  });
});

// ---------------------------------------------------------------------------------------
// The motion half (console#529).
//
// Same machinery, second name. These are not copies of the scene tests for their own sake:
// every one of them is a place where a half-generalised implementation still passes the
// scene suite and silently does the wrong thing to the motion paragraph.
// ---------------------------------------------------------------------------------------

describe("the motion half behaves like the scene half", () => {
  it("fills, marks and strips", () => {
    const filled = fill(BOTH, "motion", MOTION);
    expect(filled).toContain(`<motion>${MOTION}</motion>`);
    expect(hasRegion(filled, "motion")).toBe(true);
    expect(hasPlaceholder(filled, "motion")).toBe(false);
    expect(stripMarkers(filled)).toBe(
      "k3llydw, , she grips the edge of the sofa, she leans forward as the light shifts",
    );
  });

  it("replaces the words on a re-describe", () => {
    const once = fill(BOTH, "motion", MOTION);
    const twice = fill(once, "motion", "she turns toward the camera");
    expect(twice).toContain("<motion>she turns toward the camera</motion>");
    expect(twice).not.toContain("light shifts");
  });

  it("compares equal to its template once the placeholder is restored", () => {
    expect(restorePlaceholders(fill(BOTH, "motion", MOTION))).toBe(BOTH);
  });
});

describe("the two halves do not interfere", () => {
  it("filling one leaves the other's placeholder alone", () => {
    const scened = fill(BOTH, "scene", DESC);
    expect(hasRegion(scened, "scene")).toBe(true);
    expect(hasPlaceholder(scened, "motion")).toBe(true);
    expect(hasPlaceholder(scened, "scene")).toBe(false);
  });

  it("strips BOTH halves at submit", () => {
    // One act. A strip that took a half would be a way to ship the other half's markers
    // to the text encoder, which is the exact thing this module exists to prevent.
    const filled = fill(fill(BOTH, "scene", DESC), "motion", MOTION);
    expect(stripMarkers(filled)).toBe(
      "k3llydw, a woman in a red dress on a sofa, she grips the edge of the sofa, "
      + "she leans forward as the light shifts",
    );
  });

  it("restores BOTH halves, so filling both is still not an edit", () => {
    const filled = fill(fill(BOTH, "scene", DESC), "motion", MOTION);
    expect(restorePlaceholders(filled)).toBe(BOTH);
  });

  it("a scene tag never closes with a motion tag", () => {
    // Each pattern is built from its own half's name. A pattern that accepted either close
    // would let this unclosed <scene> reach past </motion> and delete the real words
    // between them.
    const odd = "<scene>unclosed <motion>she reaches</motion>";
    expect(regionText(odd, "motion")).toBe("she reaches");
    expect(hasRegion(odd, "scene")).toBe(false);
    // The stray opener has no words in it, so it is dropped like any bare token.
    expect(stripMarkers(odd)).toBe("unclosed she reaches");
  });

  it("does not read a motion region as a scene placeholder, or the reverse", () => {
    const filled = fill(fill(BOTH, "scene", DESC), "motion", MOTION);
    expect(hasPlaceholder(filled, "scene")).toBe(false);
    expect(hasPlaceholder(filled, "motion")).toBe(false);
  });
});

describe("wants(): is this half part of the prompt at all?", () => {
  it("is true for an unfilled placeholder and for a filled region", () => {
    expect(wants(BOTH, "motion")).toBe(true);
    expect(wants(fill(BOTH, "motion", MOTION), "motion")).toBe(true);
  });

  it("is false for a prompt that never mentions the half", () => {
    // A scene-only pose must not grow a motion control, and must not be waited on for a
    // motion description it does not use.
    expect(wants(TEMPLATE, "motion")).toBe(false);
    expect(wants("k3llydw, a woman on a sofa", "scene")).toBe(false);
  });
});
