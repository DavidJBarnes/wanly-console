/**
 * The Image Edit dialog's rules, kept out of the component so they can be tested (#547).
 *
 * The dialog edits by NUMBERS: a preset is a starting point that moves the sliders, and a
 * drag afterwards changes one axis without losing the others. What is sent is only the axes
 * that are not zero, so the API's record of an edit reads as the edit.
 */
import type { Dataset, EditAxis, EditPreset, ImageEditPreview } from "../api/types";
import { lockedReason } from "./datasets";

export type EditValues = Record<string, number>;

/** Every axis at zero: the unedited face. */
export function neutralValues(axes: Pick<EditAxis, "key">[]): EditValues {
  return Object.fromEntries(axes.map((a) => [a.key, 0]));
}

/** A preset's values over a neutral face. Replaces, never adds: clicking "Smile" after
 *  "Look left" gives a smile, not a smiling sideways glance nobody asked for. */
export function applyPreset(axes: Pick<EditAxis, "key">[], preset: Pick<EditPreset, "expression">): EditValues {
  return { ...neutralValues(axes), ...preset.expression };
}

/** The axes that actually move — what the API receives and what the record shows. */
export function changedParams(values: EditValues): EditValues {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== 0 && Number.isFinite(v)));
}

export function hasEdit(values: EditValues): boolean {
  return Object.keys(changedParams(values)).length > 0;
}

/** Whether `values` is still exactly what `preset` set. Once a slider moves away from it the
 *  edit is no longer that preset, and saving it under the preset's name would mislabel it. */
export function matchesPreset(values: EditValues, preset: Pick<EditPreset, "expression"> | null): boolean {
  if (!preset) return false;
  const a = changedParams(values);
  const b = changedParams(preset.expression);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

/** Axes by where the dialog shows them. Unknown groups fall into "more" rather than vanishing. */
export function groupAxes<T extends Pick<EditAxis, "group">>(axes: T[]): { main: T[]; gaze: T[]; more: T[] } {
  const out = { main: [] as T[], gaze: [] as T[], more: [] as T[] };
  for (const a of axes) {
    if (a.group === "main") out.main.push(a);
    else if (a.group === "gaze") out.gaze.push(a);
    else out.more.push(a);
  }
  return out;
}

/** Keep a value on its axis: the API refuses out-of-range numbers rather than clamping. */
export function clampToAxis(axis: Pick<EditAxis, "min" | "max">, v: number): number {
  return Math.min(axis.max, Math.max(axis.min, v));
}

/** Why an edit cannot be saved to this dataset, or null when it can. A locked set (trained
 *  #356, or locked by hand #358) is refused by the API with a 409; the dialog says so first. */
export function datasetSaveProblem(ds: Dataset | null | undefined): string | null {
  if (!ds) return "Pick a dataset";
  return lockedReason(ds);
}

/** Datasets the picker offers, unlocked first. Locked ones stay in the list, disabled with
 *  their reason, so a missing set is not a mystery. */
export function datasetChoices(datasets: Dataset[]): { ds: Dataset; problem: string | null }[] {
  return datasets
    .map((ds) => ({ ds, problem: datasetSaveProblem(ds) }))
    .sort((a, b) => Number(Boolean(a.problem)) - Number(Boolean(b.problem))
      || a.ds.name.localeCompare(b.ds.name));
}

/** True for an image this tool made. Editing an edit re-decodes the face through LivePortrait's
 *  256 px stage again, and keyframe-server measured texture falling 100 -> 31 -> 9% over
 *  successive face passes: edit the original instead. */
export function isEditedImage(uri: string): boolean {
  const name = uri.split("/").pop() ?? "";
  return /_edit-[a-z0-9_]+_[0-9a-f]{6}\.png$/i.test(name);
}

/** "GPU · 1.2 s" or "CPU (Automatic1111 on this card is generating) · 9.4 s". The device is
 *  worth showing: a slow preview is otherwise indistinguishable from a hung one. */
export function describeRun(p: Pick<ImageEditPreview, "device" | "device_reason" | "elapsed_ms">): string {
  const secs = p.elapsed_ms != null ? ` · ${(p.elapsed_ms / 1000).toFixed(1)} s` : "";
  if (p.device === "cuda") return `GPU${secs}`;
  if (p.device === "cpu") return `CPU${p.device_reason ? ` (${p.device_reason})` : ""}${secs}`;
  return secs.replace(" · ", "");
}

/** The file name of a saved edit, for the confirmation line. */
export function savedName(uri: string): string {
  return uri.split("/").pop() ?? uri;
}
