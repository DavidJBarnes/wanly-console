import { describe, expect, it } from "vitest";

import type { CaptionQueueStatus, CaptionTicket } from "../api/types";
import {
  type CaptionHalfName, captionKey, captionLabel, captionPending, captionTooltip, halfActions,
  halvesInFlight, type ImageCaptionStatus, motionNeedsRegrounding, newlyDone,
  requestedByNote, sameStatus, statusesFromQueue, ticketHalf,
} from "./captionStatus";

const A = "s3://wanly-images/2026-10-01/a.png";
const B = "s3://wanly-images/2026-10-01/b.png";
const C = "s3://wanly-images/2026-10-01/c.png";
const sceneOf = (p: string) => captionKey(p, "scene");
const motionOf = (p: string) => captionKey(p, "motion");

function ticket(over: Partial<CaptionTicket>): CaptionTicket {
  return {
    path: A, ticket_id: "t1", status: "queued", position: 1, depth: 1, half: "scene",
    mode: "scene", origin: "describe", error: null, busy: false, motion_error: null,
    joined: false, created_at: null, started_at: null, finished_at: null, ...over,
  };
}

const queue = (over: Partial<CaptionQueueStatus>): CaptionQueueStatus => ({
  depth: 0, waiting: 0, running: null, entries: [], recent: [], ...over,
});

function st(
  state: ImageCaptionStatus["state"], over: Partial<ImageCaptionStatus> = {},
): ImageCaptionStatus {
  return {
    half: "scene", state, position: null, depth: 5, error: null, busy: false, ticketId: "t",
    finishedAt: null, requestedBy: [], ...over,
  };
}

describe("statusesFromQueue (console#564), per half (console#590)", () => {
  it("marks every image in line from the one read, by half", () => {
    const m = statusesFromQueue(queue({
      depth: 4,
      lanes: [
        { name: "scene", depth: 3, waiting: 2, running: A },
        { name: "motion", depth: 1, waiting: 0, running: A },
      ],
      entries: [
        { path: A, kind: "describe", status: "running", position: 0, ticket_id: "ta", lane: "scene" },
        { path: B, kind: "hold", status: "queued", position: 1, ticket_id: "tb", lane: "scene" },
        { path: C, kind: "describe", status: "queued", position: 2, ticket_id: "tc", lane: "scene" },
        { path: A, kind: "describe", status: "running", position: 0, ticket_id: "tm", lane: "motion" },
      ],
    }));
    expect(m.get(sceneOf(A))?.state).toBe("running");
    expect(m.get(sceneOf(B))).toMatchObject({ state: "queued", position: 1, depth: 3 });
    expect(m.get(sceneOf(C))?.position).toBe(2);
    // The motion of the same image is its own status, in its own lane.
    expect(m.get(motionOf(A))).toMatchObject({ half: "motion", state: "running", depth: 1 });
    expect(m.get(motionOf(B))).toBeUndefined();
  });

  it("ignores captions that never land on the image", () => {
    // A dataset's training caption and a Settings try are in the same line, but they write
    // nothing on the image's record -- "In queue" there would be a lie.
    const m = statusesFromQueue(queue({
      entries: [
        { path: A, kind: "dataset", status: "running", position: 0, ticket_id: null },
        { path: B, kind: "try", status: "queued", position: 1, ticket_id: null },
      ],
    }));
    expect(m.size).toBe(0);
  });

  it("reports finished tickets per half, and in-line beats finished", () => {
    const m = statusesFromQueue(queue({
      entries: [{ path: A, kind: "describe", status: "queued", position: 1, ticket_id: "new", lane: "scene" }],
      recent: [
        ticket({ path: A, ticket_id: "old", status: "failed", error: "boom" }),
        ticket({ path: A, ticket_id: "am", half: "motion", status: "failed", error: "timed out" }),
        ticket({ path: B, ticket_id: "tb", status: "failed", error: "render mode", busy: true }),
        ticket({ path: C, ticket_id: "tc", status: "done", finished_at: "2026-10-02T02:00:00Z" }),
      ],
    }));
    expect(m.get(sceneOf(A))?.state).toBe("queued");   // re-described after a failure
    // ...and its failed motion is still there to retry, on its own.
    expect(m.get(motionOf(A))).toMatchObject({ state: "failed", error: "timed out" });
    expect(m.get(sceneOf(B))).toMatchObject({ state: "failed", error: "render mode", busy: true });
    expect(m.get(sceneOf(C))?.state).toBe("done");
  });

  it("shows a ticket this page was just handed before the next read has it", () => {
    const m = statusesFromQueue(queue({}), [ticket({ path: A, position: 4, depth: 4 })]);
    expect(m.get(sceneOf(A))).toMatchObject({ state: "queued", position: 4 });
  });

  it("does not let a stale pending ticket override the live line", () => {
    const m = statusesFromQueue(
      queue({ entries: [{ path: A, kind: "describe", status: "running", position: 0, ticket_id: "t1", lane: "scene" }] }),
      [ticket({ path: A, position: 4 })],
    );
    expect(m.get(sceneOf(A))?.state).toBe("running");
  });

  it("carries who asked for a held job's caption", () => {
    const asker = [{ job_id: "j1", name: "Beach walk" }];
    const m = statusesFromQueue(queue({
      entries: [{ path: A, kind: "hold", status: "queued", position: 1, ticket_id: "h",
        lane: "motion", requested_by: asker }],
    }));
    expect(m.get(motionOf(A))?.requestedBy).toEqual(asker);
  });

  it("copes with an API older than tickets, and older than halves", () => {
    expect(statusesFromQueue({ depth: 3, waiting: 2, running: A }).size).toBe(0);
    expect(statusesFromQueue(null).size).toBe(0);
    // Pre-#590: no lane on entries, "pair" tickets -- both read as the scene.
    const m = statusesFromQueue(queue({
      entries: [{ path: A, kind: "describe", status: "queued", position: 1, ticket_id: "p" }],
      recent: [ticket({ path: B, half: undefined, mode: "pair", status: "done" })],
    }));
    expect(m.get(sceneOf(A))?.state).toBe("queued");
    expect(m.get(sceneOf(B))?.state).toBe("done");
  });
});

