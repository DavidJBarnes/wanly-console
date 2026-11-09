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
import { uploadFile } from "../api/client";
import { LOCAL_STORAGE_TOKEN_KEY } from "../constants";
import {
  applyMat4,
  centerJitter,
  eyeLineDepth,
  landmarkInHead,
  LM,
  MARKERS,
  profileForLabel,
  sampleFromLandmarks,
  streamIntrinsics,
} from "../lib/faceSpike";
import type { CameraProfile, FaceSample, Pt3 } from "../lib/faceSpike";

// AR face-replacement feasibility spike (console#730).
//
// Run 1 answered the go/no-go (the camera keeps running inside immersive-ar and faces are found).
// Runs 1-3 then failed to place anything on the face because the page was GUESSING the camera
// model and later trying to infer it from head motion. It no longer guesses: the passthrough
// cameras' factory calibration (read off the headset with `adb shell dumpsys media.camera`)
// lives in lib/faceSpike.ts and is applied exactly as Meta's own sample does. Nothing to
// calibrate: start the camera, enter AR, look at the face.
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
const POSE_HISTORY_MS = 400;
// Used only when the browser gives no frame capture time. Runs 2 and 3 independently measured
// ~100 ms between capture and display on this headset.
const FALLBACK_LATENCY_MS = 100;

type LensChoice = "auto" | "left" | "right";

interface Params {
  eyeSpanCm: number; // outer eye corner to outer eye corner; ~9.5 cm on an adult face
  lens: LensChoice;
}

const DEFAULT_PARAMS: Params = { eyeSpanCm: 9.5, lens: "auto" };

function loadParams(): Params {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (raw) return { ...DEFAULT_PARAMS, ...(JSON.parse(raw) as Partial<Params>) };
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
  lens: string;
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
}

const freshStats = (): Stats => ({
  videoW: 0,
  videoH: 0,
  detectFps: 0,
  detectMs: 0,
  faceFound: false,
  landmarks: 0,
  state: "idle",
  lens: "",
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
});

interface Detection {
  sample: FaceSample | null;
  lm: Pt3[] | null;
  /** performance.now() time the frame was captured, when the browser says. */
  captureTime: number | null;
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
  const labelRef = useRef("");
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
  useEffect(() => {
    labelRef.current = currentLabel;
  }, [currentLabel]);
  const profile = profileForLabel(currentLabel, params.lens === "auto" ? null : params.lens);

