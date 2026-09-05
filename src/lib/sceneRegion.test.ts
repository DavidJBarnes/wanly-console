import { describe, expect, it } from "vitest";

import {
  fillScene,
  hasSceneRegion,
  hasScenePlaceholder,
  restoreScenePlaceholder,
  sceneRegionText,
  stripSceneMarkers,
} from "./sceneRegion";

const TEMPLATE = "k3llydw, <SCENE>, she grips the edge of the sofa";
const DESC = "a woman in a red dress on a sofa";

describe("filling the placeholder", () => {
  it("wraps the description so the region can be found again", () => {
    expect(fillScene(TEMPLATE, DESC)).toBe(
      "k3llydw, <scene>a woman in a red dress on a sofa</scene>, she grips the edge of the sofa",
    );
  });

  it("REPLACES the words on a second fill instead of appending a second scene", () => {
    // The one-way paste this replaces could not do it: once <SCENE> was gone there was
    // nothing to aim at, and re-describing meant editing the sentence out by hand.
    const once = fillScene(TEMPLATE, DESC);
    const twice = fillScene(once, "a woman standing by a pool");
    expect(twice).toBe(
      "k3llydw, <scene>a woman standing by a pool</scene>, she grips the edge of the sofa",
    );
    expect(twice).not.toContain("red dress");
  });

  it("keeps edits made inside the region readable", () => {
    const edited = "k3llydw, <scene>a woman, hand on hip</scene>, she grips";
    expect(sceneRegionText(edited)).toBe("a woman, hand on hip");
  });

  it("trims the description, so a stray newline does not land in the prompt", () => {
    expect(fillScene(TEMPLATE, `  ${DESC}\n`)).toContain(`<scene>${DESC}</scene>`);
  });
});

describe("stripping before submit", () => {
  it("keeps the words and drops the markers", () => {
    expect(stripSceneMarkers(fillScene(TEMPLATE, DESC))).toBe(
      "k3llydw, a woman in a red dress on a sofa, she grips the edge of the sofa",
    );
  });

  it("drops an unfilled placeholder entirely", () => {
    // A literal <SCENE> reaching the text encoder is garbage tokens — the reason the API
    // drops it rather than shipping it.
    expect(stripSceneMarkers(TEMPLATE)).toBe("k3llydw, , she grips the edge of the sofa");
  });

  it("is idempotent, so stripping an already-clean prompt is safe", () => {
    const clean = stripSceneMarkers(fillScene(TEMPLATE, DESC));
    expect(stripSceneMarkers(clean)).toBe(clean);
  });

  it("leaves a prompt that never had a scene alone", () => {
    const plain = "k3llydw, a woman on a sofa, she grips";
    expect(stripSceneMarkers(plain)).toBe(plain);
  });
});

describe("telling the two forms apart", () => {
  it("reads a filled prompt as a region, not a placeholder", () => {
    const filled = fillScene(TEMPLATE, DESC);
    expect(hasSceneRegion(filled)).toBe(true);
    expect(hasScenePlaceholder(filled)).toBe(false);
  });

  it("reads a template as a placeholder, not a region", () => {
    expect(hasSceneRegion(TEMPLATE)).toBe(false);
    expect(hasScenePlaceholder(TEMPLATE)).toBe(true);
  });

  it("does not mistake an opening tag for the bare token", () => {
    // The pairing is what distinguishes them. Matching case-insensitively without pairing
    // first would read `<scene>` as an unfilled placeholder and blank the description.
    expect(hasScenePlaceholder("a, <scene>words</scene>, b")).toBe(false);
  });

  it("handles a multi-line description", () => {
    const filled = fillScene(TEMPLATE, "a woman\non a sofa");
    expect(hasSceneRegion(filled)).toBe(true);
    expect(stripSceneMarkers(filled)).toContain("a woman\non a sofa");
  });
});

describe("did the user actually edit the prompt?", () => {
  it("a filled scene compares equal to its template", () => {
    // Filling <SCENE> is the recipe working as designed, not somebody changing the words.
    // Without this the `edited` flag would read "prompt" on every auto-filled render.
    expect(restoreScenePlaceholder(fillScene(TEMPLATE, DESC))).toBe(TEMPLATE);
  });

  it("a real edit still shows up", () => {
    const filled = fillScene(TEMPLATE, DESC).replace("she grips", "she releases");
    expect(restoreScenePlaceholder(filled)).not.toBe(TEMPLATE);
  });

  it("an edit made INSIDE the region is not a prompt edit", () => {
    // The scene is the frame's half of the prompt. Rewording it is not a departure from the
    // validated recipe, which is what `edited` records.
    const tweaked = "k3llydw, <scene>a woman, hand on hip</scene>, she grips the edge of the sofa";
    expect(restoreScenePlaceholder(tweaked)).toBe(TEMPLATE);
  });
});
