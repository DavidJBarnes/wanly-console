/**
 * The console's half of wanly-console#454.
 *
 * The eligibility rules matter more than they look: a rule that lets a doomed job through costs
 * a GPU hour to discover, and one that disagrees with the API's own limits offers a button that
 * 422s. Both numbers here are deliberately the same as `app/schemas/training.py`'s.
 */
import { describe, expect, it } from "vitest";

import {
  estimatedMinutes, stepsPerEpoch,
  apiErrorText, defaultEpochsForSamples, stepsForSamples,
  epochRows, lossPath,
  groupByCharacter,
  characterProblem, checkpointInUse, checkpointLabel, loraStem,
  nextVersion, versionOfLora,
  MAX_IMAGES,
  MIN_IMAGES,
  byTrainingInterest,
  runTimeLabel,
  formatRunDuration,
  canTrain,
  characterHasTrained, datasetsOwnedBy, defaultPairName, formIncomplete, initialFromDataset,
  isPairCharacter, problemsFromError, runCharacter, trainingBody, RECIPE_DEFAULTS,
  trainingPct,
  trainingSummary,
  isSdxlJob, SDXL_REPEATS,
  allInSecondsPerStep, estimateRunMinutes, liveSecondsPerIt, remainingMinutes, queueEtas,
  etaLabel, formatMinutes, UPLOAD_MINUTES,
} from "./trainingJob";
import type { Dataset, TrainingJob } from "../api/types";
import type { TrainForm } from "./trainingJob";

const keys = (n: number) => Array.from({ length: n }, (_, i) => `s3://b/img${i}.jpg`);

const job = (over: Partial<TrainingJob> = {}): TrainingJob => ({
  id: "j1", character: "p@y", trigger: "p@y", version: 2, status: "pending",
  dataset_images: keys(13), config: {}, worker_name: null, gpu_name: null,
  progress_log: null, step: null, total_steps: null, error_message: null,
  checkpoints: null, output_lora_path: null, loss_log: null, epochs: null,
  publish_requests: null, notes: null, thumbnail_uri: null,
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

  it("reads a pending queue oldest-first, in claim order", () => {
    // The trainer claims created_at ASC; displayed newest-first, the job that trains NEXT
    // sits at the bottom and every add looks like it cut in line (console#526).
    const first = job({ status: "pending", created_at: "2026-09-23T03:40:00Z" });
    const later = job({ status: "pending", created_at: "2026-09-23T04:15:00Z" });
    expect([later, first].sort(byTrainingInterest).map((j) => j.created_at))
      .toEqual(["2026-09-23T03:40:00Z", "2026-09-23T04:15:00Z"]);
  });
});

