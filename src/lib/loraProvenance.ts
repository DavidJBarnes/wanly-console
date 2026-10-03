/**
 * How a character LoRA was trained, and what that means for the editor (console#596).
 *
 * Picking a LoRA fills Trigger and Gender from its provenance (the wanly training run that
 * wrote it, or the file's own metadata) -- but only into fields that are empty or still hold
 * the previous auto-fill. Something the user typed is never overwritten.
 */
import type { Gender } from "../api/types";

export interface LoraProvenance {
  name: string;
  trigger: string | null;
  gender: Gender | null;
  source: "training_run" | "lora_metadata" | "none";
  run_id: string | null;
  run_character: string | null;
  run_version: number | null;
  run_date: string | null;
  detail: string | null;
  /** A pair run: the trigger is the joined phrase and there is no single gender. */
  pair: boolean;
}

export interface ProvenanceMismatch {
  field: "trigger" | "gender";
  stored: string | null;
  trained: string | null;
}

export interface CharacterProvenance {
  id: string;
  name: string;
  char_lora: string;
  provenance: LoraProvenance;
  mismatches: ProvenanceMismatch[];
}

/** What the last auto-fill wrote, so the next one knows which values are still its own. */
export interface AutoFill {
  trigger: string | null;
  gender: string | null;
}

export const NO_AUTOFILL: AutoFill = { trigger: null, gender: null };

/** The fields provenance vouches for: gender only when known, or a pair (whose right gender
 *  is none). Mirrors the API's trained_values. */
export function trainedValues(p: LoraProvenance | null): Partial<Record<"trigger" | "gender", string>> {
  if (!p || p.source === "none" || !p.trigger) return {};
  const out: Partial<Record<"trigger" | "gender", string>> = { trigger: p.trigger };
  if (p.gender) out.gender = p.gender;
  else if (p.pair) out.gender = "";
  return out;
}

/** A field may be filled when it is empty or still holds exactly what the last fill wrote. */
function free(current: string, last: string | null): boolean {
  return current.trim() === "" || (last !== null && current === last);
}

/** The auto-fill record for a provenance: the values a fill from it writes. */
export function autoFillOf(prov: LoraProvenance | null): AutoFill {
  const want = trainedValues(prov);
  return { trigger: want.trigger ?? null, gender: want.gender ?? null };
}

/**
 * The form patch for a newly picked LoRA's provenance.
 *
 * `last` is the previous fill (autoFillOf of the previous LoRA). A field is written only when
 * it is empty or still holds exactly that previous fill: something the user typed is never
 * overwritten. Choosing "None", or a LoRA with no provenance, clears what the previous fill
 * wrote (it described another file) but nothing typed.
 */
export function applyProvenance(
  form: { trigger: string; gender: string },
  prov: LoraProvenance | null,
  last: AutoFill,
): { trigger?: string; gender?: "" | Gender } {
  const want = trainedValues(prov);
  const patch: { trigger?: string; gender?: "" | Gender } = {};
  if (free(form.trigger, last.trigger)) {
    patch.trigger = want.trigger ?? (form.trigger === last.trigger ? "" : form.trigger);
  }
  if (free(form.gender, last.gender)) {
    patch.gender = (want.gender ?? (form.gender === last.gender ? "" : form.gender)) as "" | Gender;
  }
  // Drop no-op writes so a re-render does not churn.
  if (patch.trigger === form.trigger) delete patch.trigger;
  if (patch.gender === form.gender) delete patch.gender;
  return patch;
}

/** "from training run Payton v1 (2026-09-12)", "from LoRA metadata (ss_dataset_dirs)", or why
 *  there is nothing. */
export function provenanceHint(p: LoraProvenance | null): string | null {
  if (!p) return null;
  if (p.source === "training_run") {
    const who = [p.run_character, p.run_version != null ? `v${p.run_version}` : null]
      .filter(Boolean).join(" ");
    return `from training run ${who}${p.run_date ? ` (${p.run_date})` : ""}`;
  }
  if (p.source === "lora_metadata") {
    return `from LoRA metadata${p.detail ? ` (${p.detail})` : ""}`;
  }
  return "No training record or caption metadata for this LoRA: type them.";
}

/** One badge per mismatch: "Trigger differs from training: p@yton". */
export function mismatchLabel(m: ProvenanceMismatch): string {
  if (m.field === "trigger") return `Trigger differs from training: ${m.trained ?? "none"}`;
  return `Gender differs: ${m.trained || "none (pair)"}`;
}

/** The PATCH body that writes the trained values for these mismatches. */
export function fixPatch(ms: readonly ProvenanceMismatch[]): { trigger?: string; gender?: Gender | null } {
  const out: { trigger?: string; gender?: Gender | null } = {};
  for (const m of ms) {
    if (m.field === "trigger" && m.trained) out.trigger = m.trained;
    if (m.field === "gender") out.gender = (m.trained || null) as Gender | null;
  }
  return out;
}

/** "trigger “payton” → “p@yton”, gender “man” → “woman”" for the confirm dialog. */
export function describeFix(ms: readonly ProvenanceMismatch[]): string {
  return ms.map((m) => `${m.field} “${m.stored ?? "none"}” → “${m.trained ?? "none"}”`)
    .join(", ");
}