  const buildReport = useCallback(
    (reason: string) => ({
      ticket: "console#730",
      reason,
      at: new Date().toISOString(),
      userAgent: navigator.userAgent,
      arSupported,
      camError,
      camera: labelRef.current,
      cameras: devices.map((d) => d.label),
      mediapipe: mpStatus,
      params: paramsRef.current,
      profile: profileForLabel(labelRef.current, paramsRef.current.lens === "auto" ? null : paramsRef.current.lens),
      stats: statsRef.current,
    }),
    [arSupported, camError, devices, mpStatus],
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
    setMpStatus("loading…");
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    const make = (d: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: d },
        runningMode: "VIDEO",
        numFaces: 1,
      });
    try {
      landmarkerRef.current = await make("GPU");
      setMpStatus("ready (GPU)");
    } catch (e) {
      // The GPU delegate needs its own WebGL2 context; fall back rather than dead-end.
      landmarkerRef.current = await make("CPU");
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
    if (!lm) return { sample: null, lm: null, captureTime };
    return { sample: sampleFromLandmarks(lm, video.videoWidth / video.videoHeight), lm, captureTime };
  }, []);

  // Flat-page preview loop: detect + draw landmarks. Paused while in AR (the XR loop owns it).
  useEffect(() => {
    if (inAr) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const out = detectOnce();
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
  }, [inAr, detectOnce]);

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
        if (!usable.some((d) => d.deviceId === active) && usable[0]) {
          active = await open(usable[0].deviceId);
        }
        setDeviceId(active);
        if (!landmarkerRef.current) await loadLandmarker();
      } catch (e) {
        setCamError(`${(e as Error).name ?? "Error"}: ${(e as Error).message ?? String(e)}`);
      }
    },
    [loadLandmarker],
  );

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
      sessionRef.current?.end().catch(() => {});
    },
    [],
  );

  const enterAr = useCallback(async () => {
    if (!xr) return;
    setArError(null);
    try {
      const session = await runArSession(xr, {
        detectOnce,
        statsRef,
        video: videoRef.current!,
        getProfile: () =>
          profileForLabel(labelRef.current, paramsRef.current.lens === "auto" ? null : paramsRef.current.lens),
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
  }, [xr, detectOnce]);

  const camOk = stats.videoW > 0;
  const k = camOk ? streamIntrinsics(profile, stats.videoW, stats.videoH) : null;

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
          <li>
            After a second, three dots appear: green on each eye, yellow on the tip of the nose.
            Are they on the eyes and nose? If not, which way are they off?
          </li>
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Trigger: place the dots again. A/X button: show or hide the camera view. Reports save
          themselves. There is nothing to calibrate.
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
            `camera    ${camOk ? `${stats.videoW}×${stats.videoH}` : "—"}  lens ${profile.name} (Camera2 ${profile.camera2Id})`,
            `model     ${k ? `factory: fx ${k.fx.toFixed(1)} cx ${k.cx.toFixed(1)} cy ${k.cy.toFixed(1)}, hfov ${((2 * Math.atan(k.width / 2 / k.fx) * 180) / Math.PI).toFixed(1)}°` : "—"}`,
            `mediapipe ${mpStatus}`,
            `detect    ${stats.detectFps.toFixed(1)} fps, ${stats.detectMs.toFixed(1)} ms`,
            `face      ${stats.faceFound ? `yes (${stats.landmarks} landmarks)` : "no"}`,
            `xr        ${inAr ? `in session, ${stats.state}` : stats.xrStarted ? `ended — ${stats.xrFrames} frames, ${stats.xrDetections} detections, ${stats.locks} locks` : "—"}`,
            `latency   ${stats.latencyMs != null ? `${stats.latencyMs.toFixed(0)} ms (${stats.latencySource})` : "—"}`,
            `report    ${reportStatus ?? "—"}`,
          ].join("\n")}
        </Typography>
      </Paper>

      <Box sx={{ position: "relative", width: "100%", mb: 2, bgcolor: "black", lineHeight: 0 }}>
        <video ref={videoRef} playsInline muted style={{ width: "100%", display: "block" }} />
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        />
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Settings (the defaults should be right)
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
          Only sets how far away the face is. Being off by a bit barely moves the dots.
        </Typography>
        <TextField
          select
          size="small"
          label="Which lens this camera is"
          value={params.lens}
          onChange={(e) => setParams((p) => ({ ...p, lens: e.target.value as LensChoice }))}
          sx={{ width: 260 }}
        >
          <MenuItem value="auto">Auto (camera 1 = left, camera 2 = right)</MenuItem>
          <MenuItem value="left">Left</MenuItem>
          <MenuItem value="right">Right</MenuItem>
        </TextField>
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
  detectOnce: () => Detection | null;
  statsRef: { current: Stats };
  video: HTMLVideoElement;
  getProfile: () => CameraProfile;
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
  const { detectOnce, statsRef, video, getProfile, getEyeSpanM, onLocked } = deps;
  const stats = statsRef.current;
  Object.assign(stats, { ...freshStats(), xrStarted: true, state: "searching" });

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
      locking: "Hold still…",
      locked: "Dots on eyes + nose?",
    };
    ctx.fillText(headline[stats.state], 18, 42);
    ctx.font = "24px monospace";
    ctx.fillStyle = "#fff";
    const n = stats.nudgeCm;
    const lines = [
      `cam ${stats.videoW}x${stats.videoH} ${video.paused ? "PAUSED" : "playing"}  ${stats.detectFps.toFixed(0)} fps`,
      `lens ${stats.lens}  latency ${stats.latencyMs?.toFixed(0) ?? "-"}ms ${stats.latencySource === "captureTime" ? "(measured)" : "(assumed)"}`,
      `face ${stats.faceFound ? "YES" : "no"}  depth ${stats.depthM?.toFixed(2) ?? "-"} m`,
      `jitter ${stats.jitterCm?.toFixed(1) ?? "-"} cm  nudge ${n.x.toFixed(1)} ${n.y.toFixed(1)} ${n.z.toFixed(1)}`,
      `trigger=place again  A/X=camera view`,
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
  let lockSamples: { pts: THREE.Vector3[]; sample: FaceSample }[] = [];
  const beginLock = () => {
    stats.state = "searching";
    phaseStart = 0;
    lockSamples = [];
    stats.nudgeCm = { x: 0, y: 0, z: 0 };
    dots.visible = false;
  };
  session.addEventListener("select", beginLock);
  session.addEventListener("squeeze", beginLock);

  const viewer = new THREE.Matrix4();
  const viewerPos = new THREE.Vector3();
  const v = new THREE.Vector3();
  let lastT = 0;
  let lastToggle = false;

  renderer.setAnimationLoop((t: number, frame?: XRFrame) => {
    const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 1 / 72;
    lastT = t;
    stats.xrFrames += 1;
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

      const out = detectOnce();
      if (out) {
        stats.xrDetections += 1;
        if (camViewOn && camView.ctx) {
          camView.ctx.drawImage(video, 0, 0, 320, 240);
          if (out.lm) drawLandmarks(camView.ctx, out.lm, 320, 240);
          camView.tex.needsUpdate = true;
        }
      }

      if (out?.sample && out.lm && stats.videoW > 0) {
        const profile = getProfile();
        stats.lens = `${profile.name} (${profile.camera2Id})`;
        const k = streamIntrinsics(profile, stats.videoW, stats.videoH);
        const eyeSpanM = getEyeSpanM();
        stats.depthM = eyeLineDepth(out.sample, k, eyeSpanM);
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

        if (stats.state === "searching") {
          stats.state = "locking";
          phaseStart = t;
        }
        if (stats.state === "locking") {
          const lm = out.lm;
          const eyeLineZ = ((lm[LM.rightEyeOuter]?.z ?? 0) + (lm[LM.leftEyeOuter]?.z ?? 0)) / 2;
          const pts: THREE.Vector3[] = [];
          for (const id of MARKER_IDS) {
            const pt = lm[id];
            const head = pt && landmarkInHead(pt, eyeLineZ, out.sample, profile, k, eyeSpanM);
            if (!head) break;
            const w = applyMat4(headPose, head);
            pts.push(new THREE.Vector3(w.x, w.y, w.z));
          }
          if (pts.length === MARKER_IDS.length) lockSamples.push({ pts, sample: out.sample });
        }
      }

      if (
        stats.state === "locking" &&
        (t - phaseStart) / 1000 >= LOCK_SECONDS &&
        lockSamples.length >= LOCK_MIN_SAMPLES
      ) {
        const means = MARKER_IDS.map(() => new THREE.Vector3());
        for (const smp of lockSamples) smp.pts.forEach((q, i) => means[i].add(q));
        means.forEach((m) => m.divideScalar(lockSamples.length));
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
        dots.visible = true;
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
    renderer.render(scene, camera);
  });

  session.addEventListener("end", () => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    host.remove();
    stats.state = "idle";
  });

  return session;
}
