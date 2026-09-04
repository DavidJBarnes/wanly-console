import { describe, expect, it } from "vitest";

import { renderPrompt, NO_CHARACTER } from "../api/ltx";

/**
 * Rendering a pose with no character at all (console#412).
 *
 * The Character dropdown is the only place a character LoRA is chosen in practice, so "no
 * LoRA" has to be selectable there — not buried in a secondary override field.
 */
describe("no-character rendering", () => {
  it("leaves no dangling comma where the trigger was", () => {
    // "<TRIGGER>, a woman kneeling..." with an empty trigger becomes ", a woman kneeling..."
    // — a leading empty clause reaching the text encoder. Same class of bug as a dropped
    // <SCENE> placeholder.
    expect(renderPrompt("<TRIGGER>, a woman kneeling", "")).toBe("a woman kneeling");
  });

  it("still substitutes normally when there is a trigger", () => {
    expect(renderPrompt("<TRIGGER>, a woman kneeling", "k3lly2026"))
      .toBe("k3lly2026, a woman kneeling");
  });

  it("does not disturb a template with no placeholder", () => {
    expect(renderPrompt("a woman kneeling", "")).toBe("a woman kneeling");
  });

  it("carries char_lora 'none', which is understood the whole way down", () => {
    // The daemon filters "none" in any casing and the engine's want_char has always
    // excluded it, so this needs no backend change.
    expect(NO_CHARACTER.char_lora).toBe("none");
    expect(NO_CHARACTER.trigger).toBe("");
  });
});
