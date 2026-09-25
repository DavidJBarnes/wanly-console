import { describe, expect, it } from "vitest";

import { describeQueuePlace } from "./useCaptionQueue";

describe("what the queue chip says", () => {
  it("says nothing when this image is the only one", () => {
    // "1st of 1" is noise: there is no line to be in.
    expect(describeQueuePlace({ position: 0, depth: 1 })).toBeNull();
    expect(describeQueuePlace({ position: null, depth: 0 })).toBeNull();
    expect(describeQueuePlace(undefined)).toBeNull();
  });

  it("names how many are behind the one being captioned", () => {
    // Position 0 is not "1st in line" — it is the one running, and what matters then is
    // how much is still to come.
    expect(describeQueuePlace({ position: 0, depth: 7 })).toBe("captioning now — 6 waiting");
  });

  it("counts from 1 for a human, not from 0", () => {
    // position 1 is the next one up, which a person calls 2nd.
    expect(describeQueuePlace({ position: 1, depth: 7 })).toBe("2nd of 7");
    expect(describeQueuePlace({ position: 2, depth: 7 })).toBe("3rd of 7");
  });

  it("falls back to depth when this path is not in the queue", () => {
    // It finished, or was never queued, while others still are.
    expect(describeQueuePlace({ position: null, depth: 4 })).toBe("4 in the caption queue");
  });

  it("gets the awkward ordinals right", () => {
    expect(describeQueuePlace({ position: 10, depth: 20 })).toBe("11th of 20");
    expect(describeQueuePlace({ position: 11, depth: 20 })).toBe("12th of 20");
    expect(describeQueuePlace({ position: 12, depth: 20 })).toBe("13th of 20");
    expect(describeQueuePlace({ position: 20, depth: 30 })).toBe("21st of 30");
  });
});