describe("ticketHalf", () => {
  it("reads the half, falling back to the old mode", () => {
    expect(ticketHalf({ half: "motion", mode: "motion" })).toBe("motion");
    expect(ticketHalf({ half: undefined, mode: "pair" })).toBe("scene");
    expect(ticketHalf({ half: undefined, mode: "motion" })).toBe("motion");
  });
});

describe("newlyDone", () => {
  it("is the images a half was seen to finish for, each once", () => {
    const prev = new Map([
      [sceneOf(A), st("running")], [motionOf(A), st("queued", { half: "motion" })],
      [sceneOf(B), st("queued")], [sceneOf(C), st("queued")],
    ]);
    const next = new Map([
      [sceneOf(A), st("done", { finishedAt: "t1" })],
      [motionOf(A), st("done", { half: "motion", finishedAt: "t2" })],
      [sceneOf(B), st("failed", { finishedAt: "t1" })], [sceneOf(C), st("queued")],
    ]);
    expect(newlyDone(prev, next)).toEqual([A]);
  });

  it("counts a second finish of the same half (a redo)", () => {
    const prev = new Map([[motionOf(A), st("done", { half: "motion", finishedAt: "t1" })]]);
    expect(newlyDone(prev, new Map([[motionOf(A), st("done", { half: "motion", finishedAt: "t2" })]])))
      .toEqual([A]);
    expect(newlyDone(prev, new Map([[motionOf(A), st("done", { half: "motion", finishedAt: "t1" })]])))
      .toEqual([]);
  });

  it("does not count a finish nobody saw start", () => {
    expect(newlyDone(new Map(), new Map([[sceneOf(A), st("done", { finishedAt: "t1" })]])))
      .toEqual([]);
  });
});

describe("the pill's words", () => {
  const s = (state: ImageCaptionStatus["state"], position: number | null = null,
    half: CaptionHalfName = "scene") => st(state, { position, half, ticketId: null });

  it("says which half, where it is, that it is running, or that it failed", () => {
    expect(captionLabel(s("queued", 3))).toBe("Scene: In queue (#3)");
    expect(captionLabel(s("running", 0, "motion"))).toBe("Motion: Captioning…");
    expect(captionLabel(s("failed", null, "motion"))).toBe("Motion: Failed: retry");
  });

  it("says nothing once the words are there", () => {
    expect(captionLabel(s("done"))).toBeNull();
    expect(captionLabel(undefined)).toBeNull();
  });

  it("puts the reassurance and the reason in the tooltip, not beside the pill", () => {
    expect(captionTooltip(s("queued", 2, "motion"))).toContain("carries on if you close this");
    expect(captionTooltip(s("queued", 2, "motion"))).toContain("motion caption queue");
    expect(captionTooltip(st("failed", { error: "timed out" }))).toContain("timed out");
    expect(captionTooltip(st("failed", { error: "x" }))).not.toContain("carries on");
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
    expect(sameStatus(s("queued", 1), s("queued", 1, "motion"))).toBe(false);
    expect(sameStatus(undefined, s("queued", 1))).toBe(false);
  });
});

