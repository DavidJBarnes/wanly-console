// Job size presets — all multiples of 16 (Wan VAE/patch constraint), Wan-friendly areas.
// Source image aspect should match the chosen preset so the start frame is neither
// cropped nor stretched. 832×1216 matches SDXL portrait output (pass-through).
export interface SizePreset {
  label: string;
  ratio: string;
  width: number;
  height: number;
}

export const SIZE_PRESETS: { portrait: SizePreset[]; landscape: SizePreset[] } = {
  portrait: [
    { label: "SDXL match", ratio: "2:3", width: 832, height: 1216 },
    { label: "Reels", ratio: "9:16", width: 720, height: 1280 },
    { label: "Light", ratio: "3:4", width: 768, height: 1024 },
  ],
  landscape: [
    { label: "Wide 3:2", ratio: "3:2", width: 1216, height: 832 },
    { label: "Widescreen", ratio: "16:9", width: 1280, height: 720 },
    { label: "Classic", ratio: "4:3", width: 1024, height: 768 },
  ],
};

// Pick the preset whose aspect is closest to the given image dimensions, matching
// orientation first (square → portrait). Used to auto-default output size from the
// start image so the frame is neither stretched nor cropped.
export function nearestSizePreset(width: number, height: number): SizePreset {
  const targetAspect = width / height;
  const pool = height >= width ? SIZE_PRESETS.portrait : SIZE_PRESETS.landscape;
  return pool.reduce((best, p) =>
    Math.abs(p.width / p.height - targetAspect) < Math.abs(best.width / best.height - targetAspect) ? p : best
  );
}

// Job defaults — SDXL-match portrait so SDXL 832×1216 starts flow through untouched.
export const DEFAULT_WIDTH = 832;
export const DEFAULT_HEIGHT = 1216;
export const DEFAULT_FPS = 60;
export const DEFAULT_DURATION = 5.0;
export const DEFAULT_SPEED = 1.0;

// Faceswap defaults
export const DEFAULT_FACESWAP_ENABLED = false;
export const DEFAULT_FACESWAP_SOURCE_TYPE = "preset" as const;
export const DEFAULT_FACESWAP_METHOD = "reactor";
export const DEFAULT_FACESWAP_FACES_INDEX = "0";
export const DEFAULT_FACESWAP_FACES_ORDER = "left-right";

// LoRA defaults
export const DEFAULT_LORA_WEIGHT = 1.0;
export const MAX_LORAS = 3;

// API defaults
export const DEFAULT_JOB_FETCH_LIMIT = 200;
export const LOCAL_STORAGE_TOKEN_KEY = "token";

// Polling intervals (ms)
export const POLL_INTERVAL_FAST = 5_000;
export const POLL_INTERVAL_SLOW = 10_000;
