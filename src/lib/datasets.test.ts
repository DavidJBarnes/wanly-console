import { describe, expect, it } from "vitest";

import {
  byRecent, canLockByHand, canUnlock, captionCoverage, captionProgressLabel, datasetNameProblem,
  defaultCloneName, isAssigned, lockedReason, lockLabel, lockReasonBody, manualLockLabel,
  localDate, ownerLabel, parseTags, progressPct, regularizeProgressLabel, scoreFor,
  trainedByLabel, trainedLabel, unlockedLabel, usedInLabel,
} from "./datasets";
import type { Dataset } from "../api/types";

const ds = (over: Partial<Dataset> = {}): Dataset => ({
  id: "d", name: "n", tags: null, notes: null, images: [], prefix: null,
  anchor_uri: null, created_at: null, updated_at: null, ...over,
});

describe("parseTags", () => {
  it("splits, trims and drops empties", () => {
    // ",,character, faces," is easy to produce by hand-editing a field.
    expect(parseTags(",,character, faces,")).toEqual(["character", "faces"]);
  });

  it("treats no tags and an empty string the same", () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });
});

describe("datasetNameProblem", () => {
  it("accepts the names people actually use", () => {
    expect(datasetNameProblem("p@y v2 faces")).toBeNull();
  });

  it("agrees with the API, so the dialog cannot offer a name that 422s", () => {
    // Same character class as app/schemas/datasets.py's NAME_RE.
    for (const ok of ["k3lly2026", "p@y", "a b", "a_b", "a.b", "a-b"]) {
      expect(datasetNameProblem(ok)).toBeNull();
    }
  });
});

describe("byRecent", () => {
  it("puts the one you just touched first", () => {
    const older = ds({ id: "a", updated_at: "2026-09-01T00:00:00Z" });
    const newer = ds({ id: "b", updated_at: "2026-09-07T00:00:00Z" });
    expect([older, newer].sort(byRecent)[0].id).toBe("b");
  });
});

describe("scoreFor", () => {
  const set = ds({ anchor_uri: "s3://a", scores: { "s3://b": 0.61, "s3://c": null } });
  it("reads the score the API saved, so the ring survives a reload", () => {
    expect(scoreFor(set, "s3://b", {})).toEqual({ cos: 0.61, is_anchor: false });
  });
  it("keeps a saved no-face as no-face, not as unscored", () => {
    expect(scoreFor(set, "s3://c", {})).toEqual({ cos: null, is_anchor: false });
  });
  it("prefers a score from this page over the saved one", () => {
    expect(scoreFor(set, "s3://b", { "s3://b": { cos: 0.3, is_anchor: false } }))
      .toEqual({ cos: 0.3, is_anchor: false });
  });
  it("calls the anchor the anchor, and an unknown image unscored", () => {
    expect(scoreFor(set, "s3://a", {})?.is_anchor).toBe(true);
    expect(scoreFor(set, "s3://z", {})).toBeUndefined();
  });
});

describe("captionCoverage", () => {
  it("counts blank captions as missing", () => {
    const set = ds({ images: ["a", "b", "c"], captions: { a: "close-up, smiling", b: "  " } });
    expect(captionCoverage(set)).toEqual({ captioned: 1, missing: 2 });
  });
  it("treats a set from before captions as all missing", () => {
    expect(captionCoverage(ds({ images: ["a"] }))).toEqual({ captioned: 0, missing: 1 });
  });
});

describe("progress labels", () => {
  it("says how far captioning has got, and why it stopped", () => {
    expect(captionProgressLabel({ total: 40, captioned: 12, running: true, error: null }))
      .toBe("captioning 12 of 40");
    expect(captionProgressLabel({ total: 40, captioned: 12, running: false, error: "ollama down" }))
      .toMatch(/ollama down/);
    expect(captionProgressLabel({ total: 40, captioned: 40, running: false, error: null }))
      .toBeNull();
  });
  it("says failures while a pool renders", () => {
    expect(regularizeProgressLabel({ requested: 150, done: 12, failed: 1, running: true }))
      .toBe("rendering 12 of 150 (1 failed)");
    expect(regularizeProgressLabel({ requested: 150, done: 150, failed: 0, running: false }))
      .toBeNull();
  });
  it("has no percentage before there is a total", () => {
    expect(progressPct(3, 0)).toBeNull();
    expect(progressPct(12, 40)).toBe(30);
  });
});

describe("ownership", () => {
  it("flags a set with no kind, or a kind with no owner, as unassigned", () => {
    expect(isAssigned(ds())).toBe(false);
    expect(isAssigned(ds({ kind: "character", character: " " }))).toBe(false);
    expect(isAssigned(ds({ kind: "regularization", reg_class: null }))).toBe(false);
    expect(isAssigned(ds({ kind: "character", character: "David" }))).toBe(true);
    expect(isAssigned(ds({ kind: "regularization", reg_class: "woman" }))).toBe(true);
  });
  it("labels the owner by kind", () => {
    expect(ownerLabel(ds({ kind: "composition", character: "DavidKelly-2026" })))
      .toBe("Pair · DavidKelly-2026");
    expect(ownerLabel(ds({ kind: "regularization", reg_class: "man" })))
      .toBe("Regularization · man");
    expect(ownerLabel(ds())).toBeNull();
  });
});

