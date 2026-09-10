import { describe, it, expect } from "vitest";
import {
  cropSelectionProblem, mergeIntoSet, withoutImage, removalWarning, MIN_TRAINABLE,
} from "./datasets";

/**
 * Removing an image is how a crop of a group photo becomes a dataset of one person: take every
 * face, then cull the people you did not mean. Until now there was no way to do it at all.
 */
describe("withoutImage", () => {
  const set = ["s3://b/a.png", "s3://b/b.png", "s3://b/c.png"];

  it("removes the one named", () => {
    expect(withoutImage(set, "s3://b/b.png")).toEqual(["s3://b/a.png", "s3://b/c.png"]);
  });

  it("keeps order, because the list is ordered and training reads it in order", () => {
    expect(withoutImage(set, "s3://b/a.png")).toEqual(["s3://b/b.png", "s3://b/c.png"]);
  });

  it("is a no-op for a uri that is not in the set", () => {
    expect(withoutImage(set, "s3://b/zz.png")).toEqual(set);
  });

  it("does not mutate the original", () => {
    const copy = [...set];
    withoutImage(set, "s3://b/b.png");
    expect(set).toEqual(copy);
  });

  it("removes every copy if a uri somehow appears twice", () => {
    // Training refuses duplicates outright, so leaving one behind would be the worse answer.
    expect(withoutImage(["x", "y", "x"], "x")).toEqual(["y"]);
  });
});

describe("removalWarning", () => {
  it("says nothing while the set stays comfortably trainable", () => {
    expect(removalWarning(20)).toBeNull();
  });

  it("warns at the point where the next removal breaks training", () => {
    expect(removalWarning(MIN_TRAINABLE)).toContain(String(MIN_TRAINABLE));
  });

  it("keeps warning below the floor rather than going quiet", () => {
    // Going quiet again would read as "fixed".
    expect(removalWarning(3)).not.toBeNull();
  });
});

/**
 * Pulling images in from the Image Repo (#489): the workflow lived where the images are, so
 * the dataset side had no path at all. The merge is the rule the picker depends on — get it
 * wrong and the PATCH replaces the set with something the user did not choose.
 */
describe("mergeIntoSet", () => {
  const set = ["s3://b/a.png", "s3://b/b.png"];

  it("appends the new images after what is already in the set", () => {
    expect(mergeIntoSet(set, ["s3://b/c.png", "s3://b/d.png"]))
      .toEqual(["s3://b/a.png", "s3://b/b.png", "s3://b/c.png", "s3://b/d.png"]);
  });

  it("keeps the set's own order, because the trainer reads it in order", () => {
    expect(mergeIntoSet(set, ["s3://b/z.png"])).toEqual([...set, "s3://b/z.png"]);
  });

  it("drops an image that is already in the set rather than adding it twice", () => {
    expect(mergeIntoSet(set, ["s3://b/b.png", "s3://b/c.png"]))
      .toEqual(["s3://b/a.png", "s3://b/b.png", "s3://b/c.png"]);
  });

  it("drops duplicates within the selection itself", () => {
    expect(mergeIntoSet([], ["s3://b/a.png", "s3://b/a.png"])).toEqual(["s3://b/a.png"]);
  });

  it("is a no-op for an empty selection", () => {
    expect(mergeIntoSet(set, [])).toEqual(set);
  });

  it("does not mutate the original", () => {
    const copy = [...set];
    mergeIntoSet(set, ["s3://b/c.png"]);
    expect(set).toEqual(copy);
  });
});

/**
 * The crop dialog's one gate (#303): a crop of nothing would send an empty selection and the
 * API crops the whole set — a silently-changed scope at the exact moment the user believes
 * they narrowed it. Gated in the dialog, asserted here.
 */
describe("cropSelectionProblem", () => {
  it("blocks an empty selection", () => {
    expect(cropSelectionProblem(new Set())).not.toBeNull();
  });

  it("allows any non-empty one", () => {
    expect(cropSelectionProblem(new Set(["s3://b/a.png"]))).toBeNull();
  });
});
