import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Paper,
  Slider,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import * as THREE from "three";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { uploadFile } from "../api/client";
import { LOCAL_STORAGE_TOKEN_KEY } from "../constants";
import {
  applyMat4,
  centerJitter,
  faceInViewer,
  LATENCIES_MS,
  LM,
  sampleFromLandmarks,
} from "../lib/faceSpike";
import type { CalResult, CalSample, CamParams, FaceSample, Mat4, Pt2 } from "../lib/faceSpike";
import type { CalRequest } from "../lib/faceSpikeWorker";

// AR face-replacement feasibility spike (console#730).
//
// Run 1 answered the go/no-go: the camera keeps running inside immersive-ar and the face is
// found. It also showed the oval landing to the right of the face, i.e. the assumed camera
// model was wrong. So this page now calibrates itself:
//
//   Trigger → "move your head slowly" for a few seconds → the page fits the camera model
//   (FOV, orientation, offset, mirroring, latency) that keeps the static face in one place
//   → re-locks with it. See calibrate() in lib/faceSpike.ts.
//
// Reports upload themselves (POST /upload → s3://wanly-jobs/uploads/face-spike-*.json), because
// copying text out of a headset is not a workflow.

// Pinned to the npm dependency so the JS and the wasm can never disagree.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const PARAMS_KEY = "wanly.faceSpike.params";
const LOCK_SECONDS = 1.0;
const LOCK_MIN_SAMPLES = 8;
const CALIBRATE_SECONDS = 6;
const NUDGE_M_PER_S = 0.05;
const POSE_HISTORY_MS = 400;

type Delegate = "GPU" | "CPU";

interface Params {
  hfovDeg: number;
  eyeSpanCm: number; // outer eye corner to outer eye corner on the target face — measure it
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  offXCm: number; // camera position relative to the XR viewer (between the eyes)
  offYCm: number;
  offZCm: number;
  flipX: boolean;
  latencyMs: number;
  delegate: Delegate;
}

const DEFAULT_PARAMS: Params = {
  hfovDeg: 80,
  eyeSpanCm: 9.5,
  yawDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
  offXCm: 0,
  offYCm: 0,
  offZCm: 0,
  flipX: false,
  latencyMs: 0,
  delegate: "GPU",
};

const toCam = (p: Params): CamParams => ({
  hfovDeg: p.hfovDeg,
  yawDeg: p.yawDeg,
  pitchDeg: p.pitchDeg,
  rollDeg: p.rollDeg,
  offX: p.offXCm / 100,
  offY: p.offYCm / 100,
  offZ: p.offZCm / 100,
  flipX: p.flipX,
});

const round = (v: number, step: number) => Math.round(v / step) * step;

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

type State = "idle" | "searching" | "locking" | "locked" | "calibrating" | "solving";

/** Mutable, per-frame numbers. Lives in a ref; the React state copy is refreshed at ~4 Hz. */
interface Stats {
  videoW: number;
  videoH: number;
  detectFps: number;
  detectMs: number;
  faceFound: boolean;
  landmarks: number;
  state: State;
  calProgress: number; // 0..1 while calibrating
  jitterCm: number | null;
  imgJitterPx: number | null;
  depthM: number | null;
  nudgeCm: { x: number; y: number; z: number };
  xrStarted: boolean;
  xrFrames: number;
  xrDetections: number;
  lastCal: CalResult | null;
  calMessage: string | null;
}

