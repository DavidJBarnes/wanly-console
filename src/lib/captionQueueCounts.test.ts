import { describe, expect, it } from "vitest";

import type { CaptionQueueStatus } from "../api/types";
import { captionQueueCounts } from "./captionQueueCounts";

const q = (over: Partial<CaptionQueueStatus>): CaptionQueueStatus =>
  ({ depth: 0, waiting: 0, running: null, ...over });

describe("captionQueueCounts", () => {
  it("adds the upload backlog to what is in the lane", () => {
    expect(captionQueueCounts(q({ depth: 2, waiting: 1, backlog: 40, backlog_failed: 3 })))
      .toEqual({ left: 42, behind: 41, failed: 3 });
  });

  it("counts an API without the describe queue as having no backlog", () => {
    expect(captionQueueCounts(q({ depth: 1 }))).toEqual({ left: 1, behind: 0, failed: 0 });
  });
});
