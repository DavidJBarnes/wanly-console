/**
 * The console's half of wanly-console#454.
 *
 * The eligibility rules matter more than they look: a rule that lets a doomed job through costs
 * a GPU hour to discover, and one that disagrees with the API's own limits offers a button that
 * 422s. Both numbers here are deliberately the same as `app/schemas/training.py`'s.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_IMAGES,
  MIN_IMAGES,
  byTrainingInterest,
  canTrain,
  defaultLoraName,
  loraFilename,
  nameNeedsSanitising,
  trainingPct,
  trainingSummary,
} from "./trainingJob";
import type { TrainingJob } from "../api/types";

const keys = (n: number) => Array.from({ length: n }, (_, i) => `s3://b/img${i}.jpg`);

const job = (over: Partial<TrainingJob> = {}): TrainingJob => ({
  id: "j1", character: "p@y", trigger: "p@y", version: 2, status: "pending",
  dataset_images: keys(13), config: {}, worker_name: null, gpu_name: null,
  progress_log: null, step: null, total_steps: null, error_message: null,
  checkpoints: null, output_lora_path: null,
  created_at: "2026-09-07T10:00:00Z", claimed_at: null, completed_at: null, ...over,
});

describe("canTrain", () => {
  it("refuses a selection under the floor", () => {
    // p@y worked on 13; 8 is where it stops being arguable.
    expect(canTrain(keys(7)).ok).toBe(false);
    expect(canTrain(keys(MIN_IMAGES)).ok).toBe(true);
  });

  it("refuses an absurd selection", () => {
    // A guard against a mis-click selecting a whole folder.
    expect(canTrain(keys(MAX_IMAGES + 1)).ok).toBe(false);
  });

  it("refuses duplicates", () => {
    // A duplicate trains the same image twice under two names, reweighting the set silently.
    const dupes = [...keys(12), "s3://b/img0.jpg"];
    expect(canTrain(dupes).ok).toBe(false);
    expect(canTrain(dupes).reason).toMatch(/duplicate/);
  });

  it("allows a large set but says the extras dilute", () => {
    const r = canTrain(keys(120));
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/dilute/);
  });

  it("says nothing extra about a sensible set", () => {
    expect(canTrain(keys(50))).toEqual({ ok: true });
  });
});

describe("the LoRA filename", () => {
  it("defaults by stripping, and never invents a letter", () => {
    // p@y strips to py. The file actually in use is pay_v2_e05.safetensors, because a human
    // read @ as a — which is why this is a field the user corrects, not a derivation.
    expect(defaultLoraName("p@y")).toBe("py");
    expect(defaultLoraName("k3lly2026")).toBe("k3lly2026");
  });

  it("always yields something usable", () => {
    expect(defaultLoraName("@@@")).toBe("lora");
  });

  it("builds the filename from the stem the user settled on", () => {
    expect(loraFilename("pay", 2, 5)).toBe("pay_v2_e05.safetensors");
  });

  it("omits the epoch when there is not one yet", () => {
    expect(loraFilename("k3lly2026", 1)).toBe("k3lly2026_v1.safetensors");
  });

  it("flags only the names the default would change", () => {
    expect(nameNeedsSanitising("p@y")).toBe(true);
    expect(nameNeedsSanitising("k3lly2026")).toBe(false);
  });
});

describe("trainingPct", () => {
  it("is null before the trainer has reported a step", () => {
    // A queued job has no honest percentage, and 0% reads as "started and stuck".
    expect(trainingPct(job())).toBeNull();
    expect(trainingPct(job({ step: 0, total_steps: null }))).toBeNull();
  });

  it("rounds and clamps", () => {
    expect(trainingPct(job({ step: 540, total_steps: 1200 }))).toBe(45);
    expect(trainingPct(job({ step: 1300, total_steps: 1200 }))).toBe(100);
  });
});

describe("trainingSummary", () => {
  it("does not invent an ETA for a job that has not started", () => {
    expect(trainingSummary(job())).toBe("queued");
  });

  it("falls back to the log line while running without a step", () => {
    expect(trainingSummary(job({ status: "running", progress_log: "caching latents" })))
      .toBe("caching latents");
  });

  it("reports step and percent once there is one", () => {
    expect(trainingSummary(job({ status: "running", step: 540, total_steps: 1200 })))
      .toBe("45% — step 540 of 1200");
  });

  it("counts the checkpoints, because choosing between them is the next job", () => {
    expect(trainingSummary(job({ status: "completed", checkpoints: ["a", "b", "c"] })))
      .toBe("3 checkpoints");
  });

  it("surfaces the error rather than the word failed", () => {
    expect(trainingSummary(job({ status: "failed", error_message: "CUDA out of memory" })))
      .toBe("CUDA out of memory");
  });
});

describe("byTrainingInterest", () => {
  it("puts live work above finished work", () => {
    const order = [job({ status: "completed" }), job({ status: "running" }),
                   job({ status: "pending" }), job({ status: "claimed" })]
      .sort(byTrainingInterest).map((j) => j.status);
    expect(order).toEqual(["running", "claimed", "pending", "completed"]);
  });

  it("breaks ties by most recent", () => {
    const older = job({ status: "completed", created_at: "2026-09-01T00:00:00Z" });
    const newer = job({ status: "completed", created_at: "2026-09-07T00:00:00Z" });
    expect([older, newer].sort(byTrainingInterest)[0]).toBe(newer);
  });
});

describe("what the dialog needs to get right", () => {
  it("treats a cross-view selection as one set", () => {
    // Select mode survives navigation between the folder, search and favourites views, so a
    // selection made in one and completed in another must not silently lose half its images.
    // The page maps keys to s3:// URIs across every list; this is the rule that mapping serves.
    const uris = ["s3://b/a.jpg", "s3://b/c.jpg", "s3://b/d.jpg"];
    expect(new Set(uris).size).toBe(uris.length);
    expect(canTrain(uris.concat(keys(10))).ok).toBe(true);
  });

  it("refuses a selection whose URIs could not all be resolved", () => {
    // If a key cannot be mapped to a URI it is dropped, and a short set must fail the floor
    // rather than quietly training on fewer images than were selected.
    const resolved = keys(5);
    expect(canTrain(resolved).ok).toBe(false);
  });
});

describe("selecting a whole dataset", () => {
  it("a folder-sized selection is trainable", () => {
    // The point of Select All: training a 50-image character meant fifty clicks, which is not
    // a flow anyone would use.
    expect(canTrain(keys(50)).ok).toBe(true);
    expect(canTrain(keys(13)).ok).toBe(true);
  });

  it("selecting everything in a folder that is too small still fails the floor", () => {
    // Select All must not make an ineligible folder look eligible.
    expect(canTrain(keys(4)).ok).toBe(false);
  });
});
