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
// In AR: trigger/grip = re-anchor (look at the face, hold still); A/X = Face / Face + hair /
// Hair (console#751); B/Y = leave.
//
// Loaded with import() so pages that never go to AR don't pull in three/MediaPipe.
import * as THREE from "three";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { getFileUrl } from "../api/client";
import type { FaceLoop } from "../api/types";
import { loopFile } from "./faceLoops";
import { buildTriangles, featherAlpha, fitSimilarity, frameAttributes, ovalLoop, TOTAL_VERTICES } from "./faceMask";
import { applyMat4 } from "./faceSpike";
import { HAIR_MODE_LABEL, hairRows, headShell, nextHairMode } from "./faceHair";
import type { HairMode } from "./faceHair";
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
  /** Loops prepared since console#751: see lib/faceHair. */
  hair: { rows: Float32Array; faceToHair: [number, number, number] } | null;
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
  let hair: FaceData["hair"] = null;
  if (meta.hair?.faceToHair) {
    const rows = new Float32Array(await (await fetch(getFileUrl(loopFile(loop, "hair.bin")!))).arrayBuffer());
    if (rows.length === meta.frames * 8) hair = { rows, faceToHair: meta.hair.faceToHair };
  }
  return {
    fps: meta.fps,
    frames: meta.frames,
    positions: new Float32Array(buf, 0, n * 3),
    uvs: new Float32Array(buf, n * 3 * 4, n * 2),
    hair,
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
  launch(loop: FaceLoop, mode: HairMode = "face", onMode?: (m: HairMode) => void): Promise<XRSession> {
    const xr = (navigator as unknown as { xr?: XRSystem }).xr;
    if (!xr) return Promise.reject(new Error("WebXR is not available in this browser"));
    if (this.state !== "ready" || !this.right || !this.left) {
      return Promise.reject(new Error(this.error ?? "the cameras are still starting — try again in a moment"));
    }
    const video = (file: "loop.mp4" | "hair.mp4") => {
      const v = document.createElement("video");
      v.crossOrigin = "anonymous"; // before src: CORS-mode fetch so WebGL may sample it
      v.loop = true;
      v.muted = true;
      v.playsInline = true;
      v.src = getFileUrl(loopFile(loop, file)!);
      v.play().catch(() => {}); // inside the tap, so autoplay rules allow it
      return v;
    };
    // Both start now; each mode draws from ONE of them, so they never need syncing. A loop made
    // before console#751 has no hair.mp4: that element just errors and is never used.
    const clip = video("loop.mp4");
    const hairClip = video("hair.mp4");
    const requested = xr.requestSession("immersive-ar", { requiredFeatures: ["local-floor"] });
    const face = loadFace(loop);
    face.catch(() => {}); // surfaced in the HUD
    return requested.then((session) => {
      this.session = session;
      session.addEventListener("end", () => {
        this.session = null;
        for (const v of [clip, hairClip]) {
          v.pause();
          v.removeAttribute("src");
        }
        this.onChange();
      });
      this.onChange();
      return runSession(session, this.right!, this.left!, () => this.captureTime, clip, hairClip, face, mode, onMode).then(
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
  hairClip: HTMLVideoElement,
  facePromise: Promise<FaceData>,
  startMode: HairMode,
  onMode?: (m: HairMode) => void,
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
  const hairTex = new THREE.VideoTexture(hairClip);
  hairTex.colorSpace = THREE.SRGBColorSpace;
  // fromHair: draw the face from hair.mp4's colour square instead (faceToHair maps it there).
  const faceUniforms = {
    map: { value: tex as THREE.Texture },
    fromHair: { value: 0 },
    faceToHair: { value: new THREE.Vector3(0, 0, 1) },
  };
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      uniforms: faceUniforms,
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
        uniform float fromHair;
        uniform vec3 faceToHair;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vec2 t = vUv;
          if (fromHair > 0.5) {
            // face-crop (u, v down) -> hair square -> its colour tile (top half, flipY)
            vec2 h = faceToHair.xy + faceToHair.z * vec2(vUv.x, 1.0 - vUv.y);
            t = vec2(h.x, 1.0 - 0.5 * h.y);
          }
          vec3 c = texture2D(map, t).rgb;
          gl_FragColor = vec4(c * vAlpha, vAlpha); // premultiplied
        }`,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false, // over the hair shell, which sits partly in front of the cheeks
      side: THREE.DoubleSide,
    }),
  );
  mesh.renderOrder = 3;
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false; // positions change every frame
  mesh.visible = false;
  scene.add(mesh);
  let faceFrame = -1;
  let lastUseHair = false;

  // Hair: an ellipsoid head shell + a backing card, in the clip's stabilised head space (same
  // as the face mesh, so the same fit matrix places them). Each vertex looks its hair up in
  // hair.mp4 through the current frame's affine; the mask (bottom half) is the alpha.
  const rowU = new THREE.Vector4();
  const rowV = new THREE.Vector4();
  const hairMaterial = (writeDepth: boolean) =>
    new THREE.ShaderMaterial({
      uniforms: { map: { value: hairTex }, rowU: { value: rowU }, rowV: { value: rowV } },
      vertexShader: /* glsl */ `
        uniform vec4 rowU;
        uniform vec4 rowV;
        varying vec2 hUv;
        void main() {
          vec4 q = vec4(position, 1.0);
          hUv = vec2(dot(rowU, q), dot(rowV, q));
          gl_Position = projectionMatrix * modelViewMatrix * q;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 hUv;
        void main() {
          if (hUv.x < 0.0 || hUv.x > 1.0 || hUv.y < 0.0 || hUv.y > 1.0) discard;
          vec3 c = texture2D(map, vec2(hUv.x, 1.0 - 0.5 * hUv.y)).rgb;
          float m = texture2D(map, vec2(hUv.x, 0.5 - 0.5 * hUv.y)).r;
          float a = clamp((m - 0.25) / 0.5, 0.0, 1.0);
          gl_FragColor = vec4(c * a, a); // premultiplied
        }`,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: writeDepth,
    });
  const hairGroup = new THREE.Group();
  hairGroup.matrixAutoUpdate = false;
  hairGroup.visible = false;
  scene.add(hairGroup);
  let hairBuilt = false;
  const buildHair = (f: FaceData) => {
    hairBuilt = true;
    const sh = headShell(f.positions.subarray(0, 468 * 3));
    const [cx, cy, cz] = sh.center;
    const [rx, ry, rz] = sh.radii;
    // Shell: front faces only, writes depth so the card behind it only shows OUTSIDE the head.
    const shellGeo = new THREE.SphereGeometry(1, 48, 32);
    shellGeo.scale(rx, ry, rz);
    shellGeo.translate(cx, cy, cz);
    const shell = new THREE.Mesh(shellGeo, hairMaterial(true));
    shell.renderOrder = 1;
    shell.frustumCulled = false;
    // Card: catches hair outside the skull outline (hanging down, volume at the sides).
    const cardGeo = new THREE.PlaneGeometry(rx * 6, ry * 6);
    cardGeo.translate(cx, cy - ry, cz);
    const card = new THREE.Mesh(cardGeo, hairMaterial(false));
    card.renderOrder = 2;
    card.frustumCulled = false;
    hairGroup.add(shell, card);
  };
  let mode: HairMode = startMode;
  let modeShownAt = -1e9;
  let modeNote = "";

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
  };
  session.addEventListener("select", reanchor);
  session.addEventListener("squeeze", reanchor);

  const viewer = new THREE.Matrix4();
  const viewerPos = new THREE.Vector3();
  const v = new THREE.Vector3();
  let lastExit = false;
  let lastCycle = false;

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

      // A/X (button 4) cycles Face → Face + hair → Hair.
      let cycle = false;
      for (const src of session.inputSources) if (src.gamepad?.buttons[4]?.pressed) cycle = true;
      if (cycle && !lastCycle) {
        mode = nextHairMode(mode);
        modeShownAt = t;
        onMode?.(mode);
      }
      lastCycle = cycle;

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
          hairGroup.matrix.copy(mesh.matrix);
          hairGroup.matrixWorldNeedsUpdate = true;
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
          if (t - modeShownAt < 2000) setHud(HAIR_MODE_LABEL[mode], modeNote);
          else if (t - lockedAt < 3000) setHud("Trigger to re-anchor", "A/X: face / hair   B/Y: leave");
          else setHud("", "");
          break;
      }
      hud.visible = !!hudText.split("|")[0];
      v.set(0, -0.2, -0.6).applyMatrix4(viewer);
      hud.position.copy(v);
      hud.lookAt(viewerPos);
    }
    if (face) {
      const f = face as FaceData;
      if (f.hair && !hairBuilt) buildHair(f);
      // Hair modes draw everything from hair.mp4, so face and hair are always the same frame.
      const wantsHair = mode !== "face";
      const useHair = wantsHair && !!f.hair && hairClip.readyState >= 2;
      modeNote = wantsHair && !f.hair ? "this loop has no hair yet — re-prepare it" : "";
      const placed = phase === "locked";
      mesh.visible = placed && (mode !== "hair" || !useHair);
      hairGroup.visible = placed && useHair;
      faceUniforms.map.value = useHair ? hairTex : tex;
      faceUniforms.fromHair.value = useHair ? 1 : 0;
      if (f.hair) faceUniforms.faceToHair.value.fromArray(f.hair.faceToHair);
      const src = useHair ? hairClip : clip;
      const fi = Math.floor(src.currentTime * f.fps) % f.frames;
      if (placed && (fi !== faceFrame || useHair !== lastUseHair)) {
        faceFrame = fi;
        lastUseHair = useHair;
        frameAttributes(f.positions, f.uvs, fi, pos, uv, oval);
        geo.attributes.position.needsUpdate = true;
        geo.attributes.uv.needsUpdate = true;
        if (f.hair) {
          const [u, v] = hairRows(f.hair.rows, fi);
          rowU.fromArray(u);
          rowV.fromArray(v);
        }
      }
    }
    renderer.render(scene, camera);
  });

  session.addEventListener("end", () => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    tex.dispose();
    hairTex.dispose();
    hudTex.dispose();
    host.remove();
  });
}
