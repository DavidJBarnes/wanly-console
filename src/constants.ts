// Job defaults
export const DEFAULT_WIDTH = 640;
export const DEFAULT_HEIGHT = 640;
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
