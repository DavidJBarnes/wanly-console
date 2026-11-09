import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Slider,
  TextField,
  Typography,
} from "@mui/material";
import * as THREE from "three";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { getFileUrl, uploadFile } from "../api/client";
import {
  ANCHORS,
  buildTriangles,
  featherAlpha,
  fitSimilarity,
  frameAttributes,
  TOTAL_VERTICES,
} from "../lib/faceMask";
import { LOCAL_STORAGE_TOKEN_KEY } from "../constants";
import {
  applyMat4,
  centerJitter,
  eyeLineDepth,
  landmarkInHead,
  LM,
  MARKERS,
  QUEST_3S_CAMERAS,
  sampleFromLandmarks,
  streamIntrinsics,
  triangulate,
} from "../lib/faceSpike";
import type { FaceSample, Pt3, Vec3 } from "../lib/faceSpike";

// AR face-replacement feasibility spike (console#730).
//
// Run 1 answered the go/no-go (the camera keeps running inside immersive-ar and faces are found).
// Runs 1-3 then failed to place anything on the face because the page was GUESSING the camera
// model and later trying to infer it from head motion. It no longer guesses: the passthrough
// cameras' factory calibration (read off the headset with `adb shell dumpsys media.camera`)
// lives in lib/faceSpike.ts and is applied exactly as Meta's own sample does. Nothing to
// calibrate: start the camera, enter AR, look at the face.
//
// Run 4 (factory model, one camera) landed the dots "just to the left": right ray, wrong
// distance, because the distance came from assuming a 9.5 cm eye span. So both room-facing
// cameras now run, and each landmark is TRIANGULATED from the pair — the distance is measured.
// Browser "camera 1"/"camera 2" are Camera2 devices 50/51 (left/right): confirmed with
// `dumpsys media.camera` ("Device 1 maps to 50", "Device 2 maps to 51", and the browser's
// connect log). If the second camera can't be opened, it falls back to the eye-span distance.
//
// console#739: once locked, a generated face loop (Kelly-2026, cut and pre-stabilised offline by
// make_face_loop.py) replaces the dots. The mesh SHAPE comes from the clip frame by frame so the
// mouth really opens; one similarity transform, fitted at lock from stereo-measured
// expression-free anchors, places it on the mannequin. See lib/faceMask.ts.
//
// Reports upload themselves (POST /upload → s3://wanly-jobs/uploads/face-spike-*.json), because
// copying text out of a headset is not a workflow.

// Pinned to the npm dependency so the JS and the wasm can never disagree.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const PARAMS_KEY = "wanly.faceSpike.v2";
const LOCK_SECONDS = 1.0;
const LOCK_MIN_SAMPLES = 8;
const NUDGE_M_PER_S = 0.05;
const POSE_HISTORY_MS = 500;
// Left/right detections are paired only if they ran this close together (ms). The two cameras
// are not frame-synchronised; with the head still, a few tens of ms is harmless.
const STEREO_PAIR_MS = 80;
// Run 6 trace (mannequin, 79 stereo samples): placement error was 1.4 cm median with the head
// still and up to ~8 cm (p90) when turning faster than 40°/s; a few pairs had 2-3 cm ray gaps
// (mismatched frames). The fitted head↔camera correction was noise, so the model stays as is and
// the lock just refuses bad evidence: only steady-head samples, only well-matched pairs, median.
const LOCK_MAX_TURN_DEG_PER_S = 15;
const LOCK_MAX_RAY_GAP_M = 0.005;
// Used only when the browser gives no frame capture time. Runs 2 and 3 independently measured
// ~100 ms between capture and display on this headset.
const FALLBACK_LATENCY_MS = 100;

interface Params {
  eyeSpanCm: number; // fallback distance only (single camera): adult outer-eye-corner span
  faceLoop: FaceLoopId;
}

const DEFAULT_PARAMS: Params = { eyeSpanCm: 9.5, faceLoop: "ltx-calm" };

function loadParams(): Params {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (raw) {
      const p = { ...DEFAULT_PARAMS, ...(JSON.parse(raw) as Partial<Params>) };
      // A saved loop that no longer exists (the removed portrait-animation loops) → default.
      if (!FACE_ASSETS.some((a) => a.id === p.faceLoop)) p.faceLoop = DEFAULT_PARAMS.faceLoop;
      return p;
    }
  } catch {
    /* private mode / blocked storage — defaults are fine */
  }
  return DEFAULT_PARAMS;
}

