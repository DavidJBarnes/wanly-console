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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import * as THREE from "three";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import {
  centerJitter,
  faceInCamera,
  LM,
  sampleFromLandmarks,
} from "../lib/faceSpike";
import type { CameraModel, FaceSample, Pt2 } from "../lib/faceSpike";

// AR face-replacement feasibility spike (console#730).
//
// One question: can a WebXR immersive-ar page on Quest Browser read the passthrough camera via
// getUserMedia and find a mannequin's face with MediaPipe at a usable rate? Everything else here
// (world back-projection, the oval, the nudge) exists to measure HOW WELL, so the answer on the
// ticket is numbers rather than "it sort of worked".
//
// Flow: 1) start the camera on the flat page — the permission prompt cannot appear once in
// immersive mode; check detection on the preview. 2) Enter AR. The first ~1 s of detections are
// averaged in world space and a placeholder oval is anchored there. Trigger = re-lock.
// Thumbsticks nudge the oval onto the real face; the HUD reports the nudge, which IS the
// calibration error of the assumed camera model.

// Pinned to the npm dependency so the JS and the wasm can never disagree.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const PARAMS_KEY = "wanly.faceSpike.params";
const LOCK_SECONDS = 1.0;
const LOCK_MIN_SAMPLES = 8;
const NUDGE_M_PER_S = 0.05;

type Delegate = "GPU" | "CPU";

interface Params {
  hfovDeg: number;
  eyeSpanCm: number; // outer eye corner to outer eye corner on the mannequin — measure it
  offXCm: number; // camera position relative to the XR viewer (between the eyes)
  offYCm: number;
  offZCm: number;
  delegate: Delegate;
}

const DEFAULT_PARAMS: Params = {
  hfovDeg: 80,
  eyeSpanCm: 9.5,
  offXCm: 0,
  offYCm: 0,
  offZCm: 0,
  delegate: "GPU",
};

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

/** Mutable, per-frame numbers. Lives in a ref; the React state copy is refreshed at ~4 Hz. */
interface Stats {
  videoW: number;
  videoH: number;
  detectFps: number;
  detectMs: number;
  faceFound: boolean;
  landmarks: number;
  state: "idle" | "searching" | "locking" | "locked";
  jitterCm: number | null;
  imgJitterPx: number | null;
  depthM: number | null;
  nudgeCm: { x: number; y: number; z: number };
  xrStarted: boolean;
  xrFrames: number;
  xrDetections: number;
}

