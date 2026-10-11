import { describe, expect, it } from "vitest";
import type { TrainingJob } from "../api/types";
import { historyRows, historyWhen } from "./trainingHistory";

function job(over: Partial<TrainingJob>): TrainingJob {
  return {
    id: "x", character: "Joana", trigger: "jo@na", version: 1, status: "completed",
    dataset_images: [], config: {}, worker_name: null, gpu_name: null, progress_log: null,
    step: null, total_steps: null, error_message: null, checkpoints: null,
    output_lora_path: null, loss_log: null, epochs: null, publish_requests: null, notes: null,
    thumbnail_uri: null, created_at: null, claimed_at: null, completed_at: null, ...over,
  };
}

describe("historyWhen", () => {
  it("dates a run by when it finished, then started, then was queued", () => {
    expect(historyWhen(job({ created_at: "a", claimed_at: "b", completed_at: "c" })))
      .toEqual({ when: "c", whenKind: "finished" });
    expect(historyWhen(job({ created_at: "a", claimed_at: "b" })))
      .toEqual({ when: "b", whenKind: "started" });
    expect(historyWhen(job({ created_at: "a" }))).toEqual({ when: "a", whenKind: "queued" });
  });
});

describe("historyRows", () => {
  const jobs = [
    job({ id: "old", completed_at: "2026-10-01T10:00:00Z" }),
    job({ id: "sdxl", config: { arch: "sdxl" }, completed_at: "2026-10-09T10:00:00Z" }),
    job({ id: "live", status: "running", claimed_at: "2026-10-10T10:00:00Z" }),
    job({ id: "undated" }),
  ];

  it("lists both arches newest first, undated last", () => {
    expect(historyRows(jobs).map((r) => r.id)).toEqual(["live", "sdxl", "old", "undated"]);
  });

  it("reads the arch from the run's config (no arch = LTX)", () => {
    const rows = historyRows(jobs);
    expect(rows.find((r) => r.id === "sdxl")?.arch).toBe("sdxl");
    expect(rows.find((r) => r.id === "old")?.arch).toBe("ltx");
  });

  it("filters to one arch", () => {
    expect(historyRows(jobs, "sdxl").map((r) => r.id)).toEqual(["sdxl"]);
    expect(historyRows(jobs, "ltx").map((r) => r.id)).toEqual(["live", "old", "undated"]);
  });
});