function saveParams(p: Params) {
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function loggedIn(): boolean {
  try {
    return !!localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  } catch {
    return false;
  }
}

type State = "idle" | "searching" | "locking" | "locked";

/** Mutable, per-frame numbers. Lives in a ref; the React state copy is refreshed at ~4 Hz. */
interface Stats {
  videoW: number;
  videoH: number;
  detectFps: number;
  detectMs: number;
  faceFound: boolean;
  landmarks: number;
  state: State;
  stereo: string; // "on", or why it is off
  depthSource: "stereo" | "eye span" | "";
  rayGapMm: number | null; // left/right ray miss distance at the nose — match quality
  measuredEyeSpanCm: number | null; // triangulated outer-eye-corner span — sanity check
  latencySource: "captureTime" | "fallback";
  latencyMs: number | null;
  jitterCm: number | null;
  imgJitterPx: number | null;
  depthM: number | null;
  nudgeCm: { x: number; y: number; z: number };
  xrStarted: boolean;
  xrFrames: number;
  xrDetections: number;
  locks: number;
  faceFitMm: number | null; // RMS of the clip→mannequin anchor fit
  xrFps: number; // render-loop rate; the display wants 72
  lockWaiting: string; // why the current lock is not collecting ("" when it is)
  /** Raw measurements for offline diagnosis (run 5: placement depended on head direction). */
  trace: TraceSample[];
}

/**
 * One stereo measurement of the (static) face. The face does not move, so every sample should
 * give the same world points; how they move with head yaw/pitch and with the assumed latency
 * identifies which head↔camera assumption is wrong. Poses are logged at several lags so the
 * capture-to-pose latency can be solved for offline.
 */
interface TraceSample {
  t: number;
  poses: number[][]; // viewer matrices at TRACE_LAGS_MS before t
  head: number[][]; // triangulated head-frame points: right iris, left iris, nose
  imgR: number[][]; // right-camera normalised image points, same landmarks
  imgL: number[][]; // left-camera
}
const TRACE_LAGS_MS = [0, 33, 66, 100, 133, 166, 200];
const TRACE_EVERY_MS = 150;
const TRACE_MAX = 800;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

const freshStats = (): Stats => ({
  videoW: 0,
  videoH: 0,
  detectFps: 0,
  detectMs: 0,
  faceFound: false,
  landmarks: 0,
  state: "idle",
  stereo: "not started",
  depthSource: "",
  rayGapMm: null,
  measuredEyeSpanCm: null,
  latencySource: "fallback",
  latencyMs: null,
  jitterCm: null,
  imgJitterPx: null,
  depthM: null,
  nudgeCm: { x: 0, y: 0, z: 0 },
  xrStarted: false,
  xrFrames: 0,
  xrDetections: 0,
  locks: 0,
  faceFitMm: null,
  xrFps: 0,
  lockWaiting: "",
  trace: [],
});

interface Detection {
  sample: FaceSample | null;
  lm: Pt3[] | null;
  /** performance.now() time the frame was captured, when the browser says. */
  captureTime: number | null;
  /** performance.now() when the detection ran (pairs left with right). */
  at: number;
}

/**
 * Face loops to choose from, all prepared by tools/ar-face/make_face_loop.py. Hard-coded until
 * Character Face Loops (#742) gives them a home in the api.
 * - calm / smile: calm-prompt LTX render (job 465275c6) from a close-up real photo (real_034,
 *   face ~650 px), Prompt recipe, Kelly-2026 LoRA only. Expression travel 3.2 mm; 768² texture.
 * - neutral / brows: same recipe, job 185c719e (neutral face, slow blinks, eyebrow raise), 4.1 mm.
 * - laugh: cut from an LTX render (job a442cfd8, 6-9 s) — expressive but the jaw moves ~13 mm.
 */
const FACE_ASSETS = [
  { id: "ltx-calm", label: "Kelly-2026 — calm smile + blinks", base: "s3://wanly-jobs/ar-face/kelly-2026/465275c6-calm-v1" },
  { id: "ltx-smile", label: "Kelly-2026 — smile appears + fades", base: "s3://wanly-jobs/ar-face/kelly-2026/465275c6-smile-v1" },
  { id: "ltx-neutral", label: "Kelly-2026 — neutral + blinks", base: "s3://wanly-jobs/ar-face/kelly-2026/185c719e-neutral-v1" },
  { id: "ltx-brows", label: "Kelly-2026 — eyebrow raise", base: "s3://wanly-jobs/ar-face/kelly-2026/185c719e-brows-v1" },
  { id: "ltx-laugh", label: "Kelly-2026 — laugh (LTX clip)", base: "s3://wanly-jobs/ar-face/kelly-2026/a442cfd8-6-9-v2" },
] as const;
type FaceLoopId = (typeof FACE_ASSETS)[number]["id"];

interface FaceAsset {
  fps: number;
  frames: number;
  positions: Float32Array; // frames × 468 × 3, px, pre-stabilised
  uvs: Float32Array; // frames × 468 × 2
  video: HTMLVideoElement;
}

const RIGHT = QUEST_3S_CAMERAS.right;
const LEFT = QUEST_3S_CAMERAS.left;

/** Landmarks used in stereo: the three dots plus the outer eye corners (for the span check). */
const STEREO_IDS = [MARKERS.rightIris, MARKERS.leftIris, MARKERS.noseTip, LM.rightEyeOuter, LM.leftEyeOuter];

/**
 * Head-frame positions of STEREO_IDS by triangulating the right and left detections. Null if
 * any landmark fails (a mismatched pair). Also reports match quality and the measured eye span.
 */
function stereoPoints(
  right: Pt3[],
  left: Pt3[],
  w: number,
  h: number,
): { pts: Vec3[]; gapM: number; eyeSpanM: number } | null {
  const kR = streamIntrinsics(RIGHT, w, h);
  const kL = streamIntrinsics(LEFT, w, h);
  const pts: Vec3[] = [];
  let gap = 0;
  for (const id of STEREO_IDS) {
    const r = right[id];
    const l = left[id];
    if (!r || !l) return null;
    const t = triangulate(l, LEFT, kL, r, RIGHT, kR);
    if (!t) return null;
    pts.push(t.point);
    gap = Math.max(gap, t.gapM);
  }
  const [, , , a, b] = pts;
  return { pts: pts.slice(0, 3), gapM: gap, eyeSpanM: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) };
}

/** World-placement anchors (ANCHORS) triangulated from a right/left pair, head frame. */
function stereoAnchors(right: Pt3[], left: Pt3[], w: number, h: number): Vec3[] | null {
  const kR = streamIntrinsics(RIGHT, w, h);
  const kL = streamIntrinsics(LEFT, w, h);
  const out: Vec3[] = [];
  for (const id of ANCHORS) {
    const r = right[id];
    const l = left[id];
    if (!r || !l) return null;
    const t = triangulate(l, LEFT, kL, r, RIGHT, kR);
    if (!t || t.gapM > LOCK_MAX_RAY_GAP_M * 2) return null;
    out.push(t.point);
  }
  return out;
}

