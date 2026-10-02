import { describe, expect, it } from "vitest";

import type { CaptionQueueStatus, CaptionTicket } from "../api/types";
import {
  captionLabel, captionPending, newlyDone, sameStatus, statusesFromQueue,
} from "./captionStatus";

const A = "s3://wanly-images/2026-10-01/a.png";
const B = "s3://wanly-images/2026-10-01/b.png";
const C = "s3://wanly-images/2026-10-01/c.png";

function ticket(over: Partial<CaptionTicket>): CaptionTicket {
  return {
    path: A, ticket_id: "t1", status: "queued", position: 1, depth: 1, mode: "pair",
    origin: "describe", error: null, busy: false, motion_error: null, joined: false,
    created_at: null, started_at: null, finished_at: null, ...over,
  };
}

const queue = (over: Partial<CaptionQueueStatus>): CaptionQueueStatus => ({
  depth: 0, waiting: 0, running: null, entries: [], recent: [], ...over,
});

describe("statusesFromQueue (console#564)", () => {
  it("marks every image in line from the one read", () => {
    const m = statusesFromQueue(queue({
      depth: 3,
      entries: [
        { path: A, kind: "describe", status: "running", position: 0, ticket_id: "ta" },
        { path: B, kind: "hold", status: "queued", position: 1, ticket_id: "tb" },
        { path: C, kind: "describe", status: "queued", position: 2, ticket_id: "tc" },
      ],
    }));
    expect(m.get(A)?.state).toBe("running");
    expect(m.get(B)).toMatchObject({ state: "queued", position: 1, depth: 3 });
    expect(m.get(C)?.position).toBe(2);
  });

  it("ignores captions that never land on the image", () => {
    // A dataset's training caption and a Settings try are in the same line, but they write
    // nothing on the image's record -- "In caption queue" there would be a lie.
    const m = statusesFromQueue(queue({
      entries: [
        { path: A, kind: "dataset", status: "running", position: 0, ticket_id: null },
        { path: B, kind: "try", status: "queued", position: 1, ticket_id: null },
      ],
    }));
    expect(m.size).toBe(0);
  });

  it("reports finished tickets, and in-line beats finished", () => {
    const m = statusesFromQueue(queue({
      entries: [{ path: A, kind: "describe", status: "queued", position: 1, ticket_id: "new" }],
      recent: [
        ticket({ path: A, ticket_id: "old", status: "failed", error: "boom" }),
        ticket({ path: B, ticket_id: "tb", status: "failed", error: "render mode", busy: true }),
        ticket({ path: C, ticket_id: "tc", status: "done", finished_at: "2026-10-02T02:00:00Z" }),
      ],
    }));
    expect(m.get(A)?.state).toBe("queued");   // re-described after a failure
    expect(m.get(B)).toMatchObject({ state: "failed", error: "render mode", busy: true });
    expect(m.get(C)?.state).toBe("done");
  });

  it("shows a ticket this page was just handed before the next read has it", () => {
    const m = statusesFromQueue(queue({}), [ticket({ path: A, position: 4, depth: 4 })]);
    expect(m.get(A)).toMatchObject({ state: "queued", position: 4 });
  });

  it("does not let a stale pending ticket override the live line", () => {
    const m = statusesFromQueue(
      queue({ entries: [{ path: A, kind: "describe", status: "running", position: 0, ticket_id: "t1" }] }),
      [ticket({ path: A, position: 4 })],
    );
    expect(m.get(A)?.state).toBe("running");
  });

  it("copes with an API older than tickets", () => {
    expect(statusesFromQueue({ depth: 3, waiting: 2, running: A }).size).toBe(0);
    expect(statusesFromQueue(null).size).toBe(0);
  });
});

describe("newlyDone", () => {
  const st = (state: "queued" | "running" | "done" | "failed", finishedAt: string | null = null) => ({
    state, position: null, depth: 0, error: null, busy: false, motionError: null,
    ticketId: "t", finishedAt,
  });

  it("is the images whose caption was seen to finish", () => {
    const prev = new Map([[A, st("running")], [B, st("queued")], [C, st("queued")]]);
    const next = new Map([[A, st("done", "t1")], [B, st("failed", "t1")], [C, st("queued")]]);
    expect(newlyDone(prev, next)).toEqual([A]);
  });

  it("counts a second finish of the same image (a re-roll)", () => {
    const prev = new Map([[A, st("done", "t1")]]);
    expect(newlyDone(prev, new Map([[A, st("done", "t2")]]))).toEqual([A]);
    expect(newlyDone(prev, new Map([[A, st("done", "t1")]]))).toEqual([]);
  });

  it("does not count a finish nobody saw start", () => {
    expect(newlyDone(new Map(), new Map([[A, st("done", "t1")]]))).toEqual([]);
  });
});

describe("the badge's words", () => {
  const s = (state: "queued" | "running" | "done" | "failed", position: number | null = null) => ({
    state, position, depth: 5, error: null, busy: false, motionError: null, ticketId: null,
    finishedAt: null,
  });

  it("says where it is, that it is running, or that it failed", () => {
    expect(captionLabel(s("queued", 3))).toBe("In caption queue (#3)");
    expect(captionLabel(s("running", 0))).toBe("Captioning…");
    expect(captionLabel(s("failed"))).toBe("Failed: retry");
  });

  it("says nothing once the words are there", () => {
    expect(captionLabel(s("done"))).toBeNull();
    expect(captionLabel(undefined)).toBeNull();
  });

  it("knows what is still coming", () => {
    expect(captionPending(s("queued", 1))).toBe(true);
    expect(captionPending(s("running", 0))).toBe(true);
    expect(captionPending(s("failed"))).toBe(false);
    expect(captionPending(undefined)).toBe(false);
  });

  it("compares field for field", () => {
    expect(sameStatus(s("queued", 1), s("queued", 1))).toBe(true);
    expect(sameStatus(s("queued", 1), s("queued", 2))).toBe(false);
    expect(sameStatus(undefined, s("queued", 1))).toBe(false);
  });
});
