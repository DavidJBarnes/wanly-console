import { describe, expect, it } from "vitest";

import {
  applyProvenance, autoFillOf, describeFix, fixPatch, mismatchLabel, NO_AUTOFILL,
  provenanceHint, trainedValues, type LoraProvenance,
} from "./loraProvenance";

const prov = (p: Partial<LoraProvenance>): LoraProvenance => ({
  name: "x", trigger: null, gender: null, source: "none", run_id: null, run_character: null,
  run_version: null, run_date: null, detail: null, pair: false, ...p,
});

const payton = prov({
  name: "Payton-Synthetic_v1_final", trigger: "p@yton", gender: "woman", source: "training_run",
  run_id: "r1", run_character: "Payton-Synthetic", run_version: 1, run_date: "2026-09-12",
});
const david = prov({ trigger: "d@vid", gender: "man", source: "training_run" });
const pair = prov({ trigger: "d@vid, man and k3lly2026, woman", source: "training_run", pair: true });
const none = prov({ detail: "no training run" });

describe("applyProvenance (console#596)", () => {
  it("fills empty fields", () => {
    expect(applyProvenance({ trigger: "", gender: "" }, payton, NO_AUTOFILL))
      .toEqual({ trigger: "p@yton", gender: "woman" });
  });

  it("never overwrites what the user typed", () => {
    expect(applyProvenance({ trigger: "mine", gender: "person" }, payton, NO_AUTOFILL))
      .toEqual({});
  });

  it("fills one field and keeps the other typed one", () => {
    expect(applyProvenance({ trigger: "mine", gender: "" }, payton, NO_AUTOFILL))
      .toEqual({ gender: "woman" });
  });

  it("replaces the previous auto-fill when another LoRA is picked", () => {
    const last = autoFillOf(payton);
    expect(applyProvenance({ trigger: "p@yton", gender: "woman" }, david, last))
      .toEqual({ trigger: "d@vid", gender: "man" });
  });

  it("an auto-filled value the user then edited is theirs", () => {
    const last = autoFillOf(payton);
    expect(applyProvenance({ trigger: "p@yton2", gender: "woman" }, david, last))
      .toEqual({ gender: "man" });
  });

  it("a LoRA with no provenance clears only the previous auto-fill", () => {
    const last = autoFillOf(payton);
    expect(applyProvenance({ trigger: "p@yton", gender: "person" }, none, last))
      .toEqual({ trigger: "" });
    expect(applyProvenance({ trigger: "p@yton", gender: "woman" }, null, last))
      .toEqual({ trigger: "", gender: "" });
  });

  it("a pair fills the joined phrase and no gender", () => {
    expect(applyProvenance({ trigger: "", gender: "" }, pair, NO_AUTOFILL))
      .toEqual({ trigger: "d@vid, man and k3lly2026, woman" });
    expect(applyProvenance({ trigger: "d@vid", gender: "man" }, pair, autoFillOf(david)))
      .toEqual({ trigger: "d@vid, man and k3lly2026, woman", gender: "" });
  });

  it("a metadata answer without a gender leaves gender alone", () => {
    const meta = prov({ trigger: "ohwx", source: "lora_metadata" });
    expect(trainedValues(meta)).toEqual({ trigger: "ohwx" });
    expect(applyProvenance({ trigger: "", gender: "person" }, meta, NO_AUTOFILL))
      .toEqual({ trigger: "ohwx" });
  });
});

describe("provenanceHint", () => {
  it("names the run", () => {
    expect(provenanceHint(payton)).toBe("from training run Payton-Synthetic v1 (2026-09-12)");
  });
  it("names the metadata key", () => {
    expect(provenanceHint(prov({ trigger: "t", source: "lora_metadata", detail: "ss_dataset_dirs" })))
      .toBe("from LoRA metadata (ss_dataset_dirs)");
  });
  it("says when there is nothing", () => {
    expect(provenanceHint(none)).toMatch(/No training record/);
    expect(provenanceHint(null)).toBeNull();
  });
});

describe("mismatches", () => {
  const ms = [
    { field: "trigger" as const, stored: "payton", trained: "p@yton" },
    { field: "gender" as const, stored: "man", trained: "woman" },
  ];
  it("labels each badge", () => {
    expect(ms.map(mismatchLabel)).toEqual([
      "Trigger differs from training: p@yton", "Gender differs: woman"]);
  });
  it("builds the fix PATCH from the trained values", () => {
    expect(fixPatch(ms)).toEqual({ trigger: "p@yton", gender: "woman" });
    expect(fixPatch([{ field: "gender", stored: "man", trained: null }])).toEqual({ gender: null });
  });
  it("describes the fix for the confirm dialog", () => {
    expect(describeFix(ms)).toBe("trigger “payton” → “p@yton”, gender “man” → “woman”");
  });
});
