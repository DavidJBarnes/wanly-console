/**
 * Building a character sheet in the console (console#580, #585, epic #582) -- the pure half.
 *
 * The sheet is the 1536x1024 layout phase 0 proved: a 448 px REAL face panel beside a
 * 1088x1024 front / side / back turnaround from the official Qwen-Image-Edit-2511. Since #585
 * both come from ONE photo of her, face + body: the photo is the model's image 1, so her build
 * carries into all three views, and the face panel is auto-cropped from the same photo. (Qwen
 * ignored body words and a second body photo -- it keeps image 1 -- so there is no body
 * field.) The API runs it as a job on the image-edit
 * queue (it waits for a render to finish and never interrupts training), returns N candidates,
 * and saves the one approved as the character's sheet. Everything decided without the network
 * lives here so vitest can hold it: the form's rules, what is sent, what the status line
 * says, and where the "real" and "generated" labels sit on a sheet.
 */
import type { Gender } from "../api/types";
import type {
  SheetCandidate, SheetGender, SheetGenerateBody, SheetJob, SheetPresets,
} from "../api/ltx";

/** The layout, in the sheet's own pixels (wanly-gpu-docker image_edit/sheet.py). */
export const FACE_PANEL_W = 448;
export const TURNAROUND_W = 1088;
export const SHEET_W = FACE_PANEL_W + TURNAROUND_W;
export const SHEET_H = 1024;

export const DEFAULT_COUNT = 3;
export const MAX_COUNT = 6;

/** Shown beside the photo picker: the face panel is cut from this photo, so a small face is
 *  enlarged to fill it. */
export const PHOTO_HINT =
  "Use a photo where her face is reasonably large; a tiny face gives a soft face panel.";

/** A face panel enlarged more than this from the photo is called out as soft. */
export const SOFT_PANEL_SCALE = 1.5;

/** Used until the API's presets arrive (or if they cannot), and kept equal to the API's
 *  sheet_gen.DEFAULTS -- the test pins the shape, not the words. */
export const FALLBACK_PRESETS: SheetPresets = {
  defaults: {
    female: { outfit: "the same clothes and shoes that she wears in image 1",
              hair: "her hair exactly as in image 1" },
    male: { outfit: "the same clothes and shoes that he wears in image 1",
            hair: "his hair exactly as in image 1" },
  },
  default_count: DEFAULT_COUNT,
  max_count: MAX_COUNT,
  crop_padding: 140,
};

export interface SheetForm {
  /** The one photo of her, face + body. */
  photoUri: string;
  outfit: string;
  hair: string;
  gender: SheetGender;
  count: number;
}

/** The prompt's pronoun from the registry's gender: "man" is he, anything else she -- the
 *  recipe was written for women, and "person" has no pronoun the recipe can use. */
export function sheetGenderFor(g: Gender | null | undefined): SheetGender {
  return g === "man" ? "male" : "female";
}

/** A fresh form, pre-filled from the recipe's defaults for this pronoun. */
export function initialSheetForm(
  gender: Gender | null | undefined, presets: SheetPresets = FALLBACK_PRESETS,
): SheetForm {
  const g = sheetGenderFor(gender);
  const d = presets.defaults[g] ?? FALLBACK_PRESETS.defaults[g];
  return { photoUri: "", outfit: d.outfit, hair: d.hair, gender: g,
           count: presets.default_count || DEFAULT_COUNT };
}

/** Switching the pronoun re-fills outfit and hair only while they are still the OTHER
 *  pronoun's untouched defaults -- typed words are never overwritten. */
export function switchGender(form: SheetForm, to: SheetGender,
                             presets: SheetPresets = FALLBACK_PRESETS): SheetForm {
  if (to === form.gender) return form;
  const from = presets.defaults[form.gender] ?? FALLBACK_PRESETS.defaults[form.gender];
  const next = presets.defaults[to] ?? FALLBACK_PRESETS.defaults[to];
  return {
    ...form, gender: to,
    outfit: form.outfit === from.outfit ? next.outfit : form.outfit,
    hair: form.hair === from.hair ? next.hair : form.hair,
  };
}

/** Why the form cannot be sent yet, or null. */
export function sheetFormProblem(form: SheetForm): string | null {
  if (!form.photoUri) return "Choose a photo of her (face + body) from the Image Repo.";
  if (!form.outfit.trim()) return "Describe the outfit she wears in the photo.";
  if (form.outfit.length > 600) return "The outfit is too long (600 characters at most).";
  if (form.hair.length > 300) return "Hair is 300 characters at most.";
  if (!Number.isInteger(form.count) || form.count < 1 || form.count > MAX_COUNT) {
    return `Between 1 and ${MAX_COUNT} candidates.`;
  }
  return null;
}

