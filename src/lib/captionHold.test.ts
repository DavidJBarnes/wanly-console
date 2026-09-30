import { describe, expect, it } from "vitest";

import { captionInFlight, isCaptionHeld, joinNote } from "./captionHold";

describe("isCaptionHeld", () => {
  it("is both held states and nothing else", () => {
    expect(isCaptionHeld("awaiting_caption")).toBe(true);
    expect(isCaptionHeld("caption_failed")).toBe(true);
    // A pending segment is waiting on a WORKER, not a caption -- different fix, different words.
    for (const s of ["pending", "claimed", "processing", "completed", "failed"]) {
      expect(isCaptionHeld(s)).toBe(false);
    }
  });
});

describe("captionInFlight", () => {
  it("joins a caption that is running or queued anywhere", () => {
    // The user's flow: caption in the modal, Use as Starting Image at once. The dialog must
    // wait for THAT caption rather than start a second one with different words.
    expect(captionInFlight({ queue_status: "running" })).toBe(true);
    expect(captionInFlight({ queue_status: "queued" })).toBe(true);
  });

  it("is idle when the image is not in the queue", () => {
    expect(captionInFlight({ queue_status: null })).toBe(false);
  });
});

describe("joinNote", () => {
  it("says when the caption is the one running", () => {
    expect(joinNote({ queue_status: "running", queue_position: 0 })).toBe("captioning now");
  });

  it("says where a queued caption is in line", () => {
    expect(joinNote({ queue_status: "queued", queue_position: 1 })).toBe("1st in the caption queue");
    expect(joinNote({ queue_status: "queued", queue_position: 3 })).toBe("3rd in the caption queue");
    expect(joinNote({ queue_status: "queued", queue_position: 12 })).toBe("12th in the caption queue");
  });
});
