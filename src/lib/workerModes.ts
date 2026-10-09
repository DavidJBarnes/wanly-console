/**
 * The four modes a 3090 can be in (wanly-gpu-docker#164, wanly-console#589).
 *
 * A box is in ONE mode at a time -- render, train, motion or edit -- because each mode's model
 * fills most of a 24 GB card. Boxes report `mode_name` in this spelling and `mode` in the old
 * one (ltx-engine / caption); a box from before #164 has only the old one, and only accepts
 * the old names when asked to switch. Everything here reads both, so the page works against
 * either.
 */
import type { ModeWaiting, WorkerModeResponse } from "../api/types";

export const MODES = ["render", "train", "motion", "edit"] as const;
export type ModeName = (typeof MODES)[number];

const ALIASES: Record<string, ModeName> = {
  "ltx-engine": "render", engine: "render",
  caption: "motion", "image-description": "motion",
  training: "train", "lora-trainer": "train",
  "image-edit": "edit",
};

/** The old spelling, for a box that predates the four modes. */
const LEGACY: Partial<Record<ModeName, string>> = { render: "ltx-engine", motion: "caption" };

export const MODE_LABEL: Record<ModeName, string> = {
  render: "Render", train: "Train", motion: "Motion", edit: "Edit",
};

/** What each mode is for, for the button's tooltip. */
export const MODE_HELP: Record<ModeName, string> = {
  render: "Claims and renders segments (and, for now, training runs).",
  train: "Runs LoRA training only.",
  motion: "Writes motion captions (Qwen3-VL).",
  edit: "Runs image edits (Qwen-Image-Edit).",
};

export function canonicalMode(raw: string | null | undefined): ModeName | null {
  if (!raw) return null;
  const m = raw.trim().toLowerCase();
  const c = (ALIASES[m] ?? m) as ModeName;
  return (MODES as readonly string[]).includes(c) ? c : null;
}

/** The SERVICES group that makes each mode possible. */
const MODE_SERVICE: Record<ModeName, string> = {
  render: "ltx-engine", train: "lora-trainer", motion: "image-description", edit: "image-edit",
};

export interface ModeView {
  current: ModeName | null;
  pending: ModeName | null;
  /** The modes this box can enter. */
  available: ModeName[];
  /** True when the box speaks the four modes; false = send it the old names. */
  fourModes: boolean;
}

export function modeView(info: WorkerModeResponse): ModeView {
  const reported = (info.modes ?? []).map(canonicalMode).filter((m): m is ModeName => !!m);
  const fourModes = reported.length > 0;
  // An older box reports what it is EQUIPPED with instead; a mode is available when its
  // service is. Never train: before #164 there was no train mode, training rode along in
  // render, and such a box refuses the name.
  //
  // A four-mode box's `modes` is ALSO checked against `equipped`: a box can list a mode whose
  // service it does not run (3090b with SERVICES=image-edit,scene-caption lists motion;
  // wanly-gpu-docker#198), and a button for it would switch the box into a mode that does
  // nothing.
  const equipped = info.equipped ?? [];
  const available = fourModes
    ? MODES.filter((m) => reported.includes(m) && equipped.includes(MODE_SERVICE[m]))
    : MODES.filter((m) => m !== "train" && equipped.includes(MODE_SERVICE[m]));
  return {
    current: canonicalMode(info.mode_name) ?? canonicalMode(info.mode),
    pending: canonicalMode(info.pending_mode_name) ?? canonicalMode(info.pending_mode),
    available,
    fourModes,
  };
}

/** What to POST to switch: the four-mode name, or the old one for an older box. */
export function modeToSend(mode: ModeName, fourModes: boolean): string {
  return fourModes ? mode : (LEGACY[mode] ?? mode);
}

/** Is this box worth asking about its mode at all? Two or more mode services means there is
 *  something to switch between; a pure render pod or a captions-only box has one mode. */
export function hasSeveralModes(provides: readonly string[] | null | undefined): boolean {
  const services = new Set(provides ?? []);
  return MODES.filter((m) => services.has(MODE_SERVICE[m])).length >= 2;
}

/** "finishing segment, then motion" while a render is in flight; else "switching to motion". */
export function describePending(pending: ModeName, rendering: boolean): string {
  return rendering
    ? `finishing segment, then ${pending}`
    : `switching to ${pending}`;
}

const gb = (mib: number) => (mib / 1024).toFixed(1);

/** "VRAM 23.1 / 24.0 GB", or null when the box does not say. */
export function describeVram(gpu: WorkerModeResponse["gpu"]): string | null {
  if (!gpu || gpu.vram_used_mib == null || gpu.vram_total_mib == null) return null;
  return `VRAM ${gb(gpu.vram_used_mib)} / ${gb(gpu.vram_total_mib)} GB`;
}

/** "Last switch render → train: 22.6 → 0.4 GB in 6 s", or a refusal in words. */
export function describeUnload(u: WorkerModeResponse["last_unload"]): string | null {
  if (!u || !u.from || !u.to) return null;
  const from = canonicalMode(u.from) ?? u.from;
  const to = canonicalMode(u.to) ?? u.to;
  if (u.found_mib == null || u.after_mib == null) {
    return `Last switch ${from} → ${to}: card not read (unload not verified)`;
  }
  const took = u.seconds != null ? ` in ${Math.round(u.seconds)} s` : "";
  const line = `Last switch ${from} → ${to}: ${gb(u.found_mib)} → ${gb(u.after_mib)} GB${took}`;
  return u.ok === false
    ? `${line} — over the ${gb(u.limit_mib ?? 0)} GB limit, switch refused`
    : line;
}

const LINKS: Record<string, string> = {
  render: "/jobs", motion: "/images", edit: "/images", train: "/datasets",
};

export interface SummaryPart {
  mode: string;
  text: string;
  /** Where the count's queue is. */
  to: string;
  /** Set when the work cannot move. */
  reason: string | null;
}

const UNIT_ONE: Record<string, string> = {
  segments: "segment", captions: "caption", edits: "edit", runs: "run",
};

/** The per-mode summary's parts: "render: 4 segments", "motion: 12 captions" (with the reason
 *  beside it when nothing serves the mode). Modes with nothing waiting are left out. */
export function summaryParts(waiting: readonly ModeWaiting[]): SummaryPart[] {
  return waiting
    .filter((w) => w.count > 0)
    .map((w) => ({
      mode: w.mode,
      text: `${w.mode}: ${w.count} ${w.count === 1 ? (UNIT_ONE[w.unit] ?? w.unit) : w.unit}`,
      to: LINKS[w.mode] ?? "/workers",
      reason: w.reason,
    }));
}

/** "scene captions: 3" / "scene captions → fallback" (the scene service is down). */
export function describeScene(scene: { depth?: number | null; up?: boolean | null } | null | undefined):
  string | null {
  if (!scene) return null;
  if (scene.up === false) return "scene captions → fallback (scene service down)";
  if (scene.depth) return `scene captions: ${scene.depth}`;
  return null;
}