describe("requestedByNote (console#590)", () => {
  it("names the job that asked for a caption nobody clicked for", () => {
    expect(requestedByNote(st("queued", {
      half: "motion", requestedBy: [{ job_id: "abc", name: "Beach walk" }],
    }))).toBe("Motion requested by job Beach walk");
    expect(requestedByNote(st("queued", {
      half: "motion",
      requestedBy: [{ job_id: "a", name: "One" }, { job_id: "b", name: "Two" },
        { job_id: "c1234567890", name: null }],
    }))).toBe("Motion requested by jobs One, Two and c1234567");
  });

  it("is silent when a person asked", () => {
    expect(requestedByNote(st("queued"))).toBeNull();
    expect(requestedByNote(undefined)).toBeNull();
  });
});

describe("motionNeedsRegrounding (console#590)", () => {
  const img = (sceneAt: string | null, motionAt: string | null) => ({
    scene_description: "a woman on a pier", scene_described_at: sceneAt,
    motion_description: "she turns", motion_described_at: motionAt,
  });

  it("says so when the scene was redone after the motion was made", () => {
    expect(motionNeedsRegrounding(img("2026-10-02T10:05:00Z", "2026-10-02T10:00:00Z"))).toBe(true);
  });

  it("is quiet for a motion made after (or with) its scene", () => {
    expect(motionNeedsRegrounding(img("2026-10-02T10:00:00Z", "2026-10-02T10:05:00Z"))).toBe(false);
    expect(motionNeedsRegrounding(img("2026-10-02T10:00:00Z", "2026-10-02T10:00:00Z"))).toBe(false);
  });

  it("is quiet when either half is missing", () => {
    expect(motionNeedsRegrounding({ ...img("2026-10-02T10:05:00Z", null) })).toBe(false);
    expect(motionNeedsRegrounding({
      ...img("2026-10-02T10:05:00Z", "2026-10-02T10:00:00Z"), motion_description: null,
    })).toBe(false);
  });
});

describe("halfActions (console#590)", () => {
  it("offers Describe and Describe motion on a fresh image, motion waiting for a scene", () => {
    const [scene, motion] = halfActions({ scene: null, motion: null });
    expect(scene).toMatchObject({ label: "Describe", disabled: false });
    expect(motion).toMatchObject({ label: "Describe motion", disabled: true });
    expect(motion.why).toContain("scene first");
  });

  it("lets motion be asked for while the scene is on its way", () => {
    const [, motion] = halfActions({ scene: null, motion: null, sceneStatus: st("running") });
    expect(motion.disabled).toBe(false);
  });

  it("offers a redo per half", () => {
    const [scene, motion] = halfActions({ scene: "a pier", motion: "she turns" });
    expect(scene.label).toBe("Redo scene");
    expect(motion.label).toBe("Redo motion");
  });

  it("disables -- never relabels -- a half in flight, leaving the other alone", () => {
    const [scene, motion] = halfActions({
      scene: "a pier", motion: "she turns",
      motionStatus: st("queued", { half: "motion", position: 2 }),
    });
    expect(scene.disabled).toBe(false);
    expect(motion).toMatchObject({ label: "Redo motion", disabled: true });
  });

  it("re-enables a failed half for its retry", () => {
    const [, motion] = halfActions({
      scene: "a pier", motion: null, motionStatus: st("failed", { half: "motion" }),
    });
    expect(motion.disabled).toBe(false);
  });
});

describe("halvesInFlight (console#590)", () => {
  it("reads each half's ticket", () => {
    expect(halvesInFlight({
      queue_status: "running", scene_caption: { status: "done" },
      motion_caption: { status: "running" },
    })).toEqual({ scene: false, motion: true });
    expect(halvesInFlight({ scene_caption: null, motion_caption: null }))
      .toEqual({ scene: false, motion: false });
  });

  it("treats an API older than the split as both halves", () => {
    expect(halvesInFlight({ queue_status: "queued" })).toEqual({ scene: true, motion: true });
    expect(halvesInFlight({ queue_status: null })).toEqual({ scene: false, motion: false });
  });
});
