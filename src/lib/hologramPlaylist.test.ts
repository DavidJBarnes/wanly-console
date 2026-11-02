import { describe, expect, it } from "vitest";
import { DEFAULT_AR_SETTINGS } from "./arFollow";
import {
  clipSettings,
  pressedDelta,
  sharedSettings,
  shuffled,
  shuffleUrl,
  stepPlaylist,
} from "./hologramPlaylist";

const up = { next: false, prev: false };

describe("shuffled", () => {
  it("keeps every clip and leaves the input alone", () => {
    const input = [1, 2, 3, 4, 5];
    expect([...shuffled(input)].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("stepPlaylist", () => {
  it("walks forward and back through the order", () => {
    const p = { clips: ["a", "b", "c"], index: 1 };
    expect(stepPlaylist(p, 1)).toEqual({ clips: ["a", "b", "c"], index: 2 });
    expect(stepPlaylist(p, -1)).toEqual({ clips: ["a", "b", "c"], index: 0 });
  });

  it("going back from the start wraps without reshuffling", () => {
    expect(stepPlaylist({ clips: ["a", "b", "c"], index: 0 }, -1)).toEqual({
      clips: ["a", "b", "c"],
      index: 2,
    });
  });

  it("never replays the clip that just finished when it reshuffles", () => {
    for (let run = 0; run < 200; run++) {
      const next = stepPlaylist({ clips: ["a", "b", "c"], index: 2 }, 1);
      expect(next.index).toBe(0);
      expect(next.clips[0]).not.toBe("c");
      expect([...next.clips].sort()).toEqual(["a", "b", "c"]);
    }
  });

  it("a single clip stays put", () => {
    const p = { clips: ["a"], index: 0 };
    expect(stepPlaylist(p, 1)).toBe(p);
    expect(stepPlaylist(p, -1)).toBe(p);
  });
});

describe("pressedDelta", () => {
  it("fires once per press, not once per frame held", () => {
    const held = { next: true, prev: false };
    expect(pressedDelta(up, held)).toBe(1);
    expect(pressedDelta(held, held)).toBeNull();
    expect(pressedDelta(held, up)).toBeNull();
  });

  it("maps the other button to back", () => {
    expect(pressedDelta(up, { next: false, prev: true })).toBe(-1);
  });
});

describe("clipSettings", () => {
  const base = { ...DEFAULT_AR_SETTINGS, edgeMin: 0.1, edgeMax: 0.2 };

  it("takes the lock mode from the session and the edges from the clip", () => {
    const s = clipSettings(base, { lockMode: "follow" }, { lockMode: "placed", edgeMin: 0.3, edgeMax: 0.4 });
    expect(s.lockMode).toBe("follow");
    expect(s.edgeMin).toBe(0.3);
    expect(s.edgeMax).toBe(0.4);
  });

  it("falls back to the flavor's edges, not the previous clip's", () => {
    const shared = sharedSettings({ ...base, edgeMin: 0.9, edgeMax: 0.95 });
    const s = clipSettings(base, shared, {});
    expect(s.edgeMin).toBe(0.1);
    expect(s.edgeMax).toBe(0.2);
  });
});

describe("shuffleUrl", () => {
  it("carries the Videos filters", () => {
    expect(shuffleUrl("", null, false)).toBe("/holo/shuffle");
    expect(shuffleUrl("kitchen take", "kelly,ar", true)).toBe(
      "/holo/shuffle?q=kitchen+take&tags=kelly%2Car&fav=1",
    );
  });
});