const freshStats = (): Stats => ({
  videoW: 0,
  videoH: 0,
  detectFps: 0,
  detectMs: 0,
  faceFound: false,
  landmarks: 0,
  state: "idle",
  calProgress: 0,
  jitterCm: null,
  imgJitterPx: null,
  depthM: null,
  nudgeCm: { x: 0, y: 0, z: 0 },
  xrStarted: false,
  xrFrames: 0,
  xrDetections: 0,
  lastCal: null,
  calMessage: null,
});

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
  // Detection-rate bookkeeping shared by the flat and XR loops.
  const rateRef = useRef({ windowStart: 0, count: 0, msAcc: 0, lastVideoTime: -1 });

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

  const deviceLabel = useCallback(
    () => devices.find((d) => d.deviceId === deviceId)?.label ?? deviceId,
    [devices, deviceId],
  );

  const buildReport = useCallback(
    (reason: string) => ({
      ticket: "console#730",
      reason,
      at: new Date().toISOString(),
      userAgent: navigator.userAgent,
      secureContext: window.isSecureContext,
      arSupported,
      camError,
      camera: deviceLabel(),
      cameras: devices.map((d) => d.label),
      mediapipe: mpStatus,
      params: paramsRef.current,
      stats: statsRef.current,
    }),
    [arSupported, camError, deviceLabel, devices, mpStatus],
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

  const loadLandmarker = useCallback(async (delegate: Delegate) => {
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    setMpStatus(`loading (${delegate})…`);
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    const make = (d: Delegate) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: d },
        runningMode: "VIDEO",
        numFaces: 1,
      });
    try {
      landmarkerRef.current = await make(delegate);
      setMpStatus(`ready (${delegate})`);
    } catch (e) {
      if (delegate === "CPU") throw e;
      // The GPU delegate needs its own WebGL2 context; fall back rather than dead-end.
      landmarkerRef.current = await make("CPU");
      setMpStatus(`ready (CPU — GPU failed: ${String(e)})`);
    }
  }, []);

  /** Run one detection if the video has a new frame. Shared by the flat preview and XR loops. */
  const detectOnce = useCallback((): { sample: FaceSample | null; lm: Pt2[] | null } | null => {
    const video = videoRef.current;
    const lmk = landmarkerRef.current;
    if (!video || !lmk || video.readyState < 2) return null;
    const r = rateRef.current;
    if (video.currentTime === r.lastVideoTime) return null;
    r.lastVideoTime = video.currentTime;

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
    const lm = res.faceLandmarks[0] ?? null;
    s.faceFound = !!lm;
    s.landmarks = lm?.length ?? 0;
    if (!lm) return { sample: null, lm: null };
    return { sample: sampleFromLandmarks(lm, video.videoWidth / video.videoHeight), lm };
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        const video: MediaTrackConstraints = {
          width: { ideal: 1280 },
          height: { ideal: 960 },
          ...(id ? { deviceId: { exact: id } } : { facingMode: "environment" }),
        };
        const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        streamRef.current = stream;
        const el = videoRef.current!;
        el.srcObject = stream;
        await el.play();
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === "videoinput"));
        setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? id ?? "");
        if (!landmarkerRef.current) await loadLandmarker(paramsRef.current.delegate);
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
        paramsRef,
        video: videoRef.current!,
        onCalibrated: (r) => {
          setParams((p) => ({
            ...p,
            hfovDeg: round(r.params.hfovDeg, 0.1),
            yawDeg: round(r.params.yawDeg, 0.1),
            pitchDeg: round(r.params.pitchDeg, 0.1),
            rollDeg: round(r.params.rollDeg, 0.1),
            offXCm: round(r.params.offX * 100, 0.1),
            offYCm: round(r.params.offY * 100, 0.1),
            flipX: r.params.flipX,
            latencyMs: r.latencyMs,
          }));
          // Let the params effect run first so the report carries the new values.
          window.setTimeout(() => sendReportRef.current("calibrated"), 0);
        },
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

  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));
  const camOk = stats.videoW > 0;
  const cal = stats.lastCal;

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
          <li>Press <b>Start camera</b>. Check that the preview below says <b>face yes</b>.</li>
          <li>Press <b>Enter AR</b>. Stand about a metre from the face and look at it.</li>
          <li>
            Pull the <b>trigger</b>. For 6 seconds, keep looking at the face while you slowly sway
            side to side and nod up and down. The readout says when it's done.
          </li>
          <li>The pink oval re-appears. Check whether it now sits on the face.</li>
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Grip button: re-place the oval without calibrating. A/X button: show or hide the camera
          view. Reports save themselves; nothing to copy.
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
              sx={{ minWidth: 260 }}
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
            `camera    ${camOk ? `${stats.videoW}×${stats.videoH}` : "—"}`,
            `mediapipe ${mpStatus}`,
            `detect    ${stats.detectFps.toFixed(1)} fps, ${stats.detectMs.toFixed(1)} ms`,
            `face      ${stats.faceFound ? `yes (${stats.landmarks} landmarks)` : "no"}`,
            `xr        ${inAr ? `in session, ${stats.state}` : stats.xrStarted ? `ended — ${stats.xrFrames} frames, ${stats.xrDetections} detections` : "—"}`,
            `calibrate ${cal ? `spread ${cal.spreadBeforeCm.toFixed(1)} → ${cal.spreadAfterCm.toFixed(1)} cm, head travel ${cal.headTravelCm.toFixed(0)} cm, ${cal.samples} samples` : (stats.calMessage ?? "—")}`,
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
          Camera model — calibration fills these in; you only need to set the eye span
        </Typography>
        <ParamSlider label="Face eye span (outer corners)" unit=" cm" min={6} max={14} step={0.1} value={params.eyeSpanCm} onChange={(v) => set("eyeSpanCm", v)} />
        <ParamSlider label="Horizontal FOV" unit="°" min={40} max={120} step={0.1} value={params.hfovDeg} onChange={(v) => set("hfovDeg", v)} />
        <ParamSlider label="Yaw (left +)" unit="°" min={-30} max={30} step={0.1} value={params.yawDeg} onChange={(v) => set("yawDeg", v)} />
        <ParamSlider label="Pitch (up +)" unit="°" min={-30} max={30} step={0.1} value={params.pitchDeg} onChange={(v) => set("pitchDeg", v)} />
        <ParamSlider label="Roll" unit="°" min={-30} max={30} step={0.1} value={params.rollDeg} onChange={(v) => set("rollDeg", v)} />
        <ParamSlider label="Camera offset X (right +)" unit=" cm" min={-10} max={10} step={0.1} value={params.offXCm} onChange={(v) => set("offXCm", v)} />
        <ParamSlider label="Camera offset Y (up +)" unit=" cm" min={-10} max={10} step={0.1} value={params.offYCm} onChange={(v) => set("offYCm", v)} />
        <ParamSlider label="Camera offset Z (back +)" unit=" cm" min={-10} max={10} step={0.1} value={params.offZCm} onChange={(v) => set("offZCm", v)} />
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 1, flexWrap: "wrap" }}>
          <FormControlLabel
            control={<Switch checked={params.flipX} onChange={(e) => set("flipX", e.target.checked)} />}
            label="Mirrored image"
          />
          <TextField
            select
            size="small"
            label="Camera latency"
            value={params.latencyMs}
            onChange={(e) => set("latencyMs", Number(e.target.value))}
            sx={{ width: 160 }}
          >
            {LATENCIES_MS.map((ms) => (
              <MenuItem key={ms} value={ms}>
                {ms} ms
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="body2">MediaPipe</Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={params.delegate}
            onChange={(_, v: Delegate | null) => {
              if (!v) return;
              set("delegate", v);
              loadLandmarker(v).catch((e) => setMpStatus(`failed: ${String(e)}`));
            }}
          >
            <ToggleButton value="GPU">GPU</ToggleButton>
            <ToggleButton value="CPU">CPU</ToggleButton>
          </ToggleButtonGroup>
          <Button size="small" onClick={() => setParams({ ...DEFAULT_PARAMS, eyeSpanCm: params.eyeSpanCm })}>
            Reset calibration
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}

function ParamSlider({
  label, unit, min, max, step, value, onChange,
}: {
  label: string; unit: string; min: number; max: number; step: number; value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
      <Typography variant="body2" sx={{ width: 260, flexShrink: 0 }}>
        {label}: {value}
        {unit}
      </Typography>
      <Slider size="small" min={min} max={max} step={step} value={value} onChange={(_, v) => onChange(v as number)} />
    </Box>
  );
}

function drawLandmarks(ctx: CanvasRenderingContext2D, lm: Pt2[], w: number, h: number) {
  ctx.fillStyle = "rgba(0,229,255,0.8)";
  for (const p of lm) ctx.fillRect(p.x * w - 1, p.y * h - 1, 2, 2);
  ctx.fillStyle = "#ff2bd6";
  for (const i of Object.values(LM)) {
    const p = lm[i];
    if (p) ctx.fillRect(p.x * w - 4, p.y * h - 4, 8, 8);
  }
}

// ---------------------------------------------------------------------------------------------
// The XR session. Plain three.js, outside React: it runs at display rate and must not re-render.

const OVAL_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vec2 d = (vUv - 0.5) * 2.0;
    float r = length(d);
    float a = 1.0 - smoothstep(0.75, 1.0, r);   // feathered edge
    float ring = smoothstep(0.88, 0.92, r) * (1.0 - smoothstep(0.96, 1.0, r));
    vec3 col = mix(vec3(1.0, 0.17, 0.84), vec3(1.0), ring);
    gl_FragColor = vec4(col * a * 0.6, a * 0.6);
  }
`;
const OVAL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

interface SessionDeps {
  detectOnce: () => { sample: FaceSample | null; lm: Pt2[] | null } | null;
  statsRef: { current: Stats };
  paramsRef: { current: Params };
  video: HTMLVideoElement;
  onCalibrated: (r: CalResult) => void;
}

/** Head-locked-ish panel: a canvas texture held at an offset in front of the viewer. */
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
  const { detectOnce, statsRef, paramsRef, video, onCalibrated } = deps;
  const stats = statsRef.current;
  Object.assign(stats, { ...freshStats(), xrStarted: true, state: "searching", lastCal: stats.lastCal });

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

  // Placeholder face: unit plane, scaled to the measured face height at lock.
  const oval = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      vertexShader: OVAL_VERTEX,
      fragmentShader: OVAL_FRAGMENT,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    }),
  );
  oval.visible = false;
  scene.add(oval);

  // Live marker: where the CURRENT detection back-projects, unsmoothed. With a right camera
  // model it sits on the face whatever the head does.
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.008, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff }),
  );
  marker.visible = false;
  scene.add(marker);

  const hud = makePanel(640, 360, 0.34);
  scene.add(hud.mesh);
  // What the camera sees, with the landmarks: makes mirroring / rotation obvious at a glance.
  const camView = makePanel(320, 240, 0.24);
  scene.add(camView.mesh);
  let camViewOn = true;

  let lastHud = 0;
  const drawHud = () => {
    const ctx = hud.ctx;
    if (!ctx) return;
    const p = paramsRef.current;
    ctx.clearRect(0, 0, 640, 360);
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, 640, 360);
    ctx.font = "bold 30px sans-serif";
    ctx.fillStyle = "#ffd54f";
    const headline: Record<State, string> = {
      idle: "",
      searching: stats.faceFound ? "Face found…" : "Look at the face",
      locking: "Hold still…",
      locked: "Trigger = calibrate",
      calibrating: `Sway + nod slowly  ${Math.round(stats.calProgress * 100)}%`,
      solving: "Calculating…",
    };
    ctx.fillText(stats.calMessage && stats.state === "locked" ? stats.calMessage : headline[stats.state], 18, 42);
    ctx.font = "24px monospace";
    ctx.fillStyle = "#fff";
    const n = stats.nudgeCm;
    const c = stats.lastCal;
    const lines = [
      `cam ${stats.videoW}x${stats.videoH} ${video.paused ? "PAUSED" : "playing"}  ${stats.detectFps.toFixed(0)} fps`,
      `face ${stats.faceFound ? "YES" : "no"}  depth ${stats.depthM?.toFixed(2) ?? "-"} m`,
      `lock jitter ${stats.jitterCm?.toFixed(1) ?? "-"} cm`,
      `nudge ${n.x.toFixed(1)} ${n.y.toFixed(1)} ${n.z.toFixed(1)} cm`,
      c ? `cal ${c.spreadBeforeCm.toFixed(1)}->${c.spreadAfterCm.toFixed(1)}cm lat ${c.latencyMs}ms` : "cal -",
      `fov ${p.hfovDeg.toFixed(0)} yaw ${p.yawDeg.toFixed(1)} pit ${p.pitchDeg.toFixed(1)}${p.flipX ? " MIRROR" : ""}`,
      `grip=re-place  A/X=camera view`,
    ];
    lines.forEach((l, i) => ctx.fillText(l, 18, 84 + i * 38));
    hud.tex.needsUpdate = true;
  };

  const session = await xr.requestSession("immersive-ar", {
    requiredFeatures: ["local-floor"],
  });
  await renderer.xr.setSession(session);

  // Pose history: the camera frame is older than the current pose, by an unknown amount the
  // calibration estimates. Keep enough to look back over every candidate latency.
  const history: { t: number; m: number[] }[] = [];
  const poseAt = (t: number): number[] | null => {
    let best: { t: number; m: number[] } | null = null;
    for (const h of history) if (!best || Math.abs(h.t - t) < Math.abs(best.t - t)) best = h;
    return best?.m ?? null;
  };

  // Lock state: world-space samples collected over LOCK_SECONDS, then averaged.
  let phaseStart = 0;
  let lockSamples: { pos: THREE.Vector3; heightM: number; sample: FaceSample }[] = [];
  let calSamples: CalSample[] = [];
  const beginLock = () => {
    stats.state = "searching";
    phaseStart = 0;
    lockSamples = [];
    stats.nudgeCm = { x: 0, y: 0, z: 0 };
  };
  const beginCalibrate = () => {
    if (stats.state === "solving") return;
    stats.state = "calibrating";
    stats.calMessage = null;
    stats.calProgress = 0;
    phaseStart = 0;
    calSamples = [];
    oval.visible = false;
  };
  session.addEventListener("select", beginCalibrate);
  session.addEventListener("squeeze", beginLock);

  const worker = new Worker(new URL("../lib/faceSpikeWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<CalResult | null>) => {
    const r = e.data;
    if (!r) {
      stats.calMessage = "Not enough face samples — try again";
    } else if (r.headTravelCm < 3) {
      stats.lastCal = r;
      stats.calMessage = "Too little head movement — try again";
    } else {
      stats.lastCal = r;
      stats.calMessage = `Calibrated (${r.spreadBeforeCm.toFixed(0)} → ${r.spreadAfterCm.toFixed(1)} cm)`;
      // Apply now so the re-lock below uses it; React mirrors it into the sliders + storage.
      const p = paramsRef.current;
      paramsRef.current = {
        ...p,
        hfovDeg: r.params.hfovDeg,
        yawDeg: r.params.yawDeg,
        pitchDeg: r.params.pitchDeg,
        rollDeg: r.params.rollDeg,
        offXCm: r.params.offX * 100,
        offYCm: r.params.offY * 100,
        flipX: r.params.flipX,
        latencyMs: r.latencyMs,
      };
      onCalibrated(r);
    }
    beginLock();
  };
  worker.onerror = (e) => {
    stats.calMessage = `Calibration crashed: ${e.message}`;
    beginLock();
  };

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
      const p = paramsRef.current;
      const aspect = stats.videoW / Math.max(1, stats.videoH);
      if (out?.sample) {
        const lagged = poseAt(t - p.latencyMs) ?? now;
        const local = faceInViewer(out.sample, toCam(p), p.eyeSpanCm / 100, aspect);
        if (local) {
          const w = applyMat4(lagged, local);
          v.set(w.x, w.y, w.z);
          marker.position.copy(v);
          marker.visible = true;
          stats.depthM = -local.z;

          if (stats.state === "calibrating") {
            if (!phaseStart) phaseStart = t;
            calSamples.push({
              sample: out.sample,
              viewers: LATENCIES_MS.map((ms) => (poseAt(t - ms) ?? now) as Mat4),
            });
          }
          if (stats.state === "searching") {
            stats.state = "locking";
            phaseStart = t;
          }
          if (stats.state === "locking") {
            const heightM = out.sample.faceHeight * ((p.eyeSpanCm / 100) / out.sample.eyeSpan);
            lockSamples.push({ pos: v.clone(), heightM, sample: out.sample });
          }
        }
      }

      if (stats.state === "calibrating" && phaseStart) {
        stats.calProgress = Math.min(1, (t - phaseStart) / 1000 / CALIBRATE_SECONDS);
        if (stats.calProgress >= 1) {
          stats.state = "solving";
          const req: CalRequest = {
            samples: calSamples,
            start: toCam(p),
            eyeSpanM: p.eyeSpanCm / 100,
            aspect,
          };
          worker.postMessage(req);
        }
      }

      if (
        stats.state === "locking" &&
        (t - phaseStart) / 1000 >= LOCK_SECONDS &&
        lockSamples.length >= LOCK_MIN_SAMPLES
      ) {
        const mean = new THREE.Vector3();
        let h = 0;
        for (const s of lockSamples) {
          mean.add(s.pos);
          h += s.heightM;
        }
        mean.divideScalar(lockSamples.length);
        h /= lockSamples.length;
        let spread = 0;
        for (const s of lockSamples) spread += s.pos.distanceToSquared(mean);
        stats.jitterCm = Math.sqrt(spread / lockSamples.length) * 100;
        stats.imgJitterPx = centerJitter(lockSamples.map((s) => s.sample)) * stats.videoW;
        oval.position.copy(mean);
        oval.scale.set(h * 0.78, h, 1);
        oval.lookAt(viewerPos); // +z faces the viewer at lock time, then it stays put
        oval.visible = true;
        stats.state = "locked";
      }

      // Thumbstick nudge, in the oval's own frame. Left: x/y. Right: toward/away.
      if (stats.state === "locked") {
        for (const src of session.inputSources) {
          const ax = src.gamepad?.axes;
          if (!ax || ax.length < 4) continue;
          const sx = Math.abs(ax[2]) > 0.15 ? ax[2] : 0;
          const sy = Math.abs(ax[3]) > 0.15 ? ax[3] : 0;
          const step = NUDGE_M_PER_S * dt;
          if (src.handedness === "left") {
            oval.translateX(sx * step);
            oval.translateY(-sy * step);
            stats.nudgeCm.x += sx * step * 100;
            stats.nudgeCm.y += -sy * step * 100;
          } else if (src.handedness === "right") {
            oval.translateZ(sy * step); // push forward = farther (oval +z faces the viewer)
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
    worker.terminate();
    host.remove();
    stats.state = "idle";
  });

  return session;
}
