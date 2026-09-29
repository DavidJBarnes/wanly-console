/**
 * The Image Edit dialog's rules, kept out of the component so they can be tested (#547).
 *
 * The dialog edits by NUMBERS: a preset is a starting point that moves the sliders, and a
 * drag afterwards changes one axis without losing the others. What is sent is only the axes
 * that are not zero, so the API's record of an edit reads as the edit.
 *
 * A DESCRIBED change (#550) is the other way in: the text goes to the API, the face-edit
 * service reads it against its keyword lexicon, and the preview comes back with the numbers it
 * resolved to. Those become the sliders, so a description is a starting point exactly like a
 * preset, and the understood terms become chips.
 *
 * WHICH FACE (#553): the service edits the face nearest the horizontal centre unless told
 * otherwise. With two or more faces the dialog draws them as numbered boxes and sends the
 * chosen one's box; with one or none it sends nothing and looks exactly as before.
 */
import type {
  Dataset, DetectedFace, EditAxis, EditPreset, ImageEditFaces, ImageEditPreview,
} from "../api/types";
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

/** The API's limit on a description (MAX_PROMPT in wanly-api app/face_edit.py). */
export const MAX_PROMPT = 500;

/** Why this description cannot be sent, or null when it can. */
export function promptProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return "Describe the change first — e.g. “big smile, eyes closed, look left”";
  if (t.length > MAX_PROMPT) return `Keep the description under ${MAX_PROMPT} characters`;
  return null;
}

/** The sliders after a described change: the service's resolved numbers over a neutral face,
 *  kept on each axis. Axes the dialog does not draw are ignored rather than added. */
export function valuesFromExpression(
  axes: Pick<EditAxis, "key" | "min" | "max">[],
  expression: Record<string, number> | null | undefined,
): EditValues {
  const out = neutralValues(axes);
  for (const a of axes) {
    const v = expression?.[a.key];
    if (typeof v === "number" && Number.isFinite(v)) out[a.key] = clampToAxis(a, v);
  }
  return out;
}

/** What the next preview sends. Only ever one of the two: the LATEST input wins — a slider
 *  released after a description previews the sliders, a description sent after a drag
 *  previews the description. */
export type PreviewRequest = { kind: "values"; values: EditValues } | { kind: "prompt"; text: string };

export function previewBody(
  sourceUri: string, req: PreviewRequest, choice: FaceChoice = {},
): { source_uri: string; mode: "face"; expression?: EditValues; prompt?: string } & FaceChoice | null {
  if (req.kind === "prompt") {
    const text = req.text.trim();
    return text ? { source_uri: sourceUri, mode: "face", prompt: text, ...choice } : null;
  }
  const params = changedParams(req.values);
  return Object.keys(params).length
    ? { source_uri: sourceUri, mode: "face", expression: params, ...choice }
    : null;
}

// ------------------------------------------------------------------ which face (#553)

/** What an edit sends to name its face: nothing, or the chosen face's box. */
export type FaceChoice = { face_box?: number[] };

/** The faces to draw as a picker: all of them when there are two or more, none otherwise —
 *  with one face there is nothing to choose, and the dialog stays as it was. */
export function pickerFaces(f: ImageEditFaces | null | undefined): DetectedFace[] {
  const faces = f?.faces ?? [];
  return faces.length >= 2 && f!.width > 0 && f!.height > 0 ? faces : [];
}

/** The face selected when the dialog opens: the one the service would edit unaided, so the
 *  picker starts out showing what today's behaviour does. */
export function initialFace(f: ImageEditFaces | null | undefined): number | null {
  const faces = pickerFaces(f);
  if (!faces.length) return null;
  const d = f!.default_index;
  return d != null && faces.some((x) => x.index === d) ? d : faces[0].index;
}

/** The request fields for the selected face. A box, not the index: it names the face by where
 *  it is, which the service matches against its own detection — an index is a position in a
 *  list. Empty when there is no picker, so the request is exactly today's. */
export function faceChoice(f: ImageEditFaces | null | undefined, selected: number | null): FaceChoice {
  const face = pickerFaces(f).find((x) => x.index === selected);
  return face ? { face_box: face.box } : {};
}

export interface OverlayBox { left: number; top: number; width: number; height: number }

/** A face box, measured in the source's pixels (`from`, the size the API reported), placed on
 *  the image as drawn (`to`, its rendered size in CSS pixels) plus that image's offset inside
 *  the pane. The API's size, not the file's: it is the upright size the boxes were measured
 *  against, which is also what the browser draws. */
export function scaleBox(
  box: number[],
  from: { width: number; height: number },
  to: { width: number; height: number },
  offset: { left: number; top: number } = { left: 0, top: 0 },
): OverlayBox {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  const [x1, y1, x2, y2] = box;
  return {
    left: offset.left + x1 * sx,
    top: offset.top + y1 * sy,
    width: (x2 - x1) * sx,
    height: (y2 - y1) * sy,
  };
}

/** The picker's hint line. Only one face is edited per pass, so the second person is a second
 *  pass on the saved result. */
export function faceHint(count: number): string {
  return `${count} faces found — click a box to choose which one to edit. To change another `
    + "face too, save, then edit the saved image.";
}

/** The API's 422 for a description with no word the lexicon knows ("nothing to apply: no
 *  known terms in '…'. Recognised terms: smile, grin, …"), reworded for the dialog; null for
 *  any other error, which is shown as it came. */
export function unknownTermsMessage(detail: string): string | null {
  if (!/no known terms/i.test(detail)) return null;
  const m = /Recognised terms:\s*(.+?)\.?\s*$/i.exec(detail);
  return "None of those words are ones the editor understands"
    + (m ? `. It knows: ${m[1]}.` : ". Try words like smile, frown, wink, look left, turn head right.");
}
