import { describe, it, expect } from "vitest";
import { minutesLeft, describeWindow, describePolicy, describeAttempts, describeGpu } from "./reservationDisplay";
import type { GpuReservation } from "../api/client";

const NOW = new Date("2026-08-07T12:00:00Z");
const res = (overrides: Partial<GpuReservation> = {}): GpuReservation =>
  ({
    id: "r1",
    name: "res",
    status: "pending",
    expires_at: "2026-08-07T12:30:00Z",
    drain_after_jobs: null,
    // null means "the server default GPU", which is what every reservation made before the
    // field existed was waiting for.
    gpu_type_id: null,
    pod_id: null,
    error: null,
    attempts: 0,
    created_at: "2026-08-07T12:00:00Z",
    ...overrides,
  });

describe("minutesLeft", () => {
  it("counts down in whole minutes", () => {
    expect(minutesLeft(res(), NOW)).toBe(30);
  });

  it("never goes negative", () => {
    // An expired row not yet swept must not render "-3m left".
    expect(minutesLeft(res({ expires_at: "2026-08-07T11:57:00Z" }), NOW)).toBe(0);
  });
});

describe("describeWindow", () => {
  it("reads naturally across the ranges", () => {
    expect(describeWindow(res({ expires_at: "2026-08-07T12:30:00Z" }), NOW)).toBe("30m left");
    expect(describeWindow(res({ expires_at: "2026-08-07T14:00:00Z" }), NOW)).toBe("2h left");
    expect(describeWindow(res({ expires_at: "2026-08-07T13:20:00Z" }), NOW)).toBe("1h 20m left");
    // Was "expiring" -- a bare word with no timeframe, sitting under a status chip.
    expect(describeWindow(res({ expires_at: "2026-08-07T12:00:00Z" }), NOW)).toBe("under a minute left");
  });
});

describe("describePolicy", () => {
  it("is explicit that no policy means unbounded", () => {
    // The user should see the open-ended case stated, not implied by absence.
    expect(describePolicy(res())).toBe("runs until you stop it");
  });

  it("reads naturally at one and many", () => {
    expect(describePolicy(res({ drain_after_jobs: 1 }))).toBe("drains after 1 job");
    expect(describePolicy(res({ drain_after_jobs: 3 }))).toBe("drains after 3 jobs");
  });
});

describe("describeAttempts", () => {
  it("says plainly when nothing has been tried", () => {
    // The case that matters. A live 3090 reservation sat through its whole window at attempts=0
    // -- never calling RunPod once -- while the card read "Waiting for a GPU". The bug was found
    // by querying the database, because the one number that would have shown it was not on
    // screen. Silence here is what made a loud failure quiet.
    expect(describeAttempts(res({ attempts: 0 }))).toBe("no launch attempted yet");
  });

  it("does not pluralise a single attempt", () => {
    expect(describeAttempts(res({ attempts: 1 }))).toBe("1 launch attempted");
  });

  it("counts repeated attempts", () => {
    expect(describeAttempts(res({ attempts: 7 }))).toBe("7 launches attempted");
  });
});

describe("describeGpu", () => {
  it("strips the vendor prefix that makes every option look alike", () => {
    expect(describeGpu(res({ gpu_type_id: "NVIDIA GeForce RTX 3090" }))).toBe("RTX 3090");
  });

  it("names the fallback rather than showing nothing", () => {
    // NULL means "the server default" -- which is what every reservation made before the column
    // existed is waiting for. Blank would read as "no GPU", which is a different claim.
    expect(describeGpu(res({ gpu_type_id: null }))).toBe("default GPU");
  });
});

describe("describeWindow near expiry", () => {
  it("still states a timeframe in the last minute", () => {
    // "expiring" alone dangled with no timeframe next to a status chip.
    const r = res({ expires_at: "2026-08-07T12:00:30Z" });
    expect(describeWindow(r, NOW)).toBe("under a minute left");
  });
});
