// Face Loops AR player (console#749): wear a character's face loop on a real face.
//
// The placement is the one proven on the POC page (console#730/#739): the Quest 3S passthrough
// cameras' factory calibration (lib/faceSpike) + stereo triangulation of face-on landmarks
// (lib/faceStereo), locked once with the head steady, then render-only. The mesh SHAPE comes
// from the clip frame by frame; one similarity fit places it (lib/faceMask).
//
// Two phases, because WebXR needs the tap and the tap must not wait:
//   warm()   — when a page with loops opens on the headset: both cameras + two MediaPipe
//              landmarkers. Same order as the POC (cameras open on the flat page, then AR).
//   launch() — inside the tap: starts the loop video and requests the session synchronously,
//              fetches the loop's shape data alongside. The lock waits for it.
// In AR: trigger/grip = re-anchor (look at the face, hold still); B/Y = leave.
//
// Loaded with import() so pages that never go to AR don't pull in three/MediaPipe.
import * as THREE from "three";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { getFileUrl } from "../api/client";
import type { FaceLoop } from "../api/types";
import { loopFile } from "./faceLoops";
import { buildTriangles, featherAlpha, fitSimilarity, frameAttributes, ovalLoop, TOTAL_VERTICES } from "./faceMask";
import { applyMat4 } from "./faceSpike";
import type { Pt3, Vec3 } from "./faceSpike";
import {
  ANCHOR_MIN_COUNT,
  FALLBACK_LATENCY_MS,
  LOCK_MAX_RAY_GAP_M,
  LOCK_MAX_TURN_DEG_PER_S,
  LOCK_MIN_SAMPLES,
  LOCK_SECONDS,
  medianAnchors,
  PLACE_ANCHORS,
  PoseHistory,
  POSE_HISTORY_MS,
  STEREO_PAIR_MS,
  stereoAnchors,
  stereoPoints,
} from "./faceStereo";

// Pinned to the npm dependency so the JS and the wasm can never disagree.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export type WarmState = "idle" | "starting" | "ready" | "failed";

interface Cam {
  video: HTMLVideoElement;
  stream: MediaStream;
  lmk: FaceLandmarker;
  lastTime: number;
}

interface FaceData {
  fps: number;
  frames: number;
  positions: Float32Array;
  uvs: Float32Array;
}

/** A hidden, playing video element (1px, not display:none, so the browser keeps decoding it). */
function hiddenVideo(): HTMLVideoElement {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(v);
  return v;
}

async function loadFace(loop: FaceLoop): Promise<FaceData> {
  const meta = await (await fetch(getFileUrl(loopFile(loop, "face.json")!))).json();
  const buf = await (await fetch(getFileUrl(loopFile(loop, "face.bin")!))).arrayBuffer();
  const n = meta.frames * meta.vertices;
  return {
    fps: meta.fps,
    frames: meta.frames,
    positions: new Float32Array(buf, 0, n * 3),
    uvs: new Float32Array(buf, n * 3 * 4, n * 2),
  };
}

export class FaceArEngine {
  state: WarmState = "idle";
  error: string | null = null;
  private right: Cam | null = null;
  private left: Cam | null = null;
  private captureTime: { mediaTime: number; t: number | null } | null = null;
  private warming: Promise<void> | null = null;
  private session: XRSession | null = null;
  private disposed = false;

  private onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  get inSession() {
    return !!this.session;
  }

  /** Open both room cameras and load the landmarkers. Safe to call repeatedly. */
  warm(): Promise<void> {
    this.warming ??= this.doWarm().catch((e) => {
      this.state = "failed";
      this.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      this.warming = null;
      this.onChange();
    });
    return this.warming;
  }

