// Job defaults
export const DEFAULT_WIDTH = 640;
export const DEFAULT_HEIGHT = 640;
export const DEFAULT_FPS = 60;
export const DEFAULT_DURATION = 5.0;
export const DEFAULT_SPEED = 1.0;

// Faceswap defaults
export const DEFAULT_FACESWAP_ENABLED = false;
export const DEFAULT_FACESWAP_SOURCE_TYPE = "preset" as const;
// FaceFusion selects the target face by MATCHING the source identity (face_selector_mode
// "reference"). ReActor selects by POSITION (faces index 0, left-right), so on a two-person
// frame it swaps whichever face is furthest left - frequently the wrong person - while still
// changing pixels, so it reports success. That is what made the seed re-anchor a measured
// no-op (+0.014 identity from a full swap). The validated recipe uses FaceFusion.
export const DEFAULT_FACESWAP_METHOD = "facefusion";
// Swapper model + pixel boost. inswapper_128 at 512x512 is the validated pair; measured
// identical to hyperswap_1c_256 at 256 on both identity (0.910 vs 0.908) and face detail
// (177.1 vs 176.5), and David preferred it visually on speckling.
export const DEFAULT_FACESWAP_MODEL = "inswapper_128";
export const DEFAULT_FACESWAP_PIXEL_BOOST = "512x512";
export const FACESWAP_MODELS = [
  "inswapper_128", "inswapper_128_fp16", "hyperswap_1a_256", "hyperswap_1b_256",
  "hyperswap_1c_256", "ghost_1_256", "ghost_2_256", "ghost_3_256",
  "hififace_unofficial_256", "blendswap_256", "simswap_256", "simswap_unofficial_512",
  "uniface_256",
] as const;
export const FACESWAP_PIXEL_BOOSTS = ["256x256", "512x512", "768x768", "1024x1024"] as const;
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
