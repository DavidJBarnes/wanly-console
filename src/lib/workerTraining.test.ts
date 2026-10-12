import { describe, expect, it } from "vitest";
import { trainingLabel, trainingRun } from "./workerTraining";

const w = { friendly_name: "3090a.zero" };

describe("trainingRun (console#671)", () => {
  it("finds a running or claimed run on this worker", () => {
    expect(trainingRun(w, [{ status: "running", worker_name: "3090a.zero" }])).not.toBeNull();
    expect(trainingRun(w, [{ status: "claimed", worker_name: "3090a.zero" }])).not.toBeNull();
  });
  it("ignores finished runs and other workers", () => {
    expect(trainingRun(w, [
      { status: "completed", worker_name: "3090a.zero" },
      { status: "running", worker_name: "3090b.zero" },
      { status: "pending", worker_name: null },
    ])).toBeNull();
  });
});

describe("trainingLabel", () => {
  it("names the run and its progress", () => {
    expect(trainingLabel({ character: "Payton", version: 2, step: 430, total_steps: 1000 }))
      .toBe("Payton v2 · 43%");
  });
  it("leaves the percent out before the first step", () => {
    expect(trainingLabel({ character: "Payton", version: 2, step: null, total_steps: null }))
      .toBe("Payton v2");
  });
});