/** What POST .../sheet/generate is sent: trimmed, blanks left out. */
export function sheetRequest(form: SheetForm): SheetGenerateBody {
  const out: SheetGenerateBody = {
    photo_uri: form.photoUri, outfit: form.outfit.trim(), gender: form.gender, count: form.count,
  };
  if (form.hair.trim()) out.hair = form.hair.trim();
  return out;
}

export function sheetJobActive(job: Pick<SheetJob, "state"> | null | undefined): boolean {
  return Boolean(job) && job!.state !== "done" && job!.state !== "failed";
}

/** The status line: the API's own reason while it waits (the 3090 rendering, training, an
 *  A1111 generating on the always-on box), its place in the queue, and progress once running. */
export function sheetJobLine(
  job: Pick<SheetJob, "state" | "message" | "position" | "elapsed_s" | "seeds" | "candidates">,
): string {
  const n = job.candidates.length;
  const total = job.seeds.length;
  const secs = job.elapsed_s != null ? ` (${formatElapsed(job.elapsed_s)})` : "";
  const ahead = job.position
    ? ` — ${job.position} job${job.position === 1 ? "" : "s"} ahead in the image-edit queue` : "";
  if (job.state === "done") return `${n} candidate${n === 1 ? "" : "s"} ready${secs}`;
  if (job.state === "failed") {
    return `Failed: ${job.message}${n ? ` — ${n} of ${total} candidates were made and are kept` : ""}`;
  }
  if (job.state === "running") return `${job.message}${secs}`;
  return `${job.message}${ahead}${secs}`;
}

export function formatElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m} min ${r} s` : `${r} s`;
}

/** The identity number under a candidate. AuraFace of the turnaround's largest face (the
 *  front view) against the face panel cropped from the photo -- a hint, not a verdict:
 *  full-body faces are small. */
export function candidateScore(c: Pick<SheetCandidate, "identity">): string {
  const a = c.identity?.aura;
  if (a == null) return c.identity?.reason ? `not scored: ${c.identity.reason}` : "not scored";
  return `AuraFace ${a.toFixed(2)} vs the face panel`;
}

/** The auto-cropped face panel to preview: it is the same for every seed of a job (same
 *  photo, same padding), so the first candidate that has one. */
export function facePanelPreview(
  job: Pick<SheetJob, "candidates"> | null | undefined,
): string | null {
  return job?.candidates.find((c) => c.face_panel_preview_uri)?.face_panel_preview_uri ?? null;
}

/** The seeds of this job already saved as the character's sheet. */
export function savedSeeds(job: Pick<SheetJob, "saved"> | null | undefined): Set<number> {
  return new Set((job?.saved ?? []).map((s) => s.seed));
}

export interface SheetPanel {
  kind: "real" | "generated";
  label: string;
  caption: string;
  /** Left edge and width as a percentage of the sheet's width, for an overlay. */
  leftPct: number;
  widthPct: number;
}

/** The four panels of a sheet, for the "REAL" / "GENERATED" overlay the builder draws on each
 *  candidate. Labels are drawn by the console, never burned in: the saved sheet is exactly
 *  what the engine conditions on. */
export function sheetPanels(): SheetPanel[] {
  const pct = (px: number) => (px / SHEET_W) * 100;
  const third = TURNAROUND_W / 3;
  const views = ["front", "side", "back"];
  return [
    { kind: "real", label: "REAL", caption: "face cropped from the photo", leftPct: 0,
      widthPct: pct(FACE_PANEL_W) },
    ...views.map((v, i) => ({
      kind: "generated" as const, label: "GENERATED", caption: `${v} (Qwen-Image-Edit-2511)`,
      leftPct: pct(FACE_PANEL_W + i * third), widthPct: pct(third),
    })),
  ];
}

/** A warning about the face panel, or null: a centred panel (the detector would not load) or
 *  a face enlarged enough from a small face in the photo to be soft. */
export function facePanelNote(
  c: Pick<SheetCandidate, "face_panel" | "face_panel_note" | "face_panel_crop">,
): string | null {
  if (c.face_panel === "centre") {
    return c.face_panel_note ?? "No face was detected: the face panel is a centred crop.";
  }
  const scale = c.face_panel_crop?.scale;
  if (scale != null && scale > SOFT_PANEL_SCALE) {
    return `Her face is small in this photo: the face panel is enlarged ${scale.toFixed(1)}× and `
      + "will be soft. A photo with a larger face gives a sharper panel.";
  }
  return null;
}

/** The localStorage key that lets a long job survive closing the dialog. */
export function resumeKey(characterId: string): string {
  return `wanly.sheetJob.${characterId}`;
}