  private async doWarm() {
    this.state = "starting";
    this.error = null;
    this.onChange();
    const open = async (deviceId?: string) =>
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 960 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" }),
        },
      });
    // Labels are only listed once camera permission is granted, so open one first.
    const first = await open();
    const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    first.getTracks().forEach((t) => t.stop());
    // Browser "camera 2" / "camera 1" are Camera2 devices 51/50: right/left (POC, dumpsys).
    const rightDev = all.find((d) => /camera 2\b/i.test(d.label));
    const leftDev = all.find((d) => /camera 1\b/i.test(d.label));
    if (!rightDev || !leftDev) throw new Error("this headset's two room cameras were not found (Quest 3S only)");
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    const make = async () => {
      const opts = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO" as const,
        numFaces: 1,
      });
      try {
        return await FaceLandmarker.createFromOptions(fileset, opts("GPU"));
      } catch {
        return FaceLandmarker.createFromOptions(fileset, opts("CPU"));
      }
    };
    const cam = async (deviceId: string): Promise<Cam> => {
      const stream = await open(deviceId);
      const video = hiddenVideo();
      video.srcObject = stream;
      await video.play();
      return { video, stream, lmk: await make(), lastTime: -1 };
    };
    this.right = await cam(rightDev.deviceId);
    this.left = await cam(leftDev.deviceId);
    // Capture time of each right-camera frame, so detections use the head pose AT capture.
    const v = this.right.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, m: { mediaTime: number; captureTime?: number }) => void) => number;
    };
    const stream = this.right.stream;
    if (v.requestVideoFrameCallback) {
      const onFrame = (_: number, m: { mediaTime: number; captureTime?: number }) => {
        this.captureTime = { mediaTime: m.mediaTime, t: m.captureTime ?? null };
        if (this.right?.stream === stream) v.requestVideoFrameCallback!(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
    }
    if (this.disposed) return this.release();
    this.state = "ready";
    this.onChange();
  }

  private release() {
    for (const c of [this.right, this.left]) {
      if (!c) continue;
      c.stream.getTracks().forEach((t) => t.stop());
      c.lmk.close();
      c.video.remove();
    }
    this.right = this.left = null;
  }

  dispose() {
    this.disposed = true;
    this.session?.end().catch(() => {});
    this.release();
  }

  /**
   * Wear `loop`. Call straight from the tap handler: the session request must happen inside
   * the user gesture, so nothing is awaited before it.
   */
  launch(loop: FaceLoop): Promise<XRSession> {
    const xr = (navigator as unknown as { xr?: XRSystem }).xr;
    if (!xr) return Promise.reject(new Error("WebXR is not available in this browser"));
    if (this.state !== "ready" || !this.right || !this.left) {
      return Promise.reject(new Error(this.error ?? "the cameras are still starting — try again in a moment"));
    }
    const clip = document.createElement("video");
    clip.crossOrigin = "anonymous"; // before src: CORS-mode fetch so WebGL may sample it
    clip.loop = true;
    clip.muted = true;
    clip.playsInline = true;
    clip.src = getFileUrl(loopFile(loop, "loop.mp4")!);
    clip.play().catch(() => {});
    const requested = xr.requestSession("immersive-ar", { requiredFeatures: ["local-floor"] });
    const face = loadFace(loop);
    face.catch(() => {}); // surfaced in the HUD
    return requested.then((session) => {
      this.session = session;
      session.addEventListener("end", () => {
        this.session = null;
        clip.pause();
        clip.removeAttribute("src");
        this.onChange();
      });
      this.onChange();
      return runSession(session, this.right!, this.left!, () => this.captureTime, clip, face).then(
        () => session,
        (e) => {
          session.end().catch(() => {});
          throw e;
        },
      );
    });
  }
}

type Phase = "loading" | "searching" | "locking" | "locked" | "error";

function detect(cam: Cam): Pt3[] | null | undefined {
  // undefined = no new frame; null = new frame, no face
  const v = cam.video;
  if (v.readyState < 2 || v.currentTime === cam.lastTime) return undefined;
  cam.lastTime = v.currentTime;
  const res = cam.lmk.detectForVideo(v, performance.now());
  return (res.faceLandmarks[0] as Pt3[] | undefined) ?? null;
}

