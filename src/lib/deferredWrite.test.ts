import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDeferredWrite } from "./deferredWrite";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createDeferredWrite", () => {
  it("writes after the pause", () => {
    const write = vi.fn();
    const w = createDeferredWrite(500, write);
    w.schedule("kelly");
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(write).toHaveBeenCalledExactlyOnceWith("kelly");
  });

  it("keeps only the latest value while typing", () => {
    const write = vi.fn();
    const w = createDeferredWrite(500, write);
    w.schedule("k");
    vi.advanceTimersByTime(200);
    w.schedule("ke");
    vi.advanceTimersByTime(200);
    w.schedule("kelly");
    vi.advanceTimersByTime(500);
    expect(write).toHaveBeenCalledExactlyOnceWith("kelly");
  });

  it("FLUSHES an edit that has not settled yet — the whole point (console#435)", () => {
    // Tag an image, close the modal 100ms later. The old code cancelled the timer here and
    // the tags were simply lost, along with the description that follows the save.
    const write = vi.fn();
    const w = createDeferredWrite(500, write);
    w.schedule("kelly");
    vi.advanceTimersByTime(100);
    w.flush();
    expect(write).toHaveBeenCalledExactlyOnceWith("kelly");
  });

  it("does not write the same edit twice", () => {
    const write = vi.fn();
    const w = createDeferredWrite(500, write);
    w.schedule("kelly");
    w.flush();
    vi.advanceTimersByTime(5000);
    w.flush();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("flushing with nothing waiting does nothing", () => {
    const write = vi.fn();
    const w = createDeferredWrite(500, write);
    w.flush();
    vi.advanceTimersByTime(5000);
    expect(write).not.toHaveBeenCalled();
  });

  it("writes each edit when they are flushed in turn", () => {
    // Tagging a run of images: each one is committed as the lightbox moves off it, so a
    // fast pass through the untagged view does not drop the ones in the middle.
    const write = vi.fn();
    const w = createDeferredWrite(500, write);
    for (const tag of ["a", "b", "c"]) {
      w.schedule(tag);
      w.flush();
    }
    expect(write.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
  });

  it("reports what is waiting", () => {
    const w = createDeferredWrite(500, vi.fn());
    expect(w.pending()).toBeNull();
    w.schedule("kelly");
    expect(w.pending()).toBe("kelly");
    w.flush();
    expect(w.pending()).toBeNull();
  });
});
