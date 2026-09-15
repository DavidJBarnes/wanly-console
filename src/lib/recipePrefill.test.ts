import { describe, expect, it } from "vitest";

import type { Pose } from "../api/ltx";
import type { LtxRecipeRef, SegmentResponse } from "../api/types";
import { seedRecipePrefill } from "./recipePrefill";

const pose = (id: string, name: string): Pose =>
  ({ id, name } as unknown as Pose);
const poses = [pose("p-missionary", "Missionary"), pose("p-bedroom", "Bedroom")];

const recipe: LtxRecipeRef = {
  recipe: "Missionary",
  character: "p@y",
  char_lora: "pay_v2_e05",
  char_s1: 0.8,
  char_s2: 1.5,
  frames: 241,
} as unknown as LtxRecipeRef;

/** A segment as the prefill reads it. The parent rebuilds this on every 5s poll, so the
 *  object identity changes while the recorded blob does not. */
const segment = (): SegmentResponse =>
  ({ id: "seg-0", index: 0, discarded: false, ltx_recipe: recipe } as unknown as SegmentResponse);

describe("seedRecipePrefill (console#514)", () => {
  it("resolves the recorded character and pose on the first seed", () => {
    const seeded = seedRecipePrefill(false, recipe, poses);
    expect(seeded).toEqual({ characterNames: ["p@y"], poseId: "p-missionary" });
  });

  it("seeds nothing on a second run, even from a new object identity", () => {
    // The bug: the poll handed the effect a new object; the old code re-ran the body
    // unconditionally, so it reseeded and the user's selection reverted.
    const first = seedRecipePrefill(false, segment().ltx_recipe, poses);
    expect(first).not.toBeNull();
    const second = seedRecipePrefill(true, segment().ltx_recipe, poses);
    expect(second).toBeNull();
  });

  it("the old unconditional body WOULD have reseeded — proving the test catches it", () => {
    // The pre-#514 body, verbatim: no `seeded` guard. Run it against the same second-poll
    // input and it returns a fresh selection, which is what stomped the user's choice.
    const oldBody = (ref: LtxRecipeRef | null | undefined, list: Pose[]) =>
      ref ? { poseId: list.find((p) => p.name === ref.recipe)?.id ?? "" } : null;
    expect(oldBody(segment().ltx_recipe, poses)).toEqual({ poseId: "p-missionary" });
    expect(seedRecipePrefill(true, segment().ltx_recipe, poses)).toBeNull();
  });

  it("falls back to the scalar character when the blob has no list", () => {
    const seeded = seedRecipePrefill(false, recipe, poses);
    expect(seeded?.characterNames).toEqual(["p@y"]);
  });

  it("resolves to an empty pose id when the recorded pose name is gone", () => {
    // Renamed/deleted pose: the caller falls back to the first pose. The point is it must
    // NOT throw or seed an arbitrary match.
    const seeded = seedRecipePrefill(false, recipe, [pose("p-kitchen", "Kitchen")]);
    expect(seeded?.poseId).toBe("");
  });

  it("seeds nothing when there is no recorded blob", () => {
    expect(seedRecipePrefill(false, null, poses)).toBeNull();
    expect(seedRecipePrefill(false, undefined, poses)).toBeNull();
  });
});
