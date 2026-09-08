/**
 * The console's half of wanly-api#269.
 *
 * The count is the one that matters. The API had to be fixed because `queue_health` counted
 * every worker row, so a healthy captioner would have kept the "queue stalled" alarm quiet
 * forever. The Workers header had exactly the same bug in a different costume: "2 online"
 * when only one of them can render reads as capacity that does not exist — and it reads that
 * way hardest when the render fleet is down, which is precisely when someone is looking.
 */
import { describe, expect, it } from "vitest";

import type { WorkerKind } from "../api/types";
import { byStatus, canDrain, canRender, fleetCounts, isService, kindsOf } from "./workerKind";

const render = (status: string) => ({ kind: "render" as const, status: status as never });
const service = (status: string) => ({ kind: "service" as const, status: status as never });

describe("kindsOf (wanly-gpu-docker#83)", () => {
  it("is the list when the API sends one", () => {
    expect(kindsOf({ kind: "render", kinds: ["render", "trainer"] })).toEqual(["render", "trainer"]);
  });

  it("is the one kind for a row from before the column", () => {
    expect(kindsOf({ kind: "trainer", kinds: null })).toEqual(["trainer"]);
    expect(kindsOf({ kind: "service", kinds: [] })).toEqual(["service"]);
  });

  it("a box that is render AND trainer renders, drains, and is not a service", () => {
    const both = { kind: "render" as const, kinds: ["render", "trainer"] as WorkerKind[], status: "online-idle" as never };
    expect(canRender(both)).toBe(true);
    expect(isService(both)).toBe(false);
    expect(canDrain(both)).toBe(true);
    expect(fleetCounts([both]).liveRender).toBe(1);
  });

  it("a trainer alone is a service: renders nothing, cannot be drained", () => {
    const trainer = { kind: "trainer" as const, kinds: ["trainer"] as WorkerKind[], status: "online" as never };
    expect(isService(trainer)).toBe(true);
    expect(canDrain(trainer)).toBe(false);
    expect(fleetCounts([trainer]).liveServices).toBe(1);
  });
});

describe("isService", () => {
  it("is true only for a service", () => {
    expect(isService(service("online"))).toBe(true);
    expect(isService(render("online-idle"))).toBe(false);
  });
});

describe("canDrain", () => {
  it("is never offered on a service", () => {
    // A service holds no segments; there is nothing to finish before stopping it.
    expect(canDrain(service("online"))).toBe(false);
    expect(canDrain(service("degraded"))).toBe(false);
  });

  it("is unchanged for render workers", () => {
    expect(canDrain(render("online-idle"))).toBe(true);
    expect(canDrain(render("online-busy"))).toBe(true);
    expect(canDrain(render("offline"))).toBe(false);
    expect(canDrain(render("draining"))).toBe(false);
  });
});

describe("fleetCounts", () => {
  it("does not let a service inflate the render count", () => {
    const c = fleetCounts([render("online-busy"), service("online")]);
    expect(c.liveRender).toBe(1);
    expect(c.liveServices).toBe(1);
    expect(c.total).toBe(2);
  });

  it("reports zero render capacity when only a service is alive", () => {
    // The scenario the split exists for: the captioner is fine, every render worker is gone,
    // and the header must not claim otherwise.
    const c = fleetCounts([render("offline"), service("online")]);
    expect(c.liveRender).toBe(0);
    expect(c.liveServices).toBe(1);
  });

  it("counts a degraded service as alive", () => {
    // Degraded is not offline. Something is answering, and hiding it would make a
    // half-broken box indistinguishable from an absent one.
    expect(fleetCounts([service("degraded")]).liveServices).toBe(1);
  });

  it("treats a worker with no kind as render", () => {
    // Only reachable against an older API — the column is NOT NULL with a `render` default.
    // Counting it as render keeps the number meaning what it meant before this existed.
    const c = fleetCounts([{ kind: undefined as never, status: "online-idle" as never }]);
    expect(c.liveRender).toBe(1);
  });

  it("counts nothing when the fleet is empty", () => {
    expect(fleetCounts([])).toEqual({ liveRender: 0, liveServices: 0, total: 0 });
  });
});

describe("byStatus", () => {
  it("puts the service statuses above offline", () => {
    // Without a place in the table they sort to the fallback, which lands a live box below a
    // dead one.
    const order = [render("offline"), service("online"), service("degraded"), render("online-busy")]
      .sort(byStatus)
      .map((w) => w.status);
    expect(order).toEqual(["online-busy", "degraded", "online", "offline"]);
  });

  it("puts a degraded service above a healthy one", () => {
    // The partly-broken row is the one worth reading first.
    expect(byStatus(service("degraded"), service("online"))).toBeLessThan(0);
  });

  it("leaves the render ordering exactly as it was", () => {
    const order = [render("offline"), render("online-idle"), render("draining"), render("online-busy")]
      .sort(byStatus)
      .map((w) => w.status);
    expect(order).toEqual(["online-busy", "draining", "online-idle", "offline"]);
  });
});
