/**
 * The Image Edit dialog's rules, kept out of the component so they can be tested (#547).
 *
 * QWEN FOR EVERYTHING (#569). LivePortrait "drops every detail", so every edit the dialog makes
 * is a Qwen-Image-Edit job: a head angle (preset or yaw/pitch), an expression preset and a
 * free-text description, any mix of the three, composed into ONE job. There is no instant
 * preview any more: a job is queued, waits for a GPU (and says why), runs, and comes back with
 * an AuraFace identity score against the original before anything is saved.
 *
 * WHICH FACE (#553): with two or more faces the dialog draws them as numbered boxes and sends
 * the chosen one's box; the service crops around that face, edits it alone and pastes it back,
 * so nobody else in the picture is regenerated. With one or none it sends nothing and the
 * whole frame is edited.
 */
import type {
  Dataset, DetectedFace, ExpressionPreset, FullEditBody, HeadAnglePreset, ImageEditFaces,
  ImageEditJob,
} from "../api/types";
import { lockedReason } from "./datasets";

/** Why an edit cannot be saved to this dataset, or null when it can. A read-only set (locked
 *  by hand #358, or archived #419) is refused by the API with a 409; the dialog says so first. */
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

/** True for an image this tool made. Every Qwen pass regenerates what it edits, and drift
 *  compounds (keyframe-server measured de-ageing and halved skin texture per pass): edit the
 *  original instead when you can. */
export function isEditedImage(uri: string): boolean {
  const name = uri.split("/").pop() ?? "";
  return /_edit-[a-z0-9_-]+_[0-9a-f]{6}\.png$/i.test(name);
}

/** The file name of a saved edit, for the confirmation line. */
export function savedName(uri: string): string {
  return uri.split("/").pop() ?? uri;
}

/** The API's limit on a free-text instruction (ImageEditRequest.instruction). */
export const MAX_INSTRUCTION = 2000;

/** Why this description cannot be sent, or null when it can (blank is fine: it is optional). */
export function instructionProblem(text: string): string | null {
  return text.trim().length > MAX_INSTRUCTION
    ? `Keep the description under ${MAX_INSTRUCTION} characters` : null;
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

/** The face selected when the dialog opens: the API's default (the largest face, or the
 *  centre-most one when the list came from the face-edit service). */
export function initialFace(f: ImageEditFaces | null | undefined): number | null {
  const faces = pickerFaces(f);
  if (!faces.length) return null;
  const d = f!.default_index;
  return d != null && faces.some((x) => x.index === d) ? d : faces[0].index;
}

/** The request fields for the selected face. A box, not the index: it names the face by where
 *  it is, and the service crops around it whichever detector drew it. Empty when there is no
 *  picker: the whole frame is edited. */
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

/** The picker's hint line. Only the chosen face is regenerated, so the second person is a
 *  second pass on the saved result. */
export function faceHint(count: number): string {
  return `${count} faces found — click a box to choose which one to edit. Only that face is `
    + "regenerated; the rest of the picture is kept. To change another face too, save, then "
    + "edit the saved image.";
}

// ------------------------------------------------------------------ the edit (#548, #569)
//
// DEGREES IN THE IMAGE'S DIRECTIONS: yaw < 0 turns the face toward the LEFT EDGE OF THE
// PICTURE (the viewer's left, the subject's right) and pitch > 0 raises the chin. Any size of
// turn, up to a full profile, is one Qwen job -- there is no LivePortrait route any more.

/** Below this a head angle is not a change (the API refuses it). */
export const MIN_ANGLE_DEG = 5;

/** What the user has asked for: an angle, an expression preset, a description, or a mix. */
export interface EditChoice {
  yaw: number;
  pitch: number;
  expression: string | null;
  text: string;
}

export const NO_EDIT: EditChoice = { yaw: 0, pitch: 0, expression: null, text: "" };

export function angleSet(yaw: number, pitch: number): boolean {
  return Math.max(Math.abs(yaw), Math.abs(pitch)) >= MIN_ANGLE_DEG;
}

/** The preset these exact angles are, if any -- so a job is recorded (and its file named) as
 *  "profile_left" rather than a bare angle. */
export function headPresetFor(
  presets: HeadAnglePreset[], yaw: number, pitch: number,
): HeadAnglePreset | null {
  return presets.find((p) => p.yaw === yaw && p.pitch === pitch) ?? null;
}

/** The job request for everything chosen, or null when there is nothing to do. The angle goes
 *  by preset name when it is exactly one, else as numbers; the expression as `preset`; the
 *  description as `instruction`; the chosen face as its box. */
export function editBody(
  sourceUri: string, c: EditChoice, presets: HeadAnglePreset[] = [], face: FaceChoice = {},
): FullEditBody | null {
  const body: FullEditBody = { source_uri: sourceUri, mode: "full" };
  if (angleSet(c.yaw, c.pitch)) {
    const p = headPresetFor(presets, c.yaw, c.pitch);
    if (p) body.head_preset = p.name;
    else body.angle = { yaw: c.yaw, pitch: c.pitch };
  }
  if (c.expression) body.preset = c.expression;
  const text = c.text.trim();
  if (text) body.instruction = text;
  if (!body.head_preset && !body.angle && !body.preset && !body.instruction) return null;
  return { ...body, ...face };
}

/** "Profile left · Smile · “red sweater”" — what Run will ask for, in words. */
export function describeEdit(
  c: EditChoice, presets: HeadAnglePreset[] = [], expressions: ExpressionPreset[] = [],
): string {
  const parts: string[] = [];
  if (angleSet(c.yaw, c.pitch)) {
    parts.push(headPresetFor(presets, c.yaw, c.pitch)?.label ?? describeAngle(c.yaw, c.pitch));
  }
  if (c.expression) parts.push(expressions.find((e) => e.name === c.expression)?.label ?? c.expression);
  const text = c.text.trim();
  if (text) parts.push(`“${text.length > 60 ? `${text.slice(0, 57)}…` : text}”`);
  return parts.join(" · ");
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
 *  edit queued ...", "second 3090 busy (A1111 generating); edit queued"), with its place in
 *  the queue when others are ahead, and the box it runs on once it runs (#570). */
export function jobStatusLine(
  job: Pick<ImageEditJob, "state" | "message" | "position" | "elapsed_s"> & Partial<Pick<ImageEditJob, "worker">>,
): string {
  const ahead = job.position ? ` — ${job.position} edit${job.position === 1 ? "" : "s"} ahead` : "";
  const secs = job.elapsed_s != null ? ` (${Math.round(job.elapsed_s)} s)` : "";
  if (job.state === "done") return `Done${secs}`;
  if (job.state === "failed") return `Failed: ${job.message}`;
  if (job.state === "running") return `Editing on ${job.worker ?? "the GPU"}…${secs}`;
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

/** Said once at the top of the dialog (#569): every edit is a Qwen regeneration now, so it is
 *  the dialog's premise rather than a warning on one mode. */
export const QWEN_NOTE = "Edits run on the official Qwen-Image-Edit-2511, which regenerates what it "
  + "edits — only the chosen face when there are several. Each result comes back with an identity "
  + "score against the original. An edit takes a few minutes (40 steps) and queues for a free GPU; "
  + "the original is never changed.";