async function runSession(
  session: XRSession,
  right: Cam,
  left: Cam,
  frameMeta: () => { mediaTime: number; t: number | null } | null,
  clip: HTMLVideoElement,
  facePromise: Promise<FaceData>,
) {
  const scene = new THREE.Scene();
  // near 2 cm (default 10 cm): three passes it to the session's depthNear, so the face is not
  // clipped away when you lean in.
  const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 100);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:-1";
  host.appendChild(renderer.domElement);
  document.body.appendChild(host);

  let face: FaceData | null = null;
  let phase: Phase = "loading";
  let message = "";
  facePromise.then(
    (f) => {
      face = f;
      if (phase === "loading") phase = "searching";
    },
    (e) => {
      phase = "error";
      message = `Could not load the face: ${String(e)}`;
    },
  );

  // The face mask.
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(TOTAL_VERTICES * 3);
  const uv = new Float32Array(TOTAL_VERTICES * 2);
  const oval = ovalLoop(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL);
  const tris = buildTriangles(FaceLandmarker.FACE_LANDMARKS_TESSELATION, oval);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("alpha", new THREE.BufferAttribute(featherAlpha(tris, 3), 1));
  geo.setIndex(tris);
  const tex = new THREE.VideoTexture(clip);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } },
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
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false; // positions change every frame
  mesh.visible = false;
  scene.add(mesh);
  let faceFrame = -1;

  // A small prompt under the gaze while placing; gone once the face is on.
  const hudCanvas = document.createElement("canvas");
  hudCanvas.width = 640;
  hudCanvas.height = 120;
  const hudCtx = hudCanvas.getContext("2d");
  const hudTex = new THREE.CanvasTexture(hudCanvas);
  const hud = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, (0.3 * 120) / 640),
    new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false }),
  );
  hud.renderOrder = 10;
  scene.add(hud);
  let hudText = "";
  const setHud = (title: string, sub: string) => {
    const text = `${title}|${sub}`;
    if (text === hudText || !hudCtx) return;
    hudText = text;
    hudCtx.clearRect(0, 0, 640, 120);
    if (title) {
      hudCtx.fillStyle = "rgba(0,0,0,0.65)";
      hudCtx.beginPath();
      hudCtx.roundRect(0, 0, 640, 120, 24);
      hudCtx.fill();
      hudCtx.textAlign = "center";
      hudCtx.fillStyle = "#fff";
      hudCtx.font = "bold 40px sans-serif";
      hudCtx.fillText(title, 320, 54);
      hudCtx.font = "26px sans-serif";
      hudCtx.fillStyle = "#cfd8dc";
      hudCtx.fillText(sub, 320, 96);
    }
    hudTex.needsUpdate = true;
  };

  const history = new PoseHistory();
  let phaseStart = 0;
  let samples: (Vec3 | null)[][] = [];
  let lastLeft: { lm: Pt3[]; at: number } | null = null;
  let lockedAt = 0;
  let lastFaceAt = 0;
  let waiting = "";

  const reanchor = () => {
    if (phase === "error" || phase === "loading") return;
    phase = "searching";
    samples = [];
    mesh.visible = false;
  };
  session.addEventListener("select", reanchor);
  session.addEventListener("squeeze", reanchor);

  const viewer = new THREE.Matrix4();
  const viewerPos = new THREE.Vector3();
  const v = new THREE.Vector3();
  let lastExit = false;

  await renderer.xr.setSession(session);
  renderer.setAnimationLoop((t: number, frame?: XRFrame) => {
    const ref = renderer.xr.getReferenceSpace();
    const pose = frame && ref ? frame.getViewerPose(ref) : null;
    if (pose) {
      const now = Array.from(pose.transform.matrix);
      history.push(t, now);
      viewer.fromArray(now);
      viewerPos.setFromMatrixPosition(viewer);

      // B/Y (button 5) leaves.
      let exit = false;
      for (const src of session.inputSources) if (src.gamepad?.buttons[5]?.pressed) exit = true;
      if (exit && !lastExit) session.end().catch(() => {});
      lastExit = exit;

      // Detect only while placing: once locked, two MediaPipe runs per frame would hold the
      // render loop to ~25 fps (the POC's judder). The trigger resumes it.
      if (phase === "searching" || phase === "locking") {
        const l = detect(left);
        if (l !== undefined) lastLeft = l ? { lm: l, at: performance.now() } : null;
        const r = detect(right);
        const at = performance.now();
        if (r) lastFaceAt = t;
        if (r === null && t - lastFaceAt > 500) {
          // Lost the face (not one missed frame): start over when it is back.
          phase = "searching";
          samples = [];
        } else if (r) {
          if (phase === "searching") {
            phase = "locking";
            phaseStart = t;
            samples = [];
          }
          const w = right.video.videoWidth;
          const h = right.video.videoHeight;
          const st = lastLeft && Math.abs(lastLeft.at - at) <= STEREO_PAIR_MS ? stereoPoints(r, lastLeft.lm, w, h) : null;
          const meta = frameMeta();
          const cap =
            meta && meta.t != null && Math.abs(meta.mediaTime - right.video.currentTime) < 0.05 ? meta.t : null;
          const poseTime = cap != null && t - cap >= 0 && t - cap < POSE_HISTORY_MS ? cap : t - FALLBACK_LATENCY_MS;
          const steady = history.turnRate(poseTime) <= LOCK_MAX_TURN_DEG_PER_S;
          const matched = !!st && st.gapM <= LOCK_MAX_RAY_GAP_M;
          waiting = !steady ? "Hold your head still" : !matched ? "Face it straight on" : "";
          if (st && steady && matched) {
            const headPose = history.at(poseTime) ?? now;
            samples.push(stereoAnchors(r, lastLeft!.lm, w, h).map((a) => (a ? applyMat4(headPose, a) : null)));
          }
        }
      }

      if (phase === "locking" && face && (t - phaseStart) / 1000 >= LOCK_SECONDS && samples.length >= LOCK_MIN_SAMPLES) {
        const f0 = face as FaceData;
        const got = medianAnchors(samples);
        if (got.length >= ANCHOR_MIN_COUNT) {
          const src = got.map(({ index }) => {
            const id = PLACE_ANCHORS[index];
            return { x: f0.positions[id * 3], y: f0.positions[id * 3 + 1], z: f0.positions[id * 3 + 2] };
          });
          const fit = fitSimilarity(src, got.map((g) => g.point));
          const r = fit.rotation;
          const s = fit.scale;
          mesh.matrix.set(
            s * r[0], s * r[1], s * r[2], fit.translation.x,
            s * r[3], s * r[4], s * r[5], fit.translation.y,
            s * r[6], s * r[7], s * r[8], fit.translation.z,
            0, 0, 0, 1,
          );
          mesh.matrixWorldNeedsUpdate = true;
          mesh.visible = true;
          phase = "locked";
          lockedAt = t;
        } else {
          // Not enough of the face measured cleanly: keep collecting.
          phaseStart = t;
          samples = [];
          waiting = "Face it straight on";
        }
      }

      switch (phase) {
        case "loading":
          setHud("Loading the face…", "");
          break;
        case "error":
          setHud("Something went wrong", message.slice(0, 48));
          break;
        case "searching":
          setHud("Look at the face", "B/Y to leave");
          break;
        case "locking":
          setHud(waiting || "Hold still…", "placing the face");
          break;
        case "locked":
          // A short reminder, then nothing in the way.
          setHud(t - lockedAt < 3000 ? "Trigger to re-anchor" : "", t - lockedAt < 3000 ? "B/Y to leave" : "");
          break;
      }
      hud.visible = !!hudText.split("|")[0];
      v.set(0, -0.2, -0.6).applyMatrix4(viewer);
      hud.position.copy(v);
      hud.lookAt(viewerPos);
    }
    if (face && mesh.visible) {
      const f = face as FaceData;
      const fi = Math.floor(clip.currentTime * f.fps) % f.frames;
      if (fi !== faceFrame) {
        faceFrame = fi;
        frameAttributes(f.positions, f.uvs, fi, pos, uv, oval);
        geo.attributes.position.needsUpdate = true;
        geo.attributes.uv.needsUpdate = true;
      }
    }
    renderer.render(scene, camera);
  });

  session.addEventListener("end", () => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    tex.dispose();
    hudTex.dispose();
    host.remove();
  });
}
