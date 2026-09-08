import { describe, it, expect } from "vitest";
import { withoutImage, removalWarning, MIN_TRAINABLE } from "./datasets";

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