const freshStats = (): Stats => ({
  videoW: 0,
  videoH: 0,
  detectFps: 0,
  detectMs: 0,
  faceFound: false,
  landmarks: 0,
  state: "idle",
  jitterCm: null,
  imgJitterPx: null,
  depthM: null,
  nudgeCm: { x: 0, y: 0, z: 0 },
  xrStarted: false,
  xrFrames: 0,
  xrDetections: 0,
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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!xr) return;
    xr.isSessionSupported("immersive-ar").then(setArSupported, () => setArSupported(false));
  }, [xr]);

  // Mirror the ref to state a few times a second — enough for a readout, cheap for React.
  useEffect(() => {
    const id = window.setInterval(() => setStats({ ...statsRef.current }), 250);
    return () => window.clearInterval(id);
  }, []);

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
      if (!out.lm) return;
      ctx.fillStyle = "rgba(0,229,255,0.8)";
      for (const p of out.lm) ctx.fillRect(p.x * cv.width - 1, p.y * cv.height - 1, 2, 2);
      ctx.fillStyle = "#ff2bd6";
      for (const i of Object.values(LM)) {
        const p = out.lm[i];
        if (p) ctx.fillRect(p.x * cv.width - 4, p.y * cv.height - 4, 8, 8);
      }
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
      });
      sessionRef.current = session;
      setInAr(true);
      session.addEventListener("end", () => {
        sessionRef.current = null;
        setInAr(false);
      });
    } catch (e) {
      setArError(String(e));
    }
  }, [xr, detectOnce]);

  const report = () =>
    JSON.stringify(
      {
        ticket: "console#730",
        at: new Date().toISOString(),
        userAgent: navigator.userAgent,
        secureContext: window.isSecureContext,
        arSupported,
        camError,
        camera: devices.find((d) => d.deviceId === deviceId)?.label ?? deviceId,
        cameras: devices.map((d) => d.label),
        mediapipe: mpStatus,
        params,
        stats: statsRef.current,
      },
      null,
      2,
    );

  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));
  const camOk = stats.videoW > 0;

  return (
    <Box sx={{ p: 2, maxWidth: 960, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 2, mb: 1 }}>
        <Typography variant="h5">AR face spike</Typography>
        <Button component={RouterLink} to="/settings" size="small">
          Back to settings
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Quest 3 + a mannequin (sculpted, matte, skin-toned). 1. Start the camera here and check that
        the face is detected. 2. Enter AR: the oval locks onto the face after about 1 s. Trigger
        re-locks. Left stick moves the oval left/right/up/down, right stick moves it nearer/farther.
        Line it up on the real face; the nudge on the HUD is the calibration error.
      </Typography>

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
          <Button
            onClick={() =>
              navigator.clipboard?.writeText(report()).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }
          >
            {copied ? "Copied" : "Copy report"}
          </Button>
        </Box>
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
            `camera   ${camOk ? `${stats.videoW}×${stats.videoH}` : "—"}`,
            `mediapipe ${mpStatus}`,
            `detect   ${stats.detectFps.toFixed(1)} fps, ${stats.detectMs.toFixed(1)} ms`,
            `face     ${stats.faceFound ? `yes (${stats.landmarks} landmarks)` : "no"}`,
            `xr       ${inAr ? `in session, state ${stats.state}` : stats.xrStarted ? `ended — ${stats.xrFrames} frames, ${stats.xrDetections} detections` : "—"}`,
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
          Camera model (assumed — Quest Browser does not expose intrinsics)
        </Typography>
        <ParamSlider label="Horizontal FOV" unit="°" min={40} max={120} step={1} value={params.hfovDeg} onChange={(v) => set("hfovDeg", v)} />
        <ParamSlider label="Mannequin eye span (outer corners)" unit=" cm" min={6} max={14} step={0.1} value={params.eyeSpanCm} onChange={(v) => set("eyeSpanCm", v)} />
        <ParamSlider label="Camera offset X (right +)" unit=" cm" min={-10} max={10} step={0.5} value={params.offXCm} onChange={(v) => set("offXCm", v)} />
        <ParamSlider label="Camera offset Y (up +)" unit=" cm" min={-10} max={10} step={0.5} value={params.offYCm} onChange={(v) => set("offYCm", v)} />
        <ParamSlider label="Camera offset Z (back +)" unit=" cm" min={-10} max={10} step={0.5} value={params.offZCm} onChange={(v) => set("offZCm", v)} />
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 1 }}>
          <Typography variant="body2">MediaPipe delegate</Typography>
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
          <Button size="small" onClick={() => setParams(DEFAULT_PARAMS)}>
            Reset
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
}

