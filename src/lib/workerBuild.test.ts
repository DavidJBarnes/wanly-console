import { describe, expect, it } from "vitest";
import { driftingWorkers, short } from "./workerBuild";

const w = (id: string, daemon: string | null, image: string | null) =>
  ({ id, daemon_commit: daemon, image_ref: image });

describe("short", () => {
  it("trims a full sha to seven so two workers compare by eye", () => {
    expect(short("a044cef1234567890")).toBe("a044cef");
  });
  it("strips a sha256: prefix, which image refs carry and daemon commits do not", () => {
    expect(short("sha256:01bfaa8a85a3")).toBe("01bfaa8");
  });
  it("renders a missing value rather than blanking the row", () => {
    expect(short(null)).toBe("?");
    expect(short("  ")).toBe("?");
  });
});

describe("driftingWorkers", () => {
  it("flags the odd one out", () => {
    const d = driftingWorkers([
      w("a", "a044cef", "img1"),
      w("b", "a044cef", "img1"),
      w("c", "6786f86", "img1"),
    ]);
    expect([...d]).toEqual(["c"]);
  });

  it("catches a daemon that matches on an image that does not", () => {
    // THE case from 2026-09-06: `docker restart` re-cloned the daemon to current and left
    // the image 37 hours stale. Comparing only the daemon would have called this fine.
    const d = driftingWorkers([
      w("pod", "a044cef", "imgNEW"),
      w("3090", "a044cef", "imgOLD"),
    ]);
    expect(d.size).toBe(2); // a two-way tie: neither is the majority, so flag both
  });

  it("never flags a lone worker", () => {
    expect(driftingWorkers([w("a", "a044cef", "img1")]).size).toBe(0);
  });

  it("ignores workers that report nothing", () => {
    // An older daemon that cannot report is a different problem from one demonstrably
    // behind. Flagging it would make this noise on the day it ships.
    const d = driftingWorkers([
      w("a", "a044cef", "img1"),
      w("b", "a044cef", "img1"),
      w("old", null, null),
    ]);
    expect(d.size).toBe(0);
  });

  it("agrees when everyone agrees", () => {
    expect(driftingWorkers([
      w("a", "a044cef", "img1"),
      w("b", "a044cef", "img1"),
    ]).size).toBe(0);
  });
});
