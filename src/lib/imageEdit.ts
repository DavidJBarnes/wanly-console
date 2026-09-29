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
  Dataset, DetectedFace, EditAxis, EditPreset, FullEditBody, HeadAnglePreset, ImageEditFaces,
  ImageEditJob, ImageEditPreview,
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

// ------------------------------------------------------------------ head angle (#548)
//
// DEGREES IN THE IMAGE'S DIRECTIONS, shared by both engines: yaw < 0 turns the face toward the
// LEFT EDGE OF THE PICTURE (the viewer's left, the subject's right) -- what LivePortrait's
// rotate_yaw < 0 already did in phase 1 -- and pitch > 0 raises the chin. Within the face limit
// (±20°) the angle is a LivePortrait edit: instant, and the face is warped rather than redrawn.
// Beyond it only Qwen can invent the unseen side of the face, on the 3090, as a job.

export const FACE_LIMIT_DEG = 20;

/** "face" when LivePortrait can reach the angle, "full" when only Qwen can. */
export function routeAngle(yaw: number, pitch: number, limit = FACE_LIMIT_DEG): "face" | "full" {
  return Math.max(Math.abs(yaw), Math.abs(pitch)) <= limit ? "face" : "full";
}

/** A face-routed head angle as LivePortrait slider values over a neutral face. PITCH IS
 *  NEGATED: the node's rotate_pitch > 0 lowers the chin (checked on sel_008), a head angle's
 *  pitch > 0 raises it. */
export function faceValuesForAngle(
  axes: Pick<EditAxis, "key" | "min" | "max">[], yaw: number, pitch: number,
): EditValues {
  const out = neutralValues(axes);
  for (const a of axes) {
    if (a.key === "rotate_yaw") out[a.key] = clampToAxis(a, yaw);
    if (a.key === "rotate_pitch") out[a.key] = clampToAxis(a, pitch === 0 ? 0 : -pitch);
  }
  return out;
}

/** The preset these exact angles are, if any -- so a job is recorded (and its file named) as
 *  "profile_left" rather than a bare angle. */
export function headPresetFor(
  presets: HeadAnglePreset[], yaw: number, pitch: number,
): HeadAnglePreset | null {
  return presets.find((p) => p.yaw === yaw && p.pitch === pitch) ?? null;
}

/** The full-mode request for a head angle, or null when there is nothing to do. */
export function fullAngleBody(
  sourceUri: string, yaw: number, pitch: number, presets: HeadAnglePreset[] = [],
): FullEditBody | null {
  if (Math.max(Math.abs(yaw), Math.abs(pitch)) < 5) return null;
  const p = headPresetFor(presets, yaw, pitch);
  return p
    ? { source_uri: sourceUri, mode: "full", head_preset: p.name }
    : { source_uri: sourceUri, mode: "full", angle: { yaw, pitch } };
}

/** "Turn 45° left, tilt 20° up" — what the sliders say, in words. */
export function describeAngle(yaw: number, pitch: number): string {
  const parts: string[] = [];
  if (yaw) parts.push(`turn ${Math.abs(yaw)}° ${yaw < 0 ? "left" : "right"}`);
  if (pitch) parts.push(`tilt ${Math.abs(pitch)}° ${pitch > 0 ? "up" : "down"}`);
  const s = parts.join(", ") || "straight ahead";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function jobActive(job: Pick<ImageEditJob, "state"> | null | undefined): boolean {
  return Boolean(job) && job!.state !== "done" && job!.state !== "failed";
}

/** The status line for a job: the API's own reason while it waits ("3090.zero is rendering;
 *  edit queued ..."), with its place in the queue when others are ahead. */
export function jobStatusLine(job: Pick<ImageEditJob, "state" | "message" | "position" | "elapsed_s">): string {
  const ahead = job.position ? ` — ${job.position} edit${job.position === 1 ? "" : "s"} ahead` : "";
  const secs = job.elapsed_s != null ? ` (${Math.round(job.elapsed_s)} s)` : "";
  if (job.state === "done") return `Done${secs}`;
  if (job.state === "failed") return `Failed: ${job.message}`;
  if (job.state === "running") return `Editing on the 3090…${secs}`;
  return `${job.message}${ahead}${secs}`;
}

/** How far a full-mode result drifted from the source, as the dialog says it. AuraFace cosine;
 *  every recognizer loses similarity with pose, even for the same person, so a profile scoring
 *  low is expected -- the number is a warning light, the eye is the judge. */
export function identityVerdict(
  identity: ImageEditJob["identity"] | null | undefined,
): { text: string; severity: "success" | "warning" | "error" | "info" } {
  const aura = identity?.aura;
  if (aura == null) {
    return { text: `Identity not scored${identity?.reason ? `: ${identity.reason}` : ""}`, severity: "info" };
  }
  const n = aura.toFixed(2);
  if (aura >= 0.6) return { text: `Identity ${n} (AuraFace vs the original) — close`, severity: "success" };
  if (aura >= 0.4) {
    return { text: `Identity ${n} (AuraFace vs the original) — some drift; check by eye`, severity: "warning" };
  }
  return {
    text: `Identity ${n} (AuraFace vs the original) — far. Profiles score low even for the same `
      + "person; judge by eye before saving.",
    severity: "error",
  };
}

/** The warning full mode always carries (#548): Qwen regenerates the whole frame. */
export const FULL_MODE_WARNING = "Regenerates the image: may soften skin and look younger — "
  + "prefer Face mode for identity datasets. Runs on the 3090, which finishes any render in "
  + "progress first.";
