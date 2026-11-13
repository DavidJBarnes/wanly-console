import { describe, expect, it } from "vitest";
import { playerAction } from "./playerKeys";

describe("playerAction", () => {
  it("maps the shortcuts", () => {
    expect(playerAction({ key: "n" })).toBe("next");
    expect(playerAction({ key: "PageDown" })).toBe("next");
    expect(playerAction({ key: "P" })).toBe("prev");
    expect(playerAction({ key: "f" })).toBe("fullscreen");
  });

  it("leaves the arrow keys to the video's own seeking", () => {
    expect(playerAction({ key: "ArrowRight" })).toBeNull();
    expect(playerAction({ key: "ArrowLeft" })).toBeNull();
  });

  it("ignores modified keys and typing", () => {
    expect(playerAction({ key: "f", ctrlKey: true })).toBeNull();
    expect(playerAction({ key: "n", target: { tagName: "INPUT" } as unknown as EventTarget })).toBeNull();
  });
});
