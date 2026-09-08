/**
 * The console's half of wanly-console#454.
 *
 * The eligibility rules matter more than they look: a rule that lets a doomed job through costs
 * a GPU hour to discover, and one that disagrees with the API's own limits offers a button that
 * 422s. Both numbers here are deliberately the same as `app/schemas/training.py`'s.
 */
import { describe, expect, it } from "vitest";

import {
  groupByCharacter,
  characterProblem, checkpointInUse, checkpointLabel, defaultCharacterFor, loraStem,
  nextVersion, versionOfLora,
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

const character = (name: string, char_lora: string) => ({
  id: name, name, char_lora, trigger: name, strength_stage_1: 0.8, strength_stage_2: 1.5,
});

describe("characterProblem mirrors the API rule", () => {
  it("refuses the dataset-name default that used to 422 at submit", () => {
    expect(characterProblem("Test faces")).toMatch(/spaces/);
  });
  it("suggests a name the rule accepts", () => {
    expect(defaultCharacterFor("Test faces")).toBe("Test-faces");
    expect(characterProblem(defaultCharacterFor("Test faces"))).toBeNull();
  });
  it("keeps p@y, which is a real character", () => {
    expect(characterProblem("p@y")).toBeNull();
  });
});

describe("nextVersion", () => {
  const done = (ch: string, version: number, status = "completed") =>
    ({ character: ch, version, status }) as unknown as TrainingJob;

  it("is one more than the highest finished run", () => {
    expect(nextVersion("p@y", [done("p@y", 2), done("p@y", 1)], [])).toBe(3);
  });
  it("reads the version off the character's LoRA when the runs predate the console", () => {
    expect(nextVersion("p@y", [], [character("p@y", "pay_v2_e05")])).toBe(3);
  });
  it("does not let a failed or cancelled run use a number up", () => {
    const jobs = [done("p@y", 1), done("p@y", 2, "failed"), done("p@y", 2, "cancelled")];
    expect(nextVersion("p@y", jobs, [])).toBe(2);
  });
  it("is 1 for a brand new character", () => {
    expect(nextVersion("newgirl", [done("p@y", 2)], [character("p@y", "pay_v2")])).toBe(1);
  });
  it("matches the character case-insensitively", () => {
    expect(nextVersion("P@Y", [done("p@y", 2)], [])).toBe(3);
  });
});

describe("checkpoint names", () => {
  it("labels an epoch and the final one", () => {
    expect(checkpointLabel("s3://ltx-loras/character/pay_v2_e05.safetensors")).toBe("e05");
    expect(checkpointLabel("s3://ltx-loras/character/pay_v2_final.safetensors")).toBe("final");
  });
  it("gives the stem a character row stores", () => {
    expect(loraStem("s3://ltx-loras/character/pay_v2_e05.safetensors")).toBe("pay_v2_e05");
    expect(versionOfLora("pay_v2_e05")).toBe(2);
    expect(versionOfLora("k3llydw_v2")).toBe(2);
    expect(versionOfLora("k3llydw")).toBeNull();
  });
  it("finds which checkpoint the character is using", () => {
    const job = {
      character: "p@y",
      checkpoints: ["s3://ltx-loras/character/pay_v2_e01.safetensors",
                    "s3://ltx-loras/character/pay_v2_final.safetensors"],
    } as unknown as TrainingJob;
    expect(checkpointInUse(job, [character("p@y", "pay_v2_final")]))
      .toBe("s3://ltx-loras/character/pay_v2_final.safetensors");
    expect(checkpointInUse(job, [character("p@y", "pay_v2_e05")])).toBeNull();
    expect(checkpointInUse(job, [])).toBeNull();
  });
});

describe("groupByCharacter", () => {
  const run = (character: string, version: number, status: string, created_at: string) =>
    ({ character, version, status, created_at, id: `${character}${version}${status}` }) as unknown as TrainingJob;

  it("is one group per character with versions newest first", () => {
    const groups = groupByCharacter([
      run("p@y", 1, "completed", "2026-09-01"),
      run("l@ura", 2, "completed", "2026-09-04"),
      run("p@y", 2, "completed", "2026-09-07"),
    ]);
    expect(groups.map((g) => g.character)).toEqual(["p@y", "l@ura"]);
    expect(groups[0].runs.map((r) => r.version)).toEqual([2, 1]);
  });

  it("puts the live attempt of a version above its failed one", () => {
    const groups = groupByCharacter([
      run("p@y", 2, "failed", "2026-09-07T22:57"),
      run("p@y", 2, "running", "2026-09-07T23:21"),
    ]);
    expect(groups[0].runs.map((r) => r.status)).toEqual(["running", "failed"]);
  });

  it("floats a character that is training to the top", () => {
    const groups = groupByCharacter([
      run("l@ura", 1, "completed", "2026-09-08"),
      run("p@y", 3, "running", "2026-09-01"),
    ]);
    expect(groups[0].character).toBe("p@y");
  });
});
