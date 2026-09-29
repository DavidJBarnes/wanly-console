import { describe, expect, it } from "vitest";

import {
  byRecent, canLockByHand, canUnlock, captionCoverage, captionProgressLabel, datasetNameProblem,
  defaultCloneName, isAssigned, lockedReason, lockLabel, lockReasonBody, manualLockLabel,
  localDate, ownerLabel, parseTags, progressPct, regularizeProgressLabel, scoreFor,
  trainedByLabel, unlockedLabel,
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

describe("lock labels (wanly-api#356)", () => {
  const v5 = { job_id: "j5", character: "Kelly-2000", version: 5, status: "completed" };
  const v6 = { job_id: "j6", character: "Kelly-2000", version: 6, status: "running" };

  it("names the run, its version and where it is", () => {
    expect(trainedByLabel(v5)).toBe("Kelly-2000 v5 (completed)");
  });

  it("lists every run that locks the set, not just the latest", () => {
    expect(lockLabel({ trained_by: [v5, v6] }))
      .toBe("Trained Kelly-2000 v5 (completed), Kelly-2000 v6 (running)");
  });

  it("still says it is locked when the API lists no runs", () => {
    expect(lockLabel({})).toBe("Trained a LoRA");
    expect(lockLabel({ trained_by: [] })).toBe("Trained a LoRA");
  });

  it("gives no reason for an unlocked set, so its controls stay on", () => {
    expect(lockedReason(ds())).toBeNull();
    expect(lockedReason(ds({ locked: false, trained_by: [] }))).toBeNull();
  });

  it("says what locked it and that Clone is the way out", () => {
    const r = lockedReason(ds({ locked: true, trained_by: [v5] }));
    expect(r).toContain("trained Kelly-2000 v5 (completed)");
    expect(r).toContain("Clone");
  });
});

describe("hand locks (wanly-api#358)", () => {
  const v5 = { job_id: "j5", character: "Kelly-2000", version: 5, status: "completed" };
  const at = "2026-09-28T12:00:00Z";

  it("says it was locked by hand, with the reason when there is one", () => {
    expect(manualLockLabel({ locked_at: at, locked_reason: "final v5 set" }))
      .toBe("Locked by hand: final v5 set");
    expect(manualLockLabel({ locked_at: at, locked_reason: null })).toBe("Locked by hand");
    // A blank reason is no reason: the chip must not end in an empty "Locked by hand: ".
    expect(manualLockLabel({ locked_at: at, locked_reason: "  " })).toBe("Locked by hand");
    expect(manualLockLabel({ locked_at: null, locked_reason: "stale" })).toBeNull();
  });

  it("tells a hand lock from a training lock on the chip", () => {
    expect(lockLabel({ trained_by: [], locked_at: at, locked_reason: "final v5 set" }))
      .toBe("Locked by hand: final v5 set");
    expect(lockLabel({ trained_by: [v5], locked_at: null }))
      .toBe("Trained Kelly-2000 v5 (completed)");
  });

  it("shows both reasons when both apply", () => {
    expect(lockLabel({ trained_by: [v5], locked_at: at, locked_reason: "final" }))
      .toBe("Trained Kelly-2000 v5 (completed) · Locked by hand: final");
  });

  it("turns controls off for a hand lock exactly as for a training lock", () => {
    const r = lockedReason(ds({ locked: true, trained_by: [], locked_at: at,
                                locked_reason: "final v5 set" }));
    expect(r).toContain("locked by hand");
    expect(r).toContain("final v5 set");
    expect(r).toContain("Clone");
    // No LoRA to be untrue to.
    expect(r).not.toContain("LoRA's record");
  });

  it("names both reasons in the tooltip when both apply", () => {
    const r = lockedReason(ds({ locked: true, trained_by: [v5], locked_at: at }));
    expect(r).toContain("trained Kelly-2000 v5 (completed) and was locked by hand");
    expect(r).toContain("LoRA's record");
  });

  it("is driven by locked alone: a stray locked_at does not lock an unlocked set", () => {
    expect(lockedReason(ds({ locked: false, locked_at: at }))).toBeNull();
  });

  it("offers Lock only on a set that is not locked for any reason", () => {
    expect(canLockByHand(ds())).toBe(true);
    expect(canLockByHand(ds({ locked: false }))).toBe(true);
    expect(canLockByHand(ds({ locked: true, trained_by: [v5] }))).toBe(false);
    expect(canLockByHand(ds({ locked: true, locked_at: at }))).toBe(false);
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

describe("one-time unlock (wanly-api#363)", () => {
  const v6 = { job_id: "j6", character: "Me", version: 6, status: "pending" };
  // Midday UTC, so the local date is the same in every timezone the tests might run in.
  const at = "2026-09-29T12:00:00Z";

  it("offers Unlock on a set locked for either reason, and only then", () => {
    expect(canUnlock(ds())).toBe(false);
    expect(canUnlock(ds({ locked: false, unlocked_at: at }))).toBe(false);
    expect(canUnlock(ds({ locked: true, trained_by: [v6] }))).toBe(true);
    expect(canUnlock(ds({ locked: true, locked_at: at }))).toBe(true);
  });

  it("says when it was unlocked while it is still unlocked", () => {
    expect(unlockedLabel(ds({ locked: false, unlocked_at: at }))).toBe("Unlocked 2026-09-29");
  });

  it("drops the note once it is locked again, or if it never was unlocked", () => {
    // The next run (or a hand lock) locks it again; the lock chip then says why.
    expect(unlockedLabel(ds({ locked: true, trained_by: [v6], unlocked_at: at }))).toBeNull();
    expect(unlockedLabel(ds({ locked: true, locked_at: at, unlocked_at: at }))).toBeNull();
    expect(unlockedLabel(ds({ locked: false, unlocked_at: null }))).toBeNull();
    expect(unlockedLabel(ds())).toBeNull();
  });

  it("formats a date the same in every locale, and passes junk through", () => {
    expect(localDate(at)).toMatch(/^2026-09-29$/);
    expect(localDate("not a date")).toBe("not a date");
  });

  it("keeps the Lock and Unlock buttons mutually exclusive", () => {
    for (const d of [ds(), ds({ locked: true, trained_by: [v6] }), ds({ locked: false, unlocked_at: at })]) {
      expect(canLockByHand(d)).toBe(!canUnlock(d));
    }
  });
});