describe("runTimeLabel", () => {
  it("says nothing about a run that has not started", () => {
    // A queued run has no times to tell. Inventing a "start" out of the queue time would
    // charge every short run's wait in line to its own duration (console#527).
    expect(runTimeLabel({ claimed_at: null, completed_at: null })).toBeNull();
  });

  it("says started for a live run", () => {
    expect(runTimeLabel({ claimed_at: "2026-09-23T04:07:28Z", completed_at: null }))
      .toMatch(/^started \d/);
  });

  it("gives a finished run its window and its length", () => {
    const label = runTimeLabel({
      claimed_at: "2026-09-23T04:07:28Z",
      completed_at: "2026-09-23T04:49:28Z",
    });
    expect(label).toMatch(/–/);
    expect(label).toContain("42m");
  });

  it("spans an hour honestly", () => {
    expect(formatRunDuration((72 * 60 + 1) * 1000)).toBe("1h 12m");
    expect(formatRunDuration(10 * 1000)).toBe("<1m");
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

  it("drains a pending queue top-down", () => {
    // The page this feeds: one character training now, three queued behind it. The queue
    // must read in the order the trainer drains it — next first, newest add last — or it
    // looks like every new job cut in line (console#526).
    const groups = groupByCharacter([
      run("newest", 1, "pending", "2026-09-23T04:15:00Z"),
      run("queuedA", 1, "pending", "2026-09-23T03:40:00Z"),
      run("training", 1, "running", "2026-09-23T03:39:00Z"),
      run("queuedB", 1, "pending", "2026-09-23T03:41:00Z"),
      run("done", 1, "completed", "2026-09-23T04:20:00Z"),
    ]);
    expect(groups.map((g) => g.character))
      .toEqual(["training", "queuedA", "queuedB", "newest", "done"]);
  });
});

describe("epochRows", () => {
  it("merges what was written with what reached the bucket, final last", () => {
    const rows = epochRows({
      epochs: [{ label: "final", step: 100, loss: 0.68 }, { label: "e01", step: 80, loss: 0.7 }],
      checkpoints: ["s3://ltx-loras/character/pay_v1_final.safetensors"],
      publish_requests: ["e01"],
    });
    expect(rows.map((r) => r.label)).toEqual(["e01", "final"]);
    expect(rows[0].uri).toBeNull();
    expect(rows[0].requested).toBe(true);
    expect(rows[1].uri).toContain("pay_v1_final");
  });
  it("still lists an older run's checkpoints that have no epoch record", () => {
    const rows = epochRows({ epochs: null, checkpoints: ["s3://x/pay_v2_e03.safetensors"], publish_requests: null });
    expect(rows).toEqual([{ label: "e03", step: null, loss: null, uri: "s3://x/pay_v2_e03.safetensors", requested: false }]);
  });
});

describe("lossPath", () => {
  it("needs two points and scales y to the data, not to zero", () => {
    expect(lossPath([[1, 0.9]], 100, 40).points).toEqual([]);
    const { points, min, max } = lossPath([[0, 0.9], [50, 0.8], [100, 0.7]], 100, 40, 0);
    expect(min).toBe(0.7);
    expect(max).toBe(0.9);
    expect(points[0]).toMatchObject({ x: 0, y: 0 });
    expect(points[2]).toMatchObject({ x: 100, y: 40 });
  });
  it("ignores junk", () => {
    expect(lossPath([[0, NaN], [1, 0.5]] as [number, number][], 10, 10).points).toEqual([]);
  });
});

describe("apiErrorText", () => {
  it("turns pydantic's list of errors into a sentence", () => {
    const e = { response: { data: { detail: [
      { loc: ["body", "lora_name"], msg: "String should match pattern '^[A-Za-z0-9._-]+$'" },
    ] } } };
    expect(apiErrorText(e, "x")).toBe("lora_name: String should match pattern '^[A-Za-z0-9._-]+$'");
  });
  it("passes a plain detail through and falls back otherwise", () => {
    expect(apiErrorText({ response: { data: { detail: "nope" } } }, "x")).toBe("nope");
    expect(apiErrorText(new Error("boom"), "x")).toBe("x");
  });
});

describe("epochs", () => {
  it("defaults to the recipe's 1200 steps in whole epochs", () => {
    expect(defaultEpochsForSamples(stepsPerEpoch(8))).toBe(15);
    expect(defaultEpochsForSamples(stepsPerEpoch(27))).toBe(4);
    expect(defaultEpochsForSamples(stepsPerEpoch(50))).toBe(2);
    expect(defaultEpochsForSamples(stepsPerEpoch(400))).toBe(1);
  });
  it("derives steps so the last epoch lands on the final step", () => {
    expect(stepsForSamples(4, stepsPerEpoch(27))).toBe(1080);
    expect(stepsForSamples(15, stepsPerEpoch(8))).toBe(1200);
  });
  it("uses the server's epoch length once there is one", () => {
    // 30 character images at 10 repeats plus a regularization pool sized to match is 600
    // samples an epoch, not 300: counting only the character images would double the run.
    expect(stepsForSamples(2, 600)).toBe(1200);
    expect(defaultEpochsForSamples(600)).toBe(2);
  });
  it("never produces a zero-step run", () => {
    expect(stepsForSamples(0, 0)).toBe(1);
    expect(defaultEpochsForSamples(0)).toBeGreaterThanOrEqual(1);
  });
  it("estimates minutes from the measured rate", () => {
    expect(estimatedMinutes(100)).toBe(6);
  });
});

const ds = (id: string, kind: Dataset["kind"], owner: string | null): Dataset => ({
  id, name: id, tags: null, notes: null, images: [], prefix: null, anchor_uri: null,
  kind, character: owner, created_at: null, updated_at: null,
});

const form = (over: Partial<TrainForm> = {}): TrainForm => ({
  mode: "solo", character: "", memberA: "", memberB: "", pairName: "", datasets: {},
  compositionId: null, allowNoComposition: false, allowLowScores: false, version: 1, steps: 1200,
  publish: "final",
  ...RECIPE_DEFAULTS, ...over,
});

describe("characters", () => {
  it("counts a character as trained once it has a LoRA or a provenance", () => {
    // The trigger locks at this point: the LoRA learned it, and another would name nothing.
    expect(characterHasTrained({ char_lora: "" })).toBe(false);
    // The API registers an untrained character with char_lora "none".
    expect(characterHasTrained({ char_lora: "none" })).toBe(false);
    expect(characterHasTrained({ char_lora: "None" })).toBe(false);
    expect(characterHasTrained({ char_lora: "david_v1" })).toBe(true);
    expect(characterHasTrained({
      char_lora: "", trained_from: [{ dataset_id: "d", name: "David", count: 30 }],
    })).toBe(true);
  });
  it("treats a row with no kind as solo", () => {
    expect(isPairCharacter({ kind: null })).toBe(false);
    expect(isPairCharacter({})).toBe(false);
    expect(isPairCharacter({ kind: "pair" })).toBe(true);
  });
  it("names a pair by joining its members", () => {
    expect(defaultPairName("David", "Kelly-2026")).toBe("DavidKelly-2026");
    expect(defaultPairName(" David ", "Kelly-2000")).toBe("DavidKelly-2000");
  });
});

describe("datasetsOwnedBy", () => {
  const all = [
    ds("a", "character", "David"), ds("b", "character", "Kelly-2026"),
    ds("c", "composition", "DavidKelly-2026"), ds("d", null, null),
    ds("e", "character", "david"),
  ];
  it("lists only the sets of that kind owned by that name", () => {
    // Kelly's set must not be offered for David — the mistake that put another person's
    // images inside a LoRA.
    expect(datasetsOwnedBy(all, "character", "David").map((d) => d.id)).toEqual(["a", "e"]);
    expect(datasetsOwnedBy(all, "composition", "DavidKelly-2026").map((d) => d.id)).toEqual(["c"]);
  });
  it("never offers an unassigned set", () => {
    expect(datasetsOwnedBy(all, "character", "").map((d) => d.id)).toEqual([]);
  });
});

describe("trainingBody", () => {
  it("sends a solo run with no trigger, gender or filename in it", () => {
    // Those come from the registry now; the request cannot carry a wrong one.
    const body = trainingBody(form({ character: "David", datasets: { David: "a" } }));
    expect(body).toEqual({
      mode: "solo", character: "David", datasets: { David: "a" },
      version: 1, steps: 1200, publish: "final",
      caption_mode: "per_image", regularization: false, base_checkpoint: "ltx-2.3-22b-dev",
    });
  });
  it("defaults to Kelly-2000 v5's recipe: dev base, no regularization, stored captions", () => {
    // The API's own defaults are 10Eros and regularization on; the dialog must send v5's
    // explicitly or a run silently trains a different recipe from the one that held her.
    const body = trainingBody(form({ mode: "pair", memberA: "A", memberB: "B", pairName: "AB" }));
    expect(body.base_checkpoint).toBe("ltx-2.3-22b-dev");
    expect(body.regularization).toBe(false);
    expect(body.caption_mode).toBe("per_image");
  });
  it("sends the low-score acknowledgement only when ticked", () => {
    expect(trainingBody(form({ character: "David" }))).not.toHaveProperty("allow_low_scores");
    expect(trainingBody(form({ character: "David", allowLowScores: true })).allow_low_scores)
      .toBe(true);
    expect(trainingBody(form({ mode: "pair", memberA: "A", memberB: "B", pairName: "AB",
      allowLowScores: true })).allow_low_scores).toBe(true);
  });
  it("sends the recipe the user picked", () => {
    const body = trainingBody(form({
      character: "David", baseCheckpoint: "10Eros_v1.5_bf16", regularization: true,
      captionMode: "trigger_only",
    }));
    expect(body).toMatchObject({
      base_checkpoint: "10Eros_v1.5_bf16", regularization: true, caption_mode: "trigger_only",
    });
  });
  it("omits the dataset map when nothing is chosen, so the API picks the only one", () => {
    expect(trainingBody(form({ character: "David" }))).not.toHaveProperty("datasets");
  });
  it("sends a pair under the pair's own name, never a member's", () => {
    const body = trainingBody(form({
      mode: "pair", memberA: "David", memberB: "Kelly-2026", pairName: "DavidKelly-2026",
      datasets: { David: "a", "Kelly-2026": "b", Stale: "z" }, compositionId: "c",
    }));
    expect(body.character).toBe("DavidKelly-2026");
    expect(body.members).toEqual(["David", "Kelly-2026"]);
    expect(body.datasets).toEqual({ David: "a", "Kelly-2026": "b" });
    expect(body.composition_dataset_id).toBe("c");
    expect(body.allow_no_composition).toBe(false);
  });
  it("drops a stale no-composition acknowledgement once a composition set is chosen", () => {
    const base = { mode: "pair" as const, memberA: "A", memberB: "B", pairName: "AB" };
    expect(trainingBody(form({ ...base, allowNoComposition: true })).allow_no_composition)
      .toBe(true);
    expect(trainingBody(form({ ...base, allowNoComposition: true, compositionId: "c" }))
      .allow_no_composition).toBe(false);
  });
  it("knows which row a run publishes to", () => {
    expect(runCharacter(form({ character: "David" }))).toBe("David");
    expect(runCharacter(form({ mode: "pair", character: "David", pairName: "DavidKelly" })))
      .toBe("DavidKelly");
  });
});

describe("formIncomplete", () => {
  it("asks for a character before asking the server anything", () => {
    expect(formIncomplete(form())).toMatch(/character/);
    expect(formIncomplete(form({ character: "David" }))).toBeNull();
  });
  it("needs two different members and a usable pair name", () => {
    const pair = { mode: "pair" as const };
    expect(formIncomplete(form({ ...pair, memberA: "David" }))).toMatch(/both/);
    expect(formIncomplete(form({ ...pair, memberA: "David", memberB: "david", pairName: "x" })))
      .toMatch(/different/);
    expect(formIncomplete(form({ ...pair, memberA: "A", memberB: "B", pairName: "" })))
      .toMatch(/name/);
    expect(formIncomplete(form({ ...pair, memberA: "A", memberB: "B", pairName: "A B" })))
      .toMatch(/spaces/);
    expect(formIncomplete(form({ ...pair, memberA: "A", memberB: "B", pairName: "AB" })))
      .toBeNull();
  });
});

describe("initialFromDataset", () => {
  const pair = {
    ...character("DavidKelly-2026", "davidkelly2026_v1"), kind: "pair" as const,
    members: ["David", "Kelly-2026"],
  };
  it("opens a character set as Solo on its owner, with that set chosen", () => {
    expect(initialFromDataset(ds("a", "character", "David"), [])).toEqual({
      mode: "solo", character: "David", datasets: { David: "a" },
    });
  });
  it("opens a composition set as Pair, members filled in from the registry", () => {
    expect(initialFromDataset(ds("c", "composition", "DavidKelly-2026"), [pair])).toEqual({
      mode: "pair", pairName: "DavidKelly-2026", memberA: "David", memberB: "Kelly-2026",
      compositionId: "c",
    });
  });
  it("opens a pair nobody has trained yet with the members left to pick", () => {
    expect(initialFromDataset(ds("c", "composition", "NewPair"), [pair])).toMatchObject({
      mode: "pair", pairName: "NewPair", memberA: "", memberB: "",
    });
  });
  it("opens empty for an unassigned or regularization set", () => {
    expect(initialFromDataset(ds("d", null, null), [])).toEqual({});
    expect(initialFromDataset(ds("r", "regularization", null), [])).toEqual({});
    expect(initialFromDataset(undefined, [])).toEqual({});
  });
});

describe("problemsFromError", () => {
  it("reads the blocking list out of POST /training's 422", () => {
    const e = { response: { data: { detail: { problems: [
      { code: "uncaptioned", message: "3 images in David have no caption" },
    ] } } } };
    expect(problemsFromError(e)).toEqual([
      { code: "uncaptioned", message: "3 images in David have no caption" },
    ]);
  });
  it("is null for any other error, so the caller falls back to apiErrorText", () => {
    expect(problemsFromError({ response: { data: { detail: "nope" } } })).toBeNull();
    expect(problemsFromError(new Error("boom"))).toBeNull();
  });
});

describe("SDXL start-image LoRAs (console#600)", () => {
  it("sends solo + arch and none of the LTX recipe knobs", () => {
    // The base, captions and regularization are the aio recipe's, decided server-side. A
    // stale pair selection must not turn an SDXL run into a pair.
    const body = trainingBody(form({
      arch: "sdxl", mode: "pair", memberA: "A", memberB: "B", pairName: "AB",
      character: "Kelly", datasets: { Kelly: "k" },
    }));
    expect(body).toEqual({
      mode: "solo", arch: "sdxl", character: "Kelly", datasets: { Kelly: "k" },
      version: 1, steps: 1200, publish: "final",
    });
  });
  it("an LTX body carries no arch, so an older API still accepts it", () => {
    expect(trainingBody(form({ character: "David" }))).not.toHaveProperty("arch");
  });
  it("only needs a character, whatever mode the toggle was left on", () => {
    expect(formIncomplete(form({ arch: "sdxl", mode: "pair" }))).toBe("pick a character");
    expect(formIncomplete(form({ arch: "sdxl", mode: "pair", character: "Kelly" }))).toBeNull();
  });
  it("counts aio's 8 repeats and its measured step time", () => {
    expect(SDXL_REPEATS).toBe(8);
    expect(stepsPerEpoch(50, "sdxl")).toBe(400);
    // 12 epochs over 50 images: 4800 steps at 1.31 s.
    expect(estimatedMinutes(4800, "sdxl")).toBe(105);
  });
  it("knows an SDXL run from its snapshot; a run without one is LTX", () => {
    expect(isSdxlJob({ config: { arch: "sdxl" } })).toBe(true);
    expect(isSdxlJob({ config: {} })).toBe(false);
  });
});

describe("time estimates (console#602)", () => {
  const T0 = Date.parse("2026-10-04T12:00:00Z");
  const min = (m: number) => new Date(T0 + m * 60000).toISOString();
  /** A completed run that took `wallMin` minutes for `steps` steps. */
  const done = (steps: number, wallMin: number, config: Record<string, unknown> = {}, at = 0) =>
    ({ id: `d${steps}-${wallMin}-${at}`, status: "completed", config, total_steps: steps,
       claimed_at: min(at), completed_at: min(at + wallMin) }) as unknown as TrainingJob;
  const job = (over: Partial<TrainingJob>) =>
    ({ id: "x", status: "pending", config: { steps: 1200 }, total_steps: 1200, step: null,
       progress_log: null, claimed_at: null, created_at: min(0), ...over }) as TrainingJob;

  it("takes the median all-in s/step of the arch's own runs, dropping a stuck one", () => {
    // 1200 steps in 80/90/86 min = 4.0/4.5/4.3 s; the 400-step run that sat 169 min is out.
    const h = [done(1200, 80), done(1200, 90, {}, 1), done(1200, 86, {}, 2), done(400, 169, {}, 3)];
    expect(allInSecondsPerStep("ltx", h)).toBeCloseTo(4.3, 1);
    expect(allInSecondsPerStep("sdxl", h)).toBeNull();   // no SDXL history yet
  });

  it("falls back to the measured constants without history", () => {
    expect(estimateRunMinutes("ltx", 1200, "final", [])).toBe(86);           // 1200 x 4.3 s
    // SDXL: 1536 x 1.31 s training + 3 min overhead + one 25 min upload.
    expect(estimateRunMinutes("sdxl", 1536, "final", [])).toBe(62);
    expect(estimateRunMinutes("sdxl", 1536, "all", []) - 62).toBe(UPLOAD_MINUTES.sdxl);
  });

  it("reads the trainer's live rate off its progress line", () => {
    expect(liveSecondsPerIt("step 34/1536 (2%), 1.35s/it, ~34 min left")).toBe(1.35);
    expect(liveSecondsPerIt("staging 16 images")).toBeNull();
  });

  it("a training run: steps left at the live rate, plus the upload", () => {
    const j = job({ status: "running", step: 536, total_steps: 1536, config: { arch: "sdxl" },
                    progress_log: "step 536/1536 (35%), 1.2s/it" });
    expect(remainingMinutes(j, [], T0)).toBe(20 + 25);
  });

  it("queued runs start when everything ahead is done, oldest first", () => {
    const running = job({ id: "r", status: "running", step: 1000, total_steps: 1600,
                          progress_log: "step 1000/1600, 3s/it", config: { steps: 1600 } });
    const later = job({ id: "b", created_at: min(5) });
    const first = job({ id: "a", created_at: min(1) });
    const etas = queueEtas([running, later, first], T0);
    // running: 600 x 3 s = 30 min + 18 upload = 48.
    expect(etas.get("r")).toEqual({ startsAt: null, doneAt: T0 + 48 * 60000, minutesLeft: 48 });
    expect(etas.get("a")!.startsAt).toBe(T0 + 48 * 60000);
    expect(etas.get("b")!.startsAt).toBe(etas.get("a")!.doneAt);
    expect(etaLabel(etas.get("a"))).toMatch(/^≈ starts ~.* · done ~/);
    expect(etaLabel(etas.get("r"))).toMatch(/^≈ 48 min left · done ~/);
  });

  it("finished runs get no estimate", () => {
    expect(remainingMinutes(job({ status: "completed" }), [], T0)).toBeNull();
    expect(queueEtas([job({ status: "failed" })], T0).size).toBe(0);
  });

  it("formats hours", () => {
    expect(formatMinutes(35)).toBe("35 min");
    expect(formatMinutes(125)).toBe("2 h 5 min");
  });
});
