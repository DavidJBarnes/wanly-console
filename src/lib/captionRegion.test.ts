import { describe, expect, it } from "vitest";

import {
  fill,
  hasPlaceholder,
  hasRegion,
  regionText,
  restorePlaceholders,
  submitPrompt,
  wants,
} from "./captionRegion";

const TEMPLATE = "k3llydw, <SCENE>, she grips the edge of the sofa";
const DESC = "a woman in a red dress on a sofa";

const LEGACY = "k3llydw, <SCENE>, she grips the edge of the sofa, <MOTION>";

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
    expect(submitPrompt(fill(TEMPLATE, "scene", DESC))).toBe(
      "k3llydw, a woman in a red dress on a sofa, she grips the edge of the sofa",
    );
  });

  it("KEEPS an unfilled placeholder, so the API can hold the render for its words", () => {
    // console#577. This used to delete it, the API then saw nothing to wait for, and a
    // recipe queued before its caption landed rendered without its scene. The API fills
    // the placeholder from the saved caption, or refuses to hand the segment out.
    expect(submitPrompt(TEMPLATE)).toBe(TEMPLATE);
  });

  it("strips marker spellings the API does not recognise as a placeholder", () => {
    // Only the exact <SCENE> is a placeholder. Anything else would reach the text encoder
    // as garbage tokens.
    expect(submitPrompt("a, <scene>, b <Scene> c")).toBe("a, , b  c");
  });

  it("scrubs markers typed inside a filled region", () => {
    // They are not the description, and a <SCENE> left there would be read by the API
    // as a placeholder to fill.
    expect(submitPrompt("k, <scene>she <SCENE>leans</motion> in</scene>")).toBe(
      "k, she leans in");
  });

  it("is idempotent, so stripping an already-clean prompt is safe", () => {
    const clean = submitPrompt(fill(TEMPLATE, "scene", DESC));
    expect(submitPrompt(clean)).toBe(clean);
  });

  it("leaves a prompt that never had a scene alone", () => {
    const plain = "k3llydw, a woman on a sofa, she grips";
    expect(submitPrompt(plain)).toBe(plain);
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
    expect(submitPrompt(filled)).toContain("a woman\non a sofa");
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
// Legacy motion markers (wanly-api#481).
//
// The motion half is gone, but older pose templates still say <MOTION> and a prompt filled
// before the removal can carry a <motion> region. Nothing fills <MOTION> any more, so
// sending it would hold the render forever or hand the literal token to the text encoder.
// ---------------------------------------------------------------------------------------

describe("legacy motion markers are stripped at submit", () => {
  it("drops a bare <MOTION> and the separator it leaves behind", () => {
    expect(submitPrompt("k3lly2026, woman, <MOTION>")).toBe("k3lly2026, woman");
    expect(submitPrompt("<MOTION>, k3lly2026, woman")).toBe("k3lly2026, woman");
    expect(submitPrompt("a, <MOTION>, b")).toBe("a, b");
  });

  it("keeps the scene placeholder while dropping the motion one", () => {
    expect(submitPrompt(LEGACY)).toBe("k3llydw, <SCENE>, she grips the edge of the sofa");
  });

  it("drops a filled motion region WITH its words, as the API does (wanly-api#482)", () => {
    // The words came from the retired motion half; the API drops them too, so the console
    // must not send what the API would have removed.
    const filled = fill(LEGACY, "scene", DESC).replace(
      "<MOTION>", "<motion>she leans forward</motion>");
    expect(submitPrompt(filled)).toBe(
      "k3llydw, a woman in a red dress on a sofa, she grips the edge of the sofa");
    expect(submitPrompt("a, <MOTION>x</motion>, b")).toBe("a, b");
    expect(submitPrompt("<motion>\nmulti\nline\n</motion>, k")).toBe("k");
  });

  it("strips any spelling and stray closer", () => {
    expect(submitPrompt("a, </motion> b <Motion>  c")).toBe("a, b c");
  });

  it("never reads a motion tag as a scene marker", () => {
    // An unclosed <scene> must not reach past a motion closer and eat the words between.
    const odd = "<scene>unclosed <motion>she reaches</motion>";
    expect(hasRegion(odd, "scene")).toBe(false);
    expect(submitPrompt(odd)).toBe("unclosed");
  });

  it("is idempotent", () => {
    const once = submitPrompt(LEGACY);
    expect(submitPrompt(once)).toBe(once);
  });

  it("does not reformat a prompt that had no motion tag", () => {
    const spaced = "a,  b , , c";
    expect(submitPrompt(spaced)).toBe(spaced);
  });
});

describe("wants(): is the scene part of the prompt at all?", () => {
  it("is true for an unfilled placeholder and for a filled region", () => {
    expect(wants(TEMPLATE, "scene")).toBe(true);
    expect(wants(fill(TEMPLATE, "scene", DESC), "scene")).toBe(true);
  });

  it("is false for a prompt that never mentions it", () => {
    expect(wants("k3llydw, a woman on a sofa", "scene")).toBe(false);
  });
});
