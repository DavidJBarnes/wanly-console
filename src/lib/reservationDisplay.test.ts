import { describe, it, expect } from "vitest";
import { minutesLeft, describeWindow, describePolicy } from "./reservationDisplay";
import type { GpuReservation } from "../api/client";

const NOW = new Date("2026-08-07T12:00:00Z");
const res = (overrides: Partial<GpuReservation> = {}): GpuReservation =>
  ({
    id: "r1",
    name: "res",
    status: "pending",
    expires_at: "2026-08-07T12:30:00Z",
    drain_after_jobs: null,
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
    expect(describeWindow(res({ expires_at: "2026-08-07T12:00:00Z" }), NOW)).toBe("expiring");
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