describe("trained runs inform, never lock (wanly-api#420)", () => {
  const v5 = { job_id: "j5", character: "Kelly-2000", version: 5, status: "completed" };
  const v6 = { job_id: "j6", character: "Kelly-2000", version: 6, status: "running" };

  it("names the run, its version and where it is, and SDXL when it is one", () => {
    expect(trainedByLabel(v5)).toBe("Kelly-2000 v5 (completed)");
    expect(trainedByLabel({ ...v5, arch: "sdxl" })).toBe("Kelly-2000 v5 SDXL (completed)");
  });

  it("lists every run that trained on the set", () => {
    expect(trainedLabel({ trained_by: [v5, v6] }))
      .toBe("Trained Kelly-2000 v5 (completed), Kelly-2000 v6 (running)");
    expect(trainedLabel({ trained_by: [] })).toBeNull();
    expect(trainedLabel({})).toBeNull();
  });

  it("a trained set is not locked: no lock chip, no reason, Lock is offered", () => {
    const d = ds({ locked: false, trained_by: [v5] });
    expect(lockLabel(d)).toBeNull();
    expect(lockedReason(d)).toBeNull();
    expect(canLockByHand(d)).toBe(true);
  });
});

describe("used-in badges (wanly-api#422)", () => {
  const run = (character: string, version: number, arch = "ltx") =>
    ({ job_id: `${character}${version}`, character, version, status: "completed", arch });

  it("lists one character's versions in order", () => {
    expect(usedInLabel([run("Joana", 3), run("Joana", 1)])).toBe("v1, v3");
  });

  it("tells SDXL runs apart, and names characters when there are several", () => {
    expect(usedInLabel([run("Joana", 1), run("Joana", 2, "sdxl")])).toBe("v1 · v2 SDXL");
    expect(usedInLabel([run("Joana", 1), run("DavidJoana", 1)]))
      .toBe("Joana v1 · DavidJoana v1");
  });

  it("is null for an image no run trained on", () => {
    expect(usedInLabel(undefined)).toBeNull();
    expect(usedInLabel([])).toBeNull();
  });
});

describe("hand locks and archiving (wanly-api#358, #419)", () => {
  const at = "2026-09-28T12:00:00Z";

  it("says it was locked by hand, with the reason when there is one", () => {
    expect(manualLockLabel({ locked_at: at, locked_reason: "final v5 set" }))
      .toBe("Locked by hand: final v5 set");
    expect(manualLockLabel({ locked_at: at, locked_reason: null })).toBe("Locked by hand");
    expect(manualLockLabel({ locked_at: at, locked_reason: "  " })).toBe("Locked by hand");
    expect(manualLockLabel({ locked_at: null, locked_reason: "stale" })).toBeNull();
  });

  it("labels the chip by what makes it read-only", () => {
    expect(lockLabel(ds({ locked: true, locked_at: at, locked_reason: "final" })))
      .toBe("Locked by hand: final");
    expect(lockLabel(ds({ locked: true, archived_at: at }))).toBe("Archived");
    expect(lockLabel(ds({ locked: true }))).toBe("Locked");
  });

  it("gives the way back in the tooltip", () => {
    const r = lockedReason(ds({ locked: true, locked_at: at, locked_reason: "final v5 set" }));
    expect(r).toContain("Locked by hand");
    expect(r).toContain("final v5 set");
    expect(r).toContain("Unlock");
    expect(r).not.toContain("Clone");
    expect(lockedReason(ds({ locked: true, archived_at: at }))).toContain("Unarchive");
  });

  it("offers Lock on an editable set and Unlock on a hand-locked one, never on an archived one", () => {
    expect(canLockByHand(ds())).toBe(true);
    expect(canLockByHand(ds({ locked: true, locked_at: at }))).toBe(false);
    expect(canLockByHand(ds({ locked: true, archived_at: at }))).toBe(false);
    expect(canUnlock(ds())).toBe(false);
    expect(canUnlock(ds({ locked: true, locked_at: at }))).toBe(true);
    expect(canUnlock(ds({ locked: true, archived_at: at }))).toBe(false);
  });

  it("sends the reason trimmed, and none when blank", () => {
    expect(lockReasonBody("  final v5 set ")).toBe("final v5 set");
    expect(lockReasonBody("   ")).toBeUndefined();
    expect(lockReasonBody("")).toBeUndefined();
  });
});

describe("defaultCloneName", () => {
  it("appends copy", () => {
    expect(defaultCloneName("Kelly-2000 faces")).toBe("Kelly-2000 faces copy");
  });

  it("is always a name the API accepts, even from a name at the length limit", () => {
    const long = defaultCloneName("a".repeat(100));
    expect(long.length).toBeLessThanOrEqual(100);
    expect(datasetNameProblem(long)).toBeNull();
  });
});

describe("unlock (wanly-api#363)", () => {
  // Midday UTC, so the local date is the same in every timezone the tests might run in.
  const at = "2026-09-29T12:00:00Z";

  it("says when it was unlocked while it is still unlocked", () => {
    expect(unlockedLabel(ds({ locked: false, unlocked_at: at }))).toBe("Unlocked 2026-09-29");
  });

  it("drops the note once it is locked again, or if it never was unlocked", () => {
    expect(unlockedLabel(ds({ locked: true, locked_at: at, unlocked_at: at }))).toBeNull();
    expect(unlockedLabel(ds({ locked: false, unlocked_at: null }))).toBeNull();
    expect(unlockedLabel(ds())).toBeNull();
  });

  it("formats a date the same in every locale, and passes junk through", () => {
    expect(localDate(at)).toMatch(/^2026-09-29$/);
    expect(localDate("not a date")).toBe("not a date");
  });

  it("keeps the Lock and Unlock buttons mutually exclusive", () => {
    for (const d of [ds(), ds({ locked: true, locked_at: at }), ds({ locked: false, unlocked_at: at })]) {
      expect(canLockByHand(d)).toBe(!canUnlock(d));
    }
  });
});