async function runArSession(xr: XRSystem, deps: SessionDeps): Promise<XRSession> {
  const { detectOnce, statsRef, paramsRef, video } = deps;
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

  // Live marker: where the CURRENT detection back-projects, unsmoothed. Shows lag and offset
  // error directly, independent of the lock.
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.008, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff }),
  );
  marker.visible = false;
  scene.add(marker);

  // HUD: canvas texture held ahead of and below the gaze.
  const hudCanvas = document.createElement("canvas");
  hudCanvas.width = 640;
  hudCanvas.height = 320;
  const hudTex = new THREE.CanvasTexture(hudCanvas);
  const hud = new THREE.Mesh(
    new THREE.PlaneGeometry(0.32, 0.16),
    new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false }),
  );
  hud.renderOrder = 10;
  scene.add(hud);
  let lastHud = 0;
  const drawHud = () => {
    const ctx = hudCanvas.getContext("2d");
    if (!ctx) return;
    const p = paramsRef.current;
    ctx.clearRect(0, 0, 640, 320);
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, 640, 320);
    ctx.fillStyle = "#fff";
    ctx.font = "26px monospace";
    const n = stats.nudgeCm;
    const lines = [
      `cam ${stats.videoW}x${stats.videoH}  ${video.paused ? "PAUSED" : "playing"}`,
      `detect ${stats.detectFps.toFixed(1)} fps  ${stats.detectMs.toFixed(1)} ms`,
      `face ${stats.faceFound ? "YES" : "no"}  state ${stats.state}`,
      `depth ${stats.depthM?.toFixed(2) ?? "-"} m  jitter ${stats.jitterCm?.toFixed(1) ?? "-"} cm / ${stats.imgJitterPx?.toFixed(1) ?? "-"} px`,
      `nudge x${n.x.toFixed(1)} y${n.y.toFixed(1)} z${n.z.toFixed(1)} cm`,
      `hfov ${p.hfovDeg}  eye ${p.eyeSpanCm}cm  ${p.delegate}`,
      `trigger = re-lock`,
    ];
    lines.forEach((l, i) => ctx.fillText(l, 18, 40 + i * 40));
    hudTex.needsUpdate = true;
  };

  const session = await xr.requestSession("immersive-ar", {
    requiredFeatures: ["local-floor"],
  });
  await renderer.xr.setSession(session);

  // Lock state: world-space samples collected over LOCK_SECONDS, then averaged.
  let lockStart = 0;
  let lockSamples: { pos: THREE.Vector3; heightM: number; sample: FaceSample }[] = [];
  const beginLock = () => {
    stats.state = "searching";
    lockStart = 0;
    lockSamples = [];
    stats.nudgeCm = { x: 0, y: 0, z: 0 };
  };
  session.addEventListener("select", beginLock);

  const viewer = new THREE.Matrix4();
  const viewerPos = new THREE.Vector3();
  const v = new THREE.Vector3();
  let lastT = 0;

  renderer.setAnimationLoop((t: number, frame?: XRFrame) => {
    const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 1 / 72;
    lastT = t;
    stats.xrFrames += 1;
    const ref = renderer.xr.getReferenceSpace();
    const pose = frame && ref ? frame.getViewerPose(ref) : null;
    if (pose) {
      viewer.fromArray(pose.transform.matrix);
      viewerPos.setFromMatrixPosition(viewer);

      const out = detectOnce();
      if (out) stats.xrDetections += 1;
      if (out?.sample) {
        const p = paramsRef.current;
        const cam: CameraModel = { hfovDeg: p.hfovDeg, width: stats.videoW, height: stats.videoH };
        const f = faceInCamera(out.sample, cam, p.eyeSpanCm / 100);
        if (f) {
          // camera space → viewer space (camera offset) → world. Uses the pose of the frame the
          // detection RAN on, not the one the camera captured — the camera's latency is part of
          // what the live marker shows.
          v.set(
            f.position.x + p.offXCm / 100,
            f.position.y + p.offYCm / 100,
            f.position.z + p.offZCm / 100,
          ).applyMatrix4(viewer);
          marker.position.copy(v);
          marker.visible = true;
          stats.depthM = -f.position.z;
          if (stats.state === "searching") {
            stats.state = "locking";
            lockStart = t;
          }
          if (stats.state === "locking") {
            lockSamples.push({ pos: v.clone(), heightM: f.heightM, sample: out.sample });
          }
        }
      }
      if (
        stats.state === "locking" &&
        (t - lockStart) / 1000 >= LOCK_SECONDS &&
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
        // Image-space jitter alongside the world spread: a big world spread with a small image
        // spread means head motion during the lock, not detector noise.
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

      // HUD: 0.6 m ahead, 0.22 m below the gaze, facing the viewer.
      v.set(0, -0.22, -0.6).applyMatrix4(viewer);
      hud.position.copy(v);
      hud.lookAt(viewerPos);
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