export default function FaceSpike() {
  const [params, setParams] = useState<Params>(loadParams);
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
    saveParams(params);
  }, [params]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const statsRef = useRef<Stats>(freshStats());
  const sessionRef = useRef<XRSession | null>(null);
  // Second (left) camera for stereo depth.
  const videoLRef = useRef<HTMLVideoElement>(null);
  const landmarkerLRef = useRef<FaceLandmarker | null>(null);
  const streamLRef = useRef<MediaStream | null>(null);
  const lastLeftRef = useRef<{ lm: Pt3[]; at: number } | null>(null);
  const leftVideoTimeRef = useRef(-1);
  // Detection-rate bookkeeping shared by the flat and XR loops.
  const rateRef = useRef({ windowStart: 0, count: 0, msAcc: 0, lastVideoTime: -1 });
  // Latest frame metadata from requestVideoFrameCallback: the true capture time of the frame.
  const frameMetaRef = useRef<{ mediaTime: number; captureTime: number | null } | null>(null);

  const [stats, setStats] = useState<Stats>(freshStats());
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [camError, setCamError] = useState<string | null>(null);
  const [mpStatus, setMpStatus] = useState<string>("not loaded");
  const xr = (navigator as unknown as { xr?: XRSystem }).xr;
  const [arSupported, setArSupported] = useState<boolean | null>(xr ? null : false);
  const [inAr, setInAr] = useState(false);
  const [arError, setArError] = useState<string | null>(null);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [isLoggedIn] = useState(loggedIn);
  const faceRef = useRef<FaceAsset | null>(null);
  const [faceStatus, setFaceStatus] = useState("loading…");

  // Load the face loop: header, shape/UV binary, and the video (texture). crossOrigin before
  // src so the S3 fetch is CORS-mode and WebGL may sample it (same as HologramPlayer).
  useEffect(() => {
    if (!loggedIn()) {
      setFaceStatus("needs login");
      return;
    }
    let cancelled = false;
    const asset = FACE_ASSETS.find((a) => a.id === params.faceLoop) ?? FACE_ASSETS[0];
    (async () => {
      try {
        faceRef.current = null;
        const meta = await (await fetch(getFileUrl(`${asset.base}/face.json`))).json();
        const buf = await (await fetch(getFileUrl(`${asset.base}/face.bin`))).arrayBuffer();
        const n = meta.frames * meta.vertices;
        const video = document.createElement("video");
        video.crossOrigin = "anonymous";
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.src = getFileUrl(`${asset.base}/loop.mp4`);
        if (cancelled) return;
        faceRef.current = {
          fps: meta.fps,
          frames: meta.frames,
          positions: new Float32Array(buf, 0, n * 3),
          uvs: new Float32Array(buf, n * 3 * 4, n * 2),
          video,
        };
        setFaceStatus(`${asset.label} ready (${meta.frames} frames, ${(meta.frames / meta.fps).toFixed(1)} s loop)`);
      } catch (e) {
        if (!cancelled) setFaceStatus(`failed: ${String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.faceLoop]);

  useEffect(() => {
    if (!xr) return;
    xr.isSessionSupported("immersive-ar").then(setArSupported, () => setArSupported(false));
  }, [xr]);

  // Mirror the ref to state a few times a second — enough for a readout, cheap for React.
  useEffect(() => {
    const id = window.setInterval(() => setStats({ ...statsRef.current }), 250);
    return () => window.clearInterval(id);
  }, []);

  const currentLabel = devices.find((d) => d.deviceId === deviceId)?.label ?? "";

  const buildReport = useCallback(
    (reason: string) => ({
      ticket: "console#730",
      reason,
      at: new Date().toISOString(),
      userAgent: navigator.userAgent,
      arSupported,
      camError,
      camera: currentLabel,
      cameras: devices.map((d) => d.label),
      mediapipe: mpStatus,
      params: paramsRef.current,
      stats: statsRef.current,
    }),
    [arSupported, camError, currentLabel, devices, mpStatus],
  );

  /** Upload a report to S3 via the api. Never throws; reports where it landed. */
  const sendReport = useCallback(
    async (reason: string) => {
      // Without a token the api 401s, and the client's 401 handler navigates to /login — which
      // would tear down a live AR session. Skip instead.
      if (!loggedIn()) {
        setReportStatus("not saved — log in to the console first");
        return;
      }
      try {
        const name = `face-spike-${new Date().toISOString().replace(/[:.]/g, "-")}-${reason}.json`;
        const body = JSON.stringify(buildReport(reason), null, 2);
        await uploadFile(new File([body], name, { type: "application/json" }));
        setReportStatus(`saved (${reason}) at ${new Date().toLocaleTimeString()}`);
      } catch (e) {
        setReportStatus(`save failed: ${String(e)}`);
      }
    },
    [buildReport],
  );
  const sendReportRef = useRef(sendReport);
  useEffect(() => {
    sendReportRef.current = sendReport;
  }, [sendReport]);

  const loadLandmarker = useCallback(async () => {
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    landmarkerLRef.current?.close();
    landmarkerLRef.current = null;
    setMpStatus("loading…");
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    const make = (d: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: d },
        runningMode: "VIDEO",
        numFaces: 1,
      });
    // One instance per camera: VIDEO mode needs monotonic timestamps per stream.
    try {
      landmarkerRef.current = await make("GPU");
      landmarkerLRef.current = await make("GPU");
      setMpStatus("ready (GPU ×2)");
    } catch (e) {
      // The GPU delegate needs its own WebGL2 context; fall back rather than dead-end.
      landmarkerRef.current ??= await make("CPU");
      landmarkerLRef.current = await make("CPU");
      setMpStatus(`ready (CPU — GPU failed: ${String(e)})`);
    }
  }, []);

  /** Run one detection if the video has a new frame. Shared by the flat preview and XR loops. */
  const detectOnce = useCallback((): Detection | null => {
    const video = videoRef.current;
    const lmk = landmarkerRef.current;
    if (!video || !lmk || video.readyState < 2) return null;
    const r = rateRef.current;
    if (video.currentTime === r.lastVideoTime) return null;
    r.lastVideoTime = video.currentTime;
    const meta = frameMetaRef.current;
    // Only trust the capture time if it belongs to (about) the frame we are about to read.
    const captureTime =
      meta && meta.captureTime != null && Math.abs(meta.mediaTime - video.currentTime) < 0.05
        ? meta.captureTime
        : null;

    const t0 = performance.now();
    const res = lmk.detectForVideo(video, t0);
    const t1 = performance.now();

    const s = statsRef.current;
    s.videoW = video.videoWidth;
    s.videoH = video.videoHeight;
    r.count += 1;
    r.msAcc += t1 - t0;
    if (t1 - r.windowStart >= 1000) {
      s.detectFps = (r.count * 1000) / (t1 - r.windowStart);
      s.detectMs = r.count ? r.msAcc / r.count : 0;
      r.windowStart = t1;
      r.count = 0;
      r.msAcc = 0;
    }
    const lm = (res.faceLandmarks[0] as Pt3[] | undefined) ?? null;
    s.faceFound = !!lm;
    s.landmarks = lm?.length ?? 0;
    if (!lm) return { sample: null, lm: null, captureTime, at: t1 };
    return { sample: sampleFromLandmarks(lm, video.videoWidth / video.videoHeight), lm, captureTime, at: t1 };
  }, []);

  /** Left-camera detection on a new frame; keeps the latest face in lastLeftRef. */
  const detectLeft = useCallback(() => {
    const video = videoLRef.current;
    const lmk = landmarkerLRef.current;
    if (!video || !lmk || video.readyState < 2 || video.currentTime === leftVideoTimeRef.current) return;
    leftVideoTimeRef.current = video.currentTime;
    const res = lmk.detectForVideo(video, performance.now());
    const lm = (res.faceLandmarks[0] as Pt3[] | undefined) ?? null;
    lastLeftRef.current = lm ? { lm, at: performance.now() } : null;
  }, []);

  /** Stereo points for a right-camera detection, if a fresh left detection pairs with it. */
  const pairStereo = useCallback((out: Detection) => {
    const left = lastLeftRef.current;
    const s = statsRef.current;
    if (!out.lm || !left || Math.abs(left.at - out.at) > STEREO_PAIR_MS || !s.videoW) return null;
    const st0 = stereoPoints(out.lm, left.lm, s.videoW, s.videoH);
    const st = st0 && { ...st0, left: left.lm };
    if (st) {
      s.rayGapMm = st.gapM * 1000;
      s.measuredEyeSpanCm = st.eyeSpanM * 100;
      s.depthM = -st.pts[2].z;
    }
    return st;
  }, []);

  // Flat-page preview loop: detect + draw landmarks. Paused while in AR (the XR loop owns it).
  useEffect(() => {
    if (inAr) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      detectLeft();
      const out = detectOnce();
      if (out?.lm) pairStereo(out);
      const cv = canvasRef.current;
      const video = videoRef.current;
      if (!out || !cv || !video) return;
      if (cv.width !== video.videoWidth) cv.width = video.videoWidth;
      if (cv.height !== video.videoHeight) cv.height = video.videoHeight;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (out.lm) drawLandmarks(ctx, out.lm, cv.width, cv.height);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inAr, detectOnce, detectLeft, pairStereo]);

  const startCamera = useCallback(
    async (id?: string) => {
      setCamError(null);
      const open = async (devId?: string) => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const video: MediaTrackConstraints = {
          width: { ideal: 1280 },
          height: { ideal: 960 },
          ...(devId ? { deviceId: { exact: devId } } : { facingMode: "environment" }),
        };
        const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        streamRef.current = stream;
        const el = videoRef.current!;
        el.srcObject = stream;
        await el.play();
        // Track each frame's capture time so the pose used is the head pose AT capture, not now.
        const v = el as HTMLVideoElement & {
          requestVideoFrameCallback?: (
            cb: (now: number, m: { mediaTime: number; captureTime?: number }) => void,
          ) => number;
        };
        if (v.requestVideoFrameCallback) {
          const onFrame = (_: number, m: { mediaTime: number; captureTime?: number }) => {
            frameMetaRef.current = { mediaTime: m.mediaTime, captureTime: m.captureTime ?? null };
            if (streamRef.current === stream) v.requestVideoFrameCallback!(onFrame);
          };
          v.requestVideoFrameCallback(onFrame);
        }
        return stream.getVideoTracks()[0]?.getSettings().deviceId ?? devId ?? "";
      };
      try {
        let active = await open(id);
        const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        // Quest lists a "facing front" camera that does not look out into the room (run 1 picked
        // it by hand). Hide it whenever a room-facing one exists.
        const outward = all.filter((d) => !/facing front/i.test(d.label));
        const usable = outward.length ? outward : all;
        setDevices(usable);
        // The main (right) camera must be "camera 2" (Camera2 51): the model below assumes it.
        const rightDev = usable.find((d) => /camera 2\b/i.test(d.label));
        if (rightDev && rightDev.deviceId !== active) active = await open(rightDev.deviceId);
        else if (!usable.some((d) => d.deviceId === active) && usable[0]) active = await open(usable[0].deviceId);
        setDeviceId(active);
        if (!landmarkerRef.current) await loadLandmarker();

        // Second camera ("camera 1" = Camera2 50, left) for stereo depth.
        streamLRef.current?.getTracks().forEach((t) => t.stop());
        streamLRef.current = null;
        lastLeftRef.current = null;
        const leftDev = usable.find((d) => /camera 1\b/i.test(d.label));
        if (!leftDev) {
          statsRef.current.stereo = "off: no camera 1 listed";
        } else {
          try {
            const sL = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: leftDev.deviceId }, width: { ideal: 1280 }, height: { ideal: 960 } },
              audio: false,
            });
            streamLRef.current = sL;
            const elL = videoLRef.current!;
            elL.srcObject = sL;
            await elL.play();
            statsRef.current.stereo = "on";
          } catch (e) {
            statsRef.current.stereo = `off: ${(e as Error).name}: ${(e as Error).message}`;
          }
        }
      } catch (e) {
        setCamError(`${(e as Error).name ?? "Error"}: ${(e as Error).message ?? String(e)}`);
      }
    },
    [loadLandmarker],
  );

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamLRef.current?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
      landmarkerLRef.current?.close();
      sessionRef.current?.end().catch(() => {});
    },
    [],
  );

  const enterAr = useCallback(async () => {
    if (!xr) return;
    setArError(null);
    // Start the face loop inside the click gesture; autoplay rules would block it later.
    faceRef.current?.video.play().catch(() => {});
    try {
      const session = await runArSession(xr, {
        face: faceRef.current,
        detectOnce,
        detectLeft,
        pairStereo,
        statsRef,
        video: videoRef.current!,
        getEyeSpanM: () => paramsRef.current.eyeSpanCm / 100,
        onLocked: () => sendReportRef.current("locked"),
      });
      sessionRef.current = session;
      setInAr(true);
      session.addEventListener("end", () => {
        sessionRef.current = null;
        setInAr(false);
        sendReportRef.current("session-end");
      });
    } catch (e) {
      setArError(String(e));
    }
  }, [xr, detectOnce, detectLeft, pairStereo]);

  const camOk = stats.videoW > 0;

  return (
    <Box sx={{ p: 2, maxWidth: 960, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, mb: 1 }}>
        <Typography variant="h5">AR face spike</Typography>
        <Button component={RouterLink} to="/settings" size="small">
          Back to settings
        </Button>
      </Box>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          How to use it
        </Typography>
        <Typography component="ol" variant="body2" sx={{ pl: 2.5, m: 0, "& li": { mb: 0.5 } }}>
          <li>Press <b>Start camera</b>. Check that it says <b>face yes</b>.</li>
          <li>Press <b>Enter AR</b>. Stand about a metre from the face and look at it.</li>
          <li>Hold still for a second: the chosen face loop appears on it and starts playing.</li>
          <li>
            After a second, three dots appear: green on each eye, yellow on the tip of the nose.
            Are they on the eyes and nose? If not, which way are they off?
          </li>
          <li>
            Keep the face in view and slowly turn your head left and right, and up and down, for
            about 20 seconds. Then leave AR. (This records what the page needs to fix the
            placement; there is nothing to judge.)
          </li>
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Trigger: place the dots again. A/X button: show or hide the camera view. Reports save
          themselves. There is nothing to calibrate or measure.
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          <Button variant="contained" onClick={() => startCamera(deviceId || undefined)}>
            {camOk ? "Restart camera" : "1. Start camera"}
          </Button>
          {devices.length > 0 && (
            <TextField
              select
              size="small"
              label="Camera"
              value={deviceId}
              onChange={(e) => startCamera(e.target.value)}
              sx={{ minWidth: 240 }}
            >
              {devices.map((d, i) => (
                <MenuItem key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `camera ${i}`}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Button
            variant="contained"
            color="secondary"
            disabled={!camOk || !arSupported || inAr}
            onClick={enterAr}
          >
            2. Enter AR
          </Button>
          <TextField
            select
            size="small"
            label="Face loop"
            value={params.faceLoop}
            disabled={inAr}
            onChange={(e) => setParams((p) => ({ ...p, faceLoop: e.target.value as FaceLoopId }))}
            sx={{ minWidth: 300 }}
          >
            {FACE_ASSETS.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.label}
              </MenuItem>
            ))}
          </TextField>
          <Button onClick={() => sendReport("manual")}>Save report</Button>
        </Box>
        {!isLoggedIn && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            Not logged in on this browser, so reports can't be saved. Log in to the console first.
          </Alert>
        )}
        {camError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            Camera: {camError}
          </Alert>
        )}
        {arError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            AR: {arError}
          </Alert>
        )}
        {arSupported === false && (
          <Alert severity="info" sx={{ mt: 1 }}>
            immersive-ar is not supported in this browser. The camera and detection test still works.
          </Alert>
        )}
        <Typography variant="body2" sx={{ mt: 1, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          {[
            `camera    ${camOk ? `${stats.videoW}×${stats.videoH}` : "—"}  ${currentLabel || ""}`,
            `stereo    ${stats.stereo}`,
            `depth     ${stats.depthM != null ? `${stats.depthM.toFixed(2)} m` : "—"}${stats.measuredEyeSpanCm != null ? `  (measured eye span ${stats.measuredEyeSpanCm.toFixed(1)} cm, ray gap ${stats.rayGapMm?.toFixed(1)} mm)` : ""}`,
            `mediapipe ${mpStatus}`,
            `detect    ${stats.detectFps.toFixed(1)} fps, ${stats.detectMs.toFixed(1)} ms`,
            `face      ${stats.faceFound ? `yes (${stats.landmarks} landmarks)` : "no"}`,
            `xr        ${inAr ? `in session, ${stats.state}` : stats.xrStarted ? `ended — ${stats.xrFrames} frames, ${stats.xrDetections} detections, ${stats.locks} locks` : "—"}`,
            `latency   ${stats.latencyMs != null ? `${stats.latencyMs.toFixed(0)} ms (${stats.latencySource})` : "—"}`,
            `face loop ${faceStatus}`,
            `report    ${reportStatus ?? "—"}`,
          ].join("\n")}
        </Typography>
      </Paper>

      <Box sx={{ position: "relative", width: "100%", mb: 2, bgcolor: "black", lineHeight: 0 }}>
        <video ref={videoRef} playsInline muted style={{ width: "100%", display: "block" }} />
        {/* Left camera: decoded, not shown. Kept 1px rather than display:none so it keeps playing. */}
        <video
          ref={videoLRef}
          playsInline
          muted
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        />
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Fallback setting
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Typography variant="body2" sx={{ width: 260, flexShrink: 0 }}>
            Face eye span (outer corners): {params.eyeSpanCm} cm
          </Typography>
          <Slider
            size="small"
            min={6}
            max={14}
            step={0.1}
            value={params.eyeSpanCm}
            onChange={(_, v) => setParams((p) => ({ ...p, eyeSpanCm: v as number }))}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Used only if the second camera can't be opened (no stereo). With stereo the distance
          is measured.
        </Typography>
      </Paper>
    </Box>
  );
}

function drawLandmarks(ctx: CanvasRenderingContext2D, lm: Pt3[], w: number, h: number) {
  ctx.fillStyle = "rgba(0,229,255,0.8)";
  for (const p of lm) ctx.fillRect(p.x * w - 1, p.y * h - 1, 2, 2);
  ctx.fillStyle = "#ff2bd6";
  for (const i of Object.values(MARKERS)) {
    const p = lm[i];
    if (p) ctx.fillRect(p.x * w - 4, p.y * h - 4, 8, 8);
  }
}

// ---------------------------------------------------------------------------------------------
// The XR session. Plain three.js, outside React: it runs at display rate and must not re-render.

interface SessionDeps {
  face: FaceAsset | null;
  detectOnce: () => Detection | null;
  detectLeft: () => void;
  pairStereo: (out: Detection) => { pts: Vec3[]; gapM: number; eyeSpanM: number; left: Pt3[] } | null;
  statsRef: { current: Stats };
  video: HTMLVideoElement;
  getEyeSpanM: () => number;
  onLocked: () => void;
}

/** A canvas texture on a plane, repositioned in front of the viewer each frame. */
function makePanel(w: number, h: number, widthM: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(widthM, (widthM * h) / w),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  mesh.renderOrder = 10;
  return { canvas, tex, mesh, ctx: canvas.getContext("2d") };
}

async function runArSession(xr: XRSystem, deps: SessionDeps): Promise<XRSession> {
  const { face, detectOnce, detectLeft, pairStereo, statsRef, video, getEyeSpanM, onLocked } = deps;
  const stats = statsRef.current;
  Object.assign(stats, { ...freshStats(), xrStarted: true, state: "searching", stereo: stats.stereo });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:-1";
  host.appendChild(renderer.domElement);
  document.body.appendChild(host);

  // The lock result: a dot on each iris and one on the nose tip — a yes/no question to judge.
  const dotGeo = new THREE.SphereGeometry(0.006, 16, 12);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x39ff14, depthTest: false });
  const noseMat = new THREE.MeshBasicMaterial({ color: 0xffd600, depthTest: false });
  const dotMeshes = [new THREE.Mesh(dotGeo, eyeMat), new THREE.Mesh(dotGeo, eyeMat), new THREE.Mesh(dotGeo, noseMat)];
  const dots = new THREE.Group();
  for (const m of dotMeshes) {
    m.renderOrder = 5;
    dots.add(m);
  }
  dots.visible = false;
  scene.add(dots);

  // The face mask: shape + UVs per clip frame, placed by one similarity transform at lock.
  const faceGeo = new THREE.BufferGeometry();
  const facePos = new Float32Array(TOTAL_VERTICES * 3);
  const faceUv = new Float32Array(TOTAL_VERTICES * 2);
  const faceTris = buildTriangles(FaceLandmarker.FACE_LANDMARKS_TESSELATION);
  faceGeo.setAttribute("position", new THREE.BufferAttribute(facePos, 3));
  faceGeo.setAttribute("uv", new THREE.BufferAttribute(faceUv, 2));
  faceGeo.setAttribute("alpha", new THREE.BufferAttribute(featherAlpha(faceTris, 3), 1));
  faceGeo.setIndex(faceTris);
  const faceTex = face ? new THREE.VideoTexture(face.video) : null;
  if (faceTex) faceTex.colorSpace = THREE.SRGBColorSpace;
  const faceMesh = new THREE.Mesh(
    faceGeo,
    new THREE.ShaderMaterial({
      uniforms: { map: { value: faceTex } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vUv = uv;
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vec3 c = texture2D(map, vUv).rgb;
          gl_FragColor = vec4(c * vAlpha, vAlpha); // premultiplied
        }`,
      transparent: true,
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
    }),
  );
  faceMesh.matrixAutoUpdate = false;
  faceMesh.frustumCulled = false; // positions change every frame; skip stale bounds
  faceMesh.visible = false;
  scene.add(faceMesh);
  let faceFrame = -1;
  const MARKER_IDS = [MARKERS.rightIris, MARKERS.leftIris, MARKERS.noseTip];

  const hud = makePanel(640, 300, 0.34);
  scene.add(hud.mesh);
  // What the camera sees, with the landmarks: makes a wrong camera obvious at a glance.
  const camView = makePanel(320, 240, 0.24);
  scene.add(camView.mesh);
  let camViewOn = true;

  let lastHud = 0;
  const drawHud = () => {
    const ctx = hud.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, 640, 300);
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, 640, 300);
    ctx.font = "bold 30px sans-serif";
    ctx.fillStyle = "#ffd54f";
    const headline: Record<State, string> = {
      idle: "",
      searching: stats.faceFound ? "Face found…" : "Look at the face",
      locking: stats.lockWaiting ? `Hold still… (${stats.lockWaiting})` : "Hold still…",
      locked: stats.faceFitMm != null ? `Face on (fit ${stats.faceFitMm.toFixed(0)} mm)` : "Dots on eyes + nose?",
    };
    ctx.fillText(headline[stats.state], 18, 42);
    ctx.font = "24px monospace";
    ctx.fillStyle = "#fff";
    const n = stats.nudgeCm;
    const lines = [
      `render ${stats.xrFps.toFixed(0)} fps  detect ${stats.state === "locked" ? "off (locked)" : `${stats.detectFps.toFixed(0)} fps`}`,
      `stereo ${stats.stereo === "on" ? "ON" : "OFF"}  depth ${stats.depthM?.toFixed(2) ?? "-"} m (${stats.depthSource || "-"})`,
      `face ${stats.faceFound ? "YES" : "no"}  eye span ${stats.measuredEyeSpanCm?.toFixed(1) ?? "-"} cm  gap ${stats.rayGapMm?.toFixed(0) ?? "-"} mm`,
      `jitter ${stats.jitterCm?.toFixed(1) ?? "-"} cm  nudge ${n.x.toFixed(1)} ${n.y.toFixed(1)} ${n.z.toFixed(1)}`,
      `trigger=place again  A/X=camera view  rec ${stats.trace.length}`,
    ];
    lines.forEach((l, i) => ctx.fillText(l, 18, 84 + i * 40));
    hud.tex.needsUpdate = true;
  };

  const session = await xr.requestSession("immersive-ar", { requiredFeatures: ["local-floor"] });
  await renderer.xr.setSession(session);

  // Head-pose history, so each detection is placed using the pose at the moment its frame was
  // captured rather than the (later) moment it was processed.
  const history: { t: number; m: number[] }[] = [];
  const poseAt = (t: number): number[] | null => {
    let best: { t: number; m: number[] } | null = null;
    for (const h of history) if (!best || Math.abs(h.t - t) < Math.abs(best.t - t)) best = h;
    return best?.m ?? null;
  };

  let phaseStart = 0;
  let lockSamples: { pts: THREE.Vector3[]; anchors: THREE.Vector3[] | null; sample: FaceSample }[] = [];
  /** Head turn rate (°/s) from the pose history, at time t. */
  const turnRate = (t: number): number => {
    const a = poseAt(t);
    const b = poseAt(t - 33);
    if (!a || !b) return 0;
    // Angle between the two rotations: trace(Aᵀ·B) of the 3×3 parts (column-major).
    let tr = 0;
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) tr += a[c * 4 + r] * b[c * 4 + r];
    const ang = Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2)));
    return ((ang * 180) / Math.PI) / 0.033;
  };
  const beginLock = () => {
    stats.state = "searching";
    phaseStart = 0;
    lockSamples = [];
    stats.nudgeCm = { x: 0, y: 0, z: 0 };
    dots.visible = false;
    faceMesh.visible = false;
  };
  session.addEventListener("select", beginLock);
  session.addEventListener("squeeze", beginLock);

  const viewer = new THREE.Matrix4();
  const viewerPos = new THREE.Vector3();
  const v = new THREE.Vector3();
  let lastT = 0;
  let lastToggle = false;
  let lastTrace = 0;
  let fpsStart = 0;
  let fpsCount = 0;

  renderer.setAnimationLoop((t: number, frame?: XRFrame) => {
    const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 1 / 72;
    lastT = t;
    stats.xrFrames += 1;
    fpsCount += 1;
    if (t - fpsStart >= 1000) {
      stats.xrFps = (fpsCount * 1000) / (t - fpsStart);
      fpsStart = t;
      fpsCount = 0;
    }
    const ref = renderer.xr.getReferenceSpace();
    const pose = frame && ref ? frame.getViewerPose(ref) : null;
    if (pose) {
      const now = Array.from(pose.transform.matrix);
      history.push({ t, m: now });
      while (history.length && t - history[0].t > POSE_HISTORY_MS) history.shift();
      viewer.fromArray(now);
      viewerPos.setFromMatrixPosition(viewer);

      // A/X toggles the camera view (edge-triggered).
      let toggle = false;
      for (const src of session.inputSources) if (src.gamepad?.buttons[4]?.pressed) toggle = true;
      if (toggle && !lastToggle) camViewOn = !camViewOn;
      lastToggle = toggle;

      // Once locked, the mannequin does not move, so stop detecting. Two MediaPipe runs per
      // frame held the XR loop to ~25-30 fps (xrDetections == xrFrames in every report) against
      // the display's 72; the compositor's reprojection of the missing frames is the jitter and
      // jumping seen when moving. Locked = render only. The trigger resumes detection.
      const tracking = stats.state !== "locked";
      if (tracking) detectLeft();
      const out = tracking ? detectOnce() : null;
      if (out) {
        stats.xrDetections += 1;
        if (camViewOn && camView.ctx) {
          camView.ctx.drawImage(video, 0, 0, 320, 240);
          if (out.lm) drawLandmarks(camView.ctx, out.lm, 320, 240);
          camView.tex.needsUpdate = true;
        }
      }

      if (out?.sample && out.lm && stats.videoW > 0) {
        const k = streamIntrinsics(RIGHT, stats.videoW, stats.videoH);
        const eyeSpanM = getEyeSpanM();
        const stereo = pairStereo(out);
        let poseTime: number;
        if (out.captureTime != null && t - out.captureTime >= 0 && t - out.captureTime < POSE_HISTORY_MS) {
          poseTime = out.captureTime;
          stats.latencySource = "captureTime";
        } else {
          poseTime = t - FALLBACK_LATENCY_MS;
          stats.latencySource = "fallback";
        }
        stats.latencyMs = t - poseTime;
        const headPose = poseAt(poseTime) ?? now;

        if (stereo && t - lastTrace >= TRACE_EVERY_MS && stats.trace.length < TRACE_MAX) {
          lastTrace = t;
          const ids = [MARKERS.rightIris, MARKERS.leftIris, MARKERS.noseTip];
          stats.trace.push({
            t: Math.round(t),
            poses: TRACE_LAGS_MS.map((ms) => (poseAt(t - ms) ?? now).map(r4)),
            head: stereo.pts.map((q) => [r4(q.x), r4(q.y), r4(q.z)]),
            imgR: ids.map((id) => [r4(out.lm![id].x), r4(out.lm![id].y)]),
            imgL: ids.map((id) => [r4(stereo.left[id].x), r4(stereo.left[id].y)]),
          });
        }

        if (stats.state === "searching") {
          stats.state = "locking";
          phaseStart = t;
        }
        if (stats.state === "locking") {
          const lm = out.lm;
          let heads: Vec3[] = [];
          if (stereo) {
            heads = stereo.pts; // measured distance
            stats.depthSource = "stereo";
          } else if (stats.stereo !== "on") {
            // No second camera: fall back to the eye-span distance.
            const eyeLineZ = ((lm[LM.rightEyeOuter]?.z ?? 0) + (lm[LM.leftEyeOuter]?.z ?? 0)) / 2;
            for (const id of MARKER_IDS) {
              const pt = lm[id];
              const head = pt && landmarkInHead(pt, eyeLineZ, out.sample, RIGHT, k, eyeSpanM);
              if (!head) break;
              heads.push(head);
            }
            stats.depthM = eyeLineDepth(out.sample, k, eyeSpanM);
            stats.depthSource = "eye span";
          }
          // (Stereo on but this frame unpaired: skip it rather than mix in a guessed distance.)
          // Steady head and a well-matched pair only — see LOCK_MAX_* above.
          const steady = turnRate(poseTime) <= LOCK_MAX_TURN_DEG_PER_S;
          const matched = !stereo || stereo.gapM <= LOCK_MAX_RAY_GAP_M;
          stats.lockWaiting = !steady ? "hold head still" : !matched ? "bad camera match" : "";
          if (heads.length === MARKER_IDS.length && steady && matched) {
            const toWorld = (hp: Vec3) => {
              const w = applyMat4(headPose, hp);
              return new THREE.Vector3(w.x, w.y, w.z);
            };
            const anc = stereo ? stereoAnchors(lm, stereo.left, stats.videoW, stats.videoH) : null;
            lockSamples.push({ pts: heads.map(toWorld), anchors: anc && anc.map(toWorld), sample: out.sample });
          }
        }
      }

      if (
        stats.state === "locking" &&
        (t - phaseStart) / 1000 >= LOCK_SECONDS &&
        lockSamples.length >= LOCK_MIN_SAMPLES
      ) {
        // Per-coordinate median: one stray sample cannot drag the dots.
        const med = (xs: number[]) => {
          const a = [...xs].sort((p, q) => p - q);
          const m = a.length >> 1;
          return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
        };
        const means = MARKER_IDS.map((_, i) =>
          new THREE.Vector3(
            med(lockSamples.map((x) => x.pts[i].x)),
            med(lockSamples.map((x) => x.pts[i].y)),
            med(lockSamples.map((x) => x.pts[i].z)),
          ),
        );
        let spread = 0;
        for (const smp of lockSamples) spread += smp.pts[2].distanceToSquared(means[2]);
        stats.jitterCm = Math.sqrt(spread / lockSamples.length) * 100;
        stats.imgJitterPx = centerJitter(lockSamples.map((x) => x.sample)) * stats.videoW;
        // The group sits at the nose and faces the viewer, so the thumbstick nudge moves all
        // three dots together in a frame that makes sense to the person nudging.
        dots.position.copy(means[2]);
        dots.lookAt(viewerPos);
        dots.updateMatrixWorld(true);
        means.forEach((m, i) => dotMeshes[i].position.copy(dots.worldToLocal(m.clone())));
        // Face mask: fit the clip's frame-0 anchors onto the mannequin's measured anchors.
        const withAnchors = lockSamples.filter((x) => x.anchors);
        faceMesh.visible = false;
        if (face && withAnchors.length >= LOCK_MIN_SAMPLES / 2) {
          const dst = ANCHORS.map((_, i) => ({
            x: med(withAnchors.map((x) => x.anchors![i].x)),
            y: med(withAnchors.map((x) => x.anchors![i].y)),
            z: med(withAnchors.map((x) => x.anchors![i].z)),
          }));
          const src = ANCHORS.map((id) => ({
            x: face.positions[id * 3],
            y: face.positions[id * 3 + 1],
            z: face.positions[id * 3 + 2],
          }));
          const f = fitSimilarity(src, dst);
          const r = f.rotation;
          const sc = f.scale;
          faceMesh.matrix.set(
            sc * r[0], sc * r[1], sc * r[2], f.translation.x,
            sc * r[3], sc * r[4], sc * r[5], f.translation.y,
            sc * r[6], sc * r[7], sc * r[8], f.translation.z,
            0, 0, 0, 1,
          );
          faceMesh.matrixWorldNeedsUpdate = true;
          faceMesh.visible = true;
          stats.faceFitMm = f.rmsM * 1000;
        } else {
          stats.faceFitMm = null;
        }
        // Dots only when there is no face to show (no asset, or no stereo anchors).
        dots.visible = !faceMesh.visible;
        stats.state = "locked";
        stats.locks += 1;
        onLocked();
      }

      // Thumbstick nudge, in the dots' own frame. Left: x/y. Right: toward/away. The total nudge
      // is the residual error — the number to report if the dots are off.
      if (stats.state === "locked") {
        for (const src of session.inputSources) {
          const ax = src.gamepad?.axes;
          if (!ax || ax.length < 4) continue;
          const sx = Math.abs(ax[2]) > 0.15 ? ax[2] : 0;
          const sy = Math.abs(ax[3]) > 0.15 ? ax[3] : 0;
          const step = NUDGE_M_PER_S * dt;
          if (src.handedness === "left") {
            dots.translateX(sx * step);
            dots.translateY(-sy * step);
            stats.nudgeCm.x += sx * step * 100;
            stats.nudgeCm.y += -sy * step * 100;
          } else if (src.handedness === "right") {
            dots.translateZ(sy * step); // push forward = farther (+z faces the viewer)
            stats.nudgeCm.z += -sy * step * 100;
          }
        }
      }

      // HUD below the gaze; camera view below-left. Both face the viewer.
      v.set(0.02, -0.24, -0.6).applyMatrix4(viewer);
      hud.mesh.position.copy(v);
      hud.mesh.lookAt(viewerPos);
      camView.mesh.visible = camViewOn;
      v.set(-0.3, -0.24, -0.6).applyMatrix4(viewer);
      camView.mesh.position.copy(v);
      camView.mesh.lookAt(viewerPos);
      if (t - lastHud > 250) {
        lastHud = t;
        drawHud();
      }
    }
    if (face && faceMesh.visible) {
      const fi = Math.floor(face.video.currentTime * face.fps) % face.frames;
      if (fi !== faceFrame) {
        faceFrame = fi;
        frameAttributes(face.positions, face.uvs, fi, facePos, faceUv);
        faceGeo.attributes.position.needsUpdate = true;
        faceGeo.attributes.uv.needsUpdate = true;
      }
    }
    renderer.render(scene, camera);
  });

  session.addEventListener("end", () => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    face?.video.pause();
    host.remove();
    stats.state = "idle";
  });

  return session;
}
