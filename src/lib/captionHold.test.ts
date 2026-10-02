import { describe, expect, it } from "vitest";

import {
  captionInFlight, holdPlace, holdSummary, isCaptionHeld, joinNote, needsNote,
} from "./captionHold";

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
    expect(joinNote({ queue_status: "running", queue_position: 0 })).toBe("Captioning…");
  });

  it("says where a queued caption is in line, in the badge's words", () => {
    expect(joinNote({ queue_status: "queued", queue_position: 1 })).toBe("In caption queue (#1)");
    expect(joinNote({ queue_status: "queued", queue_position: 12 })).toBe("In caption queue (#12)");
  });
});

describe("holdPlace (console#587)", () => {
  it("names the place in line and what the job still needs", () => {
    expect(holdPlace({ queue_status: "queued", queue_position: 3, needs: ["scene", "motion"] }))
      .toBe("In caption queue (#3) · needs the scene and motion");
    expect(holdPlace({ queue_status: "running", needs: ["motion"] }))
      .toBe("Captioning… · needs the motion");
  });

  it("says why it is waiting when the captioner is refusing", () => {
    expect(holdPlace({
      queue_status: "waiting", needs: ["scene"],
      note: "the captioner is unavailable: 3090.zero is in render mode",
    })).toBe("Waiting: the captioner is unavailable: 3090.zero is in render mode · needs the scene");
  });

  it("still says something with nothing to go on", () => {
    expect(holdPlace({})).toBe("Waiting for caption…");
    expect(needsNote([])).toBeNull();
  });
});

describe("holdSummary (console#587)", () => {
  it("is silent when nothing is held", () => {
    expect(holdSummary(null)).toBeNull();
    expect(holdSummary({ jobs_waiting: 0, jobs_failed: 0, queue_depth: 30, images: [] }))
      .toBeNull();
  });

  it("counts the jobs, the images and the depth of the line", () => {
    expect(holdSummary({ jobs_waiting: 5, jobs_failed: 0, queue_depth: 28, images: [1, 2, 3] }))
      .toBe("5 jobs waiting for captions (3 images) · caption queue 28 deep");
    expect(holdSummary({ jobs_waiting: 1, jobs_failed: 2, queue_depth: 0, images: [1] }))
      .toBe("1 job waiting for captions (1 image) · caption queue empty · 2 jobs with a failed caption");
  });
});
