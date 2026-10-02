import { beforeEach, describe, expect, it } from "vitest";

import type { CaptionQueueStatus, CaptionTicket } from "../api/types";
import { useCaptionStore } from "./captionStore";

const A = "s3://wanly-images/2026-10-01/a.png";

const q = (over: Partial<CaptionQueueStatus>): CaptionQueueStatus => ({
  depth: 0, waiting: 0, running: null, entries: [], recent: [], ...over,
});

const ticket: CaptionTicket = {
  path: A, ticket_id: "t1", status: "queued", position: 2, depth: 2, mode: "pair",
  origin: "describe", error: null, busy: false, motion_error: null, joined: false,
  created_at: null, started_at: null, finished_at: null,
};

beforeEach(() => {
  useCaptionStore.setState({
    queue: null, statuses: new Map(), pending: new Map(), doneSeq: 0, lastDone: [],
    loaded: false,
  });
});

describe("the caption store (console#564)", () => {
  it("shows a describe at once, then follows it through the queue to done", () => {
    const store = useCaptionStore.getState();
    store.apply(q({}), Date.now() - 10);             // first read: nothing going on
    useCaptionStore.getState().noteTicket(ticket);    // the click
    expect(useCaptionStore.getState().statuses.get(A)?.state).toBe("queued");

    const later = Date.now() + 10;
    useCaptionStore.getState().apply(q({
      depth: 1,
      entries: [{ path: A, kind: "describe", status: "running", position: 0, ticket_id: "t1" }],
    }), later);
    expect(useCaptionStore.getState().statuses.get(A)?.state).toBe("running");
    expect(useCaptionStore.getState().doneSeq).toBe(0);

    useCaptionStore.getState().apply(q({
      recent: [{ ...ticket, status: "done", position: null, finished_at: "2026-10-02T02:30:00Z" }],
    }), later + 10);
    const s = useCaptionStore.getState();
    expect(s.statuses.get(A)?.state).toBe("done");
    expect(s.doneSeq).toBe(1);
    expect(s.lastDone).toEqual([A]);                  // the moment views fetch the words
  });

  it("keeps a just-noted ticket through a read that started before the click", () => {
    useCaptionStore.getState().apply(q({}), Date.now() - 10);
    const before = Date.now() - 5;
    useCaptionStore.getState().noteTicket(ticket);
    useCaptionStore.getState().apply(q({}), before);  // in flight when the click happened
    expect(useCaptionStore.getState().statuses.get(A)?.state).toBe("queued");
  });

  it("does not announce finishes it never saw start (a page load)", () => {
    useCaptionStore.getState().apply(q({
      recent: [{ ...ticket, status: "done", finished_at: "2026-10-02T02:30:00Z" }],
    }), Date.now());
    expect(useCaptionStore.getState().doneSeq).toBe(0);
  });

  it("keeps an unchanged image's status object, so its views do not re-render", () => {
    const read = q({
      depth: 2, entries: [{ path: A, kind: "hold", status: "queued", position: 1, ticket_id: "t" }],
    });
    useCaptionStore.getState().apply(read, Date.now());
    const first = useCaptionStore.getState().statuses.get(A);
    useCaptionStore.getState().apply(read, Date.now());
    expect(useCaptionStore.getState().statuses.get(A)).toBe(first);
  });
});
