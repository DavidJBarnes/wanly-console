import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getHologram, getFileUrl } from "../api/client";
import type { HologramManifest } from "../api/types";
import {
  DEFAULT_AR_SETTINGS,
  EDGE_DEFAULTS,
  flattenYaw,
  followTarget,
  nextEasing,
  shortestAngleDelta,
  smoothing,
} from "../lib/arFollow";
import type { ArSettings, LockMode } from "../lib/arFollow";

// Full-screen WebXR immersive-ar player: places a finalized clip's matted subject
// (packed color+alpha) life-size on the real floor via Quest 3 passthrough. Tier-0 flat/mono.

// Lock modes, settings shape and the follow maths live in ../lib/arFollow so they can be tested
// without a headset — see the note there.

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Recombine: sample color + alpha from the packed frame via manifest UV rects. The video
// texture uses flipY=false (top-left origin) to match the manifest, so flip vUv.y here.
const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform vec4 colorRect;   // x, y, w, h in texture UV
  uniform vec4 alphaRect;
  uniform float edgeMin;
  uniform float edgeMax;
  varying vec2 vUv;
  void main() {
    vec2 cuv = vec2(colorRect.x + vUv.x * colorRect.z, colorRect.y + (1.0 - vUv.y) * colorRect.w);
    vec2 auv = vec2(alphaRect.x + vUv.x * alphaRect.z, alphaRect.y + (1.0 - vUv.y) * alphaRect.w);
    vec3 color = texture2D(map, cuv).rgb;
    float a = smoothstep(edgeMin, edgeMax, texture2D(map, auv).r);
    gl_FragColor = vec4(color * a, a); // premultiplied
  }
`;

// 2.5d_depth: subdivided plane whose vertices are pushed toward the viewer by the packed depth
// region (bright = near). GLSL3 so we can use textureLod (vertex-stage texture fetch needs an
// explicit LOD). The 2d path above stays on the default GLSL1 shaders.
const DEPTH_VERTEX = /* glsl */ `
  uniform sampler2D map;
  uniform vec4 depthRect;
  uniform float depthScale;
  out vec2 vUv;
  void main() {
    vUv = uv;
    vec2 duv = vec2(depthRect.x + uv.x * depthRect.z, depthRect.y + (1.0 - uv.y) * depthRect.w);
    float d = textureLod(map, duv, 0.0).r; // 0 = far/background, 1 = nearest
    vec3 p = position + vec3(0.0, 0.0, d * depthScale);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const DEPTH_FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform vec4 colorRect;
  uniform vec4 alphaRect;
  uniform vec4 depthRect;
  uniform float depthScale;
  uniform vec2 depthTexel;     // one packed-texture texel in UV
  uniform vec2 worldPerTexel;  // meters one depth texel spans on the mesh
  uniform float edgeMin;
  uniform float edgeMax;
  in vec2 vUv;
  out vec4 fragColor;
  void main() {
    vec2 cuv = vec2(colorRect.x + vUv.x * colorRect.z, colorRect.y + (1.0 - vUv.y) * colorRect.w);
    vec2 auv = vec2(alphaRect.x + vUv.x * alphaRect.z, alphaRect.y + (1.0 - vUv.y) * alphaRect.w);
    float ra = texture(map, auv).r;
    // Hard-clip at the matte boundary (edgeMin = the crop threshold). Kills the translucent
    // "skirt" of stretched triangles the displaced mesh drapes across the subject's silhouette.
    if (ra < edgeMin) discard;
    vec3 color = texture(map, cuv).rgb;
    // Cheap lambert from the depth gradient: without it the displaced surface is unlit and the
    // relief is invisible unless the viewer moves — shading gives a monocular depth cue.
    // Wide stencil + flattened normal + mostly-ambient light: the depth region is 8-bit and
    // h264-compressed, and aggressive shading amplifies that noise into contour streaks.
    vec2 duv = vec2(depthRect.x + vUv.x * depthRect.z, depthRect.y + (1.0 - vUv.y) * depthRect.w);
    vec2 s = depthTexel * 3.0;
    float dl = texture(map, duv - vec2(s.x, 0.0)).r;
    float dr = texture(map, duv + vec2(s.x, 0.0)).r;
    float dt = texture(map, duv - vec2(0.0, s.y)).r; // smaller v = up on the mesh
    float db = texture(map, duv + vec2(0.0, s.y)).r;
    float dzdx = (dr - dl) * depthScale / (6.0 * worldPerTexel.x);
    float dzdy = (dt - db) * depthScale / (6.0 * worldPerTexel.y);
    vec3 normal = normalize(vec3(-dzdx, -dzdy, 1.5));
    vec3 lightDir = normalize(vec3(0.35, 0.6, 1.0)); // upper-front, mesh-local
    float shade = clamp(0.7 + 0.35 * max(dot(normal, lightDir), 0.0), 0.0, 1.05);
    color *= shade;
    float a = smoothstep(edgeMin, edgeMax, ra); // tight inner AA only, no wide soft halo
    fragColor = vec4(color * a, a); // premultiplied
  }
`;

function radialShadowTexture(): THREE.Texture {
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.7, "rgba(0,0,0,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The life-size subject mesh (video texture + tier shaders), shared by the AR session and
// the desktop 3D preview so both render the exact same thing.
function buildHologramMesh(
  manifest: HologramManifest,
  videoUrl: string,
  onVideoError?: (message: string) => void,
  edge?: { edgeMin: number; edgeMax: number },
) {
  // Video → texture (packed color+alpha). crossOrigin BEFORE src so the fetch is CORS-mode
  // from the start — the WebGL texture upload requires a CORS-clean video.
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.addEventListener("error", () => {
    const msg = `hologram video failed to load${video.error ? `: ${video.error.message}` : ""}`;
    console.error(msg, video.error);
    onVideoError?.(msg);
  });
  video.src = videoUrl;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  const videoTex = new THREE.VideoTexture(video);
  videoTex.flipY = false;
  videoTex.colorSpace = THREE.SRGBColorSpace;
  videoTex.minFilter = THREE.LinearFilter;
  videoTex.magFilter = THREE.LinearFilter;

  const c = manifest.region_color_uv;
  const a = manifest.region_alpha_uv;
  const depthRect = manifest.region_depth_uv;
  // Tier decision: trust the manifest's structural fields, not just the flavor label.
  const isDepth = !!depthRect && (manifest.tier === 1 || manifest.flavor === "2.5d_depth");

  // Life-size mesh: height = subject_height_m, width from crop aspect. The depth flavor uses a
  // subdivided plane so the vertex shader can displace it into relief; 2d stays a single quad.
  const height = manifest.subject_height_m || 1.7;
  const aspect = manifest.crop_rect.w / manifest.crop_rect.h;
  const width = height * aspect;

  // Half-texel inset: the manifest rects span texel edges, so sampling at uv 0/1 lands on the
  // boundary with the black guard band and linear filtering blends it in (dark edge column).
  const tx = 0.5 / manifest.video_width;
  const inset = (r: { x: number; y: number; w: number; h: number }) =>
    new THREE.Vector4(r.x + tx, r.y, r.w - 2 * tx, r.h);

  const edgeDefaults = isDepth ? EDGE_DEFAULTS.depth : EDGE_DEFAULTS.flat;
  const uniforms: Record<string, { value: unknown }> = {
    map: { value: videoTex },
    colorRect: { value: inset(c) },
    alphaRect: { value: inset(a) },
    edgeMin: { value: edge?.edgeMin ?? edgeDefaults.edgeMin },
    edgeMax: { value: edge?.edgeMax ?? edgeDefaults.edgeMax },
  };
  if (isDepth && depthRect) {
    uniforms.depthRect = { value: inset(depthRect) };
    uniforms.depthScale = { value: manifest.depth_scale_m ?? 0.3 };
    uniforms.depthTexel = {
      value: new THREE.Vector2(1 / manifest.video_width, 1 / manifest.video_height),
    };
    // Meters spanned by one depth-region texel on the mesh (for the shading gradient).
    uniforms.worldPerTexel = {
      value: new THREE.Vector2(
        (width * (1 / manifest.video_width)) / depthRect.w,
        (height * (1 / manifest.video_height)) / depthRect.h,
      ),
    };
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: isDepth ? DEPTH_VERTEX : VERTEX,
    fragmentShader: isDepth ? DEPTH_FRAGMENT : FRAGMENT,
    glslVersion: isDepth ? THREE.GLSL3 : undefined,
    transparent: true,
    premultipliedAlpha: true,
    side: THREE.DoubleSide,
    // Tier-1 writes depth so the displaced relief self-occludes (a real monocular cue);
    // the flat quad keeps depthWrite off as before.
    depthWrite: isDepth,
  });
  const geometry = isDepth
    ? new THREE.PlaneGeometry(width, height, 96, 160)
    : new THREE.PlaneGeometry(width, height);
  const quad = new THREE.Mesh(geometry, material);
  quad.position.y = height / 2; // base sits on the floor

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(width * 0.55, 48),
    new THREE.MeshBasicMaterial({ map: radialShadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;

  const dispose = () => {
    video.pause();
    videoTex.dispose();
    material.dispose();
    geometry.dispose();
    shadow.geometry.dispose();
    (shadow.material as THREE.Material).dispose();
  };
  return { video, quad, shadow, width, height, isDepth, uniforms, edgeDefaults, dispose };
}

function startPreview(
  container: HTMLDivElement,
  manifest: HologramManifest,
  videoUrl: string,
  onVideoError?: (message: string) => void,
  settingsRef?: { current: ArSettings },
): () => void {
  const holo = buildHologramMesh(manifest, videoUrl, onVideoError, settingsRef?.current);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14181c);
  scene.add(new THREE.GridHelper(6, 12, 0x2a3138, 0x20262c));
  scene.add(holo.shadow);
  scene.add(holo.quad);

  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / container.clientHeight,
    0.05,
    50,
  );
  camera.position.set(0, holo.height * 0.6, Math.max(holo.height * 1.4, 1.5));

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, holo.height * 0.55, 0);
  controls.enableDamping = true;
  controls.minDistance = 0.4;
  controls.maxDistance = 8;
  controls.update();

  holo.video.play().catch(() => undefined);
  renderer.setAnimationLoop(() => {
    // Same live edge uniforms as AR, so the matte cut can be dialled in on a desktop before
    // burning a headset session on it.
    if (settingsRef) {
      holo.uniforms.edgeMin.value = settingsRef.current.edgeMin;
      holo.uniforms.edgeMax.value = settingsRef.current.edgeMax;
    }
    controls.update();
    renderer.render(scene, camera);
  });

  const onResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener("resize", onResize);

  return () => {
    window.removeEventListener("resize", onResize);
    renderer.setAnimationLoop(null);
    controls.dispose();
    holo.dispose();
    renderer.dispose();
    if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
  };
}

async function startArSession(
  container: HTMLDivElement,
  overlay: HTMLElement,
  manifest: HologramManifest,
  videoUrl: string,
  onEnd: () => void,
  onSession: (s: XRSession) => void,
  settingsRef: { current: ArSettings },
  onOverlayState: (type: string | null) => void,
): Promise<void> {
  const xr = (navigator as unknown as { xr: XRSystem }).xr;

  const holo = buildHologramMesh(manifest, videoUrl, undefined, settingsRef.current);
  const { video } = holo;

  const group = new THREE.Group();
  group.add(holo.quad);
  group.add(holo.shadow);
  group.visible = false;

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;

  const scene = new THREE.Scene();
  scene.add(reticle);
  scene.add(group);

  const camera = new THREE.PerspectiveCamera();
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");
  container.appendChild(renderer.domElement);

  const session = await xr.requestSession("immersive-ar", {
    requiredFeatures: ["local-floor", "hit-test"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: overlay },
  } as XRSessionInit);
  await renderer.xr.setSession(session);
  onSession(session);
  // dom-overlay is an OPTIONAL feature — a UA is free to start the session without it, in which
  // case the overlay root is never composited and every in-session control is silently
  // unreachable. Report it so the failure is legible instead of looking like a broken panel.
  onOverlayState(
    (session as unknown as { domOverlayState?: { type?: string } }).domOverlayState?.type ?? null,
  );
  video.play().catch(() => undefined);

  const viewerSpace = await session.requestReferenceSpace("viewer");
  const hitSource = await (
    session as unknown as {
      requestHitTestSource: (o: { space: XRReferenceSpace }) => Promise<XRHitTestSource>;
    }
  ).requestHitTestSource({ space: viewerSpace });

  let placedOnce = false;
  const place = () => {
    if (!reticle.visible) return;
    group.position.setFromMatrixPosition(reticle.matrix);
    // Face the user (yaw only) at placement, then stay put.
    const viewerPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    group.rotation.y = Math.atan2(viewerPos.x - group.position.x, viewerPos.z - group.position.z);
    group.visible = true;
    placedOnce = true;
    reticle.visible = false; // done placing — don't leave a cyan ring on the floor
  };
  session.addEventListener("select", place);

  // Follow-mode scratch: allocated once, the loop runs at display rate and must not churn GC.
  const camPos = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  const camScale = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const target = new THREE.Vector3();
  const lastYawFwd = new THREE.Vector3(0, 0, -1); // held heading for the near-vertical gaze case
  let easing = false; // deadzone hysteresis: latched on when we drift out, off when we arrive
  // Starts true, not false: a session restored straight into a follow mode would otherwise glide
  // in from the world origin on the first frame instead of simply being there.
  let snapNext = true; // first frame of a mode change — jump, don't glide in from wherever
  let lastMode: LockMode = settingsRef.current.lockMode;
  let lastT = 0;

  renderer.setAnimationLoop((t: number, frame?: XRFrame) => {
    const s = settingsRef.current;
    // Frame-rate independent smoothing needs real elapsed time, clamped so a dropped frame or a
    // backgrounded session doesn't teleport the clip on resume.
    const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 1 / 72;
    lastT = t;

    if (s.lockMode !== lastMode) {
      snapNext = true;
      easing = false;
      lastMode = s.lockMode;
    }

    holo.uniforms.edgeMin.value = s.edgeMin;
    holo.uniforms.edgeMax.value = s.edgeMax;

    if (s.lockMode === "placed") {
      // Original behaviour, untouched: reticle until the tap, then frozen in the room.
      holo.shadow.visible = true;
      group.visible = placedOnce;
      if (frame && !placedOnce) {
        const refSpace = renderer.xr.getReferenceSpace();
        const results = frame.getHitTestResults(hitSource);
        if (refSpace && results.length) {
          const pose = results[0].getPose(refSpace);
          if (pose) {
            reticle.visible = true;
            reticle.matrix.fromArray(pose.transform.matrix);
          }
        } else {
          reticle.visible = false;
        }
      }
    } else {
      // Viewer-locked. No placement gesture, no reticle, and no contact shadow — the clip is not
      // standing on the floor any more, so a floor shadow would sit under nothing.
      reticle.visible = false;
      holo.shadow.visible = false;
      group.visible = true;

      camera.matrixWorld.decompose(camPos, camQuat, camScale);
      fwd.set(0, 0, -1).applyQuaternion(camQuat);
      if (s.lockMode === "follow-yaw") {
        const flat = flattenYaw(fwd);
        // null = looking near-vertically, where the horizontal bearing is noise. Hold the heading
        // we already had rather than letting the clip snap to an arbitrary direction.
        if (flat) lastYawFwd.set(flat.x, flat.y, flat.z);
        fwd.copy(lastYawFwd);
      }
      const t2 = followTarget(camPos, fwd, s, holo.height);
      target.set(t2.x, t2.y, t2.z);

      const err = group.position.distanceTo(target);
      if (snapNext) {
        group.position.copy(target);
        easing = false;
      } else {
        easing = nextEasing(easing, err, s.followDeadzone);
        if (easing) group.position.lerp(target, smoothing(s.followTightness, dt));
      }

      // Always billboard yaw-only — a clip that pitches with your gaze reads as a decal.
      const yaw = Math.atan2(camPos.x - group.position.x, camPos.z - group.position.z);
      if (snapNext) {
        group.rotation.y = yaw;
        snapNext = false;
      } else {
        group.rotation.y +=
          shortestAngleDelta(group.rotation.y, yaw) * smoothing(s.followTightness, dt);
      }
    }
    renderer.render(scene, camera);
  });

  session.addEventListener("end", () => {
    renderer.setAnimationLoop(null);
    holo.dispose();
    renderer.dispose();
    if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    onEnd();
  });
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.85 }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {value.toFixed(2)}
          {unit ?? ""}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        // Chunky thumb: this is driven by a controller ray at arm's length, not a mouse.
        style={{ width: "100%", height: 28, accentColor: "#00e5ff" }}
      />
    </label>
  );
}

// Lives inside the dom-overlay during AR so every knob is reachable without ending the session —
// the whole point is to settle these values by looking at them in the headset.
function TuningPanel({
  settings,
  onChange,
  open,
  onToggle,
  showLock,
  edgeDefaults,
}: {
  settings: ArSettings;
  onChange: (patch: Partial<ArSettings>) => void;
  open: boolean;
  onToggle: () => void;
  showLock: boolean;
  edgeDefaults: { edgeMin: number; edgeMax: number };
  // Rendered in normal flow instead of pinned to a corner. Used on the pre-AR landing screen,
  // which is ordinary page DOM — so the mode can be chosen even when the in-session overlay
  // fails to render, as it does under the WebXR emulator.
  inline?: boolean;
}) {
  const modes: { id: LockMode; label: string; hint: string }[] = [
    { id: "placed", label: "Placed", hint: "Tap the floor. Stays in the room." },
    { id: "follow", label: "Follow", hint: "Holds station ahead of you. Look down, it follows." },
    { id: "follow-yaw", label: "Follow (yaw)", hint: "Turning carries it. Looking down does not." },
  ];
  const active = modes.find((m) => m.id === settings.lockMode);
  const isFollow = settings.lockMode !== "placed";

  return (
    <div
      // Top-left, not bottom-left: the WebXR emulator's "Controller [L]" inspector occupies the
      // bottom-left corner, and that extension is exactly where this gets iterated on. Its UI is
      // injected at document level so it cannot be out-stacked from in here — the only fix is to
      // not be underneath it. Sits below the tier chip, which is clear in the headset too.
      style={{
        position: inline ? "relative" : "absolute",
        left: inline ? undefined : 20,
        top: inline ? undefined : 64,
        width: inline ? "min(320px, 86vw)" : open ? 300 : "auto",
        textAlign: "left",
        maxHeight: inline ? undefined : "calc(100vh - 88px)",
        overflowY: inline ? undefined : "auto",
        pointerEvents: "auto",
        background: "rgba(0,0,0,0.72)",
        color: "#fff",
        borderRadius: 12,
        padding: open ? 16 : "10px 14px",
        fontSize: 13,
        zIndex: 3,
      }}
    >
      <button
        onClick={onToggle}
        style={{
          background: "none",
          border: "none",
          color: "#00e5ff",
          font: "inherit",
          fontWeight: 700,
          cursor: "pointer",
          padding: 0,
        }}
      >
        {open ? "▾" : "▸"} Tuning
        {/* Names the context. The panel is otherwise identical everywhere but silently carries
            fewer controls in preview, which reads as "the modes are missing". */}
        <span style={{ opacity: 0.55, fontWeight: 400, marginLeft: 6 }}>
          {inline ? "applies on entry" : showLock ? "AR session" : "preview"}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          {showLock && (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                {modes.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onChange({ lockMode: m.id })}
                    style={{
                      flex: 1,
                      padding: "8px 4px",
                      borderRadius: 8,
                      border: "1px solid #00e5ff",
                      background: settings.lockMode === m.id ? "#00e5ff" : "transparent",
                      color: settings.lockMode === m.id ? "#00121a" : "#00e5ff",
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 12, minHeight: 28 }}>
                {active?.hint}
              </div>
            </>
          )}

          {showLock && isFollow && (
            <>
              <Slider
                label="Distance"
                value={settings.followDistance}
                min={0.4}
                max={4}
                step={0.05}
                unit=" m"
                onChange={(v) => onChange({ followDistance: v })}
              />
              <Slider
                label="Height (vs eyeline)"
                value={settings.followHeight}
                min={-1.5}
                max={1.5}
                step={0.05}
                unit=" m"
                onChange={(v) => onChange({ followHeight: v })}
              />
              <Slider
                label="Tightness"
                value={settings.followTightness}
                min={0.3}
                max={12}
                step={0.1}
                onChange={(v) => onChange({ followTightness: v })}
              />
              <Slider
                label="Deadzone"
                value={settings.followDeadzone}
                min={0}
                max={0.8}
                step={0.01}
                unit=" m"
                onChange={(v) => onChange({ followDeadzone: v })}
              />
            </>
          )}

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.15)", margin: "6px 0 10px" }} />
          <Slider
            label="Edge cut"
            value={settings.edgeMin}
            min={0}
            max={0.98}
            step={0.01}
            onChange={(v) => onChange({ edgeMin: Math.min(v, settings.edgeMax - 0.01) })}
          />
          <Slider
            label="Edge softness"
            value={settings.edgeMax}
            min={0.02}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ edgeMax: Math.max(v, settings.edgeMin + 0.01) })}
          />
          <button
            onClick={() => onChange({ ...edgeDefaults })}
            style={{
              width: "100%",
              padding: "6px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.25)",
              background: "transparent",
              color: "rgba(255,255,255,0.75)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Reset edges
          </button>
        </div>
      )}
    </div>
  );
}

export default function HologramPlayer() {
  const { id } = useParams<{ id: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<XRSession | null>(null);
  const [manifest, setManifest] = useState<HologramManifest | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [arSupported, setArSupported] = useState<boolean | null>(null);
  const [inAr, setInAr] = useState(false);
  const [inPreview, setInPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ArSettings>({
    ...DEFAULT_AR_SETTINGS,
    ...EDGE_DEFAULTS.flat,
  });
  const [panelOpen, setPanelOpen] = useState(true);
  // null = the last session did not grant dom-overlay (or none has run yet). Surfaced on the
  // landing screen so an unreachable in-session panel reads as a refused feature, not a bug.
  const [overlayType, setOverlayType] = useState<string | null>(null);
  const [sessionRan, setSessionRan] = useState(false);
  // The render loop samples this every frame; state alone would mean re-entering the session to
  // pick up a slider change.
  const settingsRef = useRef<ArSettings>(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!id) return;
        const paths = await getHologram(id);
        // Version param busts the cached /files redirect: hologram artifacts live at fixed S3
        // keys, so without it a remake replays the previous flavor's video + manifest for hours.
        const v = paths.version ?? undefined;
        const res = await fetch(getFileUrl(paths.manifest_path, v));
        if (!res.ok) throw new Error(`manifest ${res.status}`);
        const m: HologramManifest = await res.json();
        if (cancelled) return;
        setManifest(m);
        setVideoUrl(getFileUrl(paths.video_path, v));
        setPosterUrl(getFileUrl(paths.poster_path, v));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load hologram");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const xr = (navigator as unknown as { xr?: XRSystem }).xr;
    if (!window.isSecureContext || !xr) {
      setArSupported(false);
      return;
    }
    xr.isSessionSupported("immersive-ar")
      .then((ok) => setArSupported(ok))
      .catch(() => setArSupported(false));
  }, []);

  // Edge defaults are tier-dependent, so they can only be resolved once the manifest is in. Any
  // values already tuned for this hologram win over the defaults.
  useEffect(() => {
    if (!manifest || !id) return;
    const isDepth =
      !!manifest.region_depth_uv && (manifest.tier === 1 || manifest.flavor === "2.5d_depth");
    const base: ArSettings = {
      ...DEFAULT_AR_SETTINGS,
      ...(isDepth ? EDGE_DEFAULTS.depth : EDGE_DEFAULTS.flat),
    };
    let stored: Partial<ArSettings> = {};
    try {
      const raw = localStorage.getItem(`ar-settings:${id}`);
      if (raw) stored = JSON.parse(raw) as Partial<ArSettings>;
    } catch {
      /* corrupt or unavailable storage — fall back to defaults */
    }
    setSettings({ ...base, ...stored });
  }, [manifest, id]);

  // Persist per hologram. Deliberately localStorage and not a Segment column: the point of the
  // sliders is to find out what the defaults should be, and there is no sense migrating a schema
  // around numbers nobody has confirmed in a headset yet.
  useEffect(() => {
    if (!id || !manifest) return;
    try {
      localStorage.setItem(`ar-settings:${id}`, JSON.stringify(settings));
    } catch {
      /* private mode / quota — tuning still works, it just won't survive a reload */
    }
  }, [id, manifest, settings]);

  // Desktop 3D preview: same mesh + shaders as AR, orbited with the mouse instead of your feet.
  useEffect(() => {
    if (!inPreview || !manifest || !videoUrl || !containerRef.current) return;
    const stop = startPreview(
      containerRef.current,
      manifest,
      videoUrl,
      (msg) => {
        setInPreview(false);
        setError(msg);
      },
      settingsRef,
    );
    return stop;
  }, [inPreview, manifest, videoUrl]);

  const enterAR = async () => {
    if (!manifest || !videoUrl || !containerRef.current || !overlayRef.current) return;
    try {
      setInAr(true);
      setSessionRan(true);
      await startArSession(
        containerRef.current,
        overlayRef.current,
        manifest,
        videoUrl,
        () => {
          sessionRef.current = null;
          setInAr(false);
        },
        (s) => {
          sessionRef.current = s;
        },
        settingsRef,
        setOverlayType,
      );
    } catch (e) {
      setInAr(false);
      setError(e instanceof Error ? e.message : "Could not start AR session");
    }
  };

  // What's ACTUALLY playing (from the fetched manifest, not the DB label) — makes a stale
  // cache or silent tier downgrade visible instead of a mystery "looks the same".
  const tierLabel = manifest
    ? manifest.tier === 1 && manifest.region_depth_uv
      ? `2.5D depth · relief ${(manifest.depth_scale_m ?? 0.3).toFixed(2)} m`
      : "2D flat"
    : null;

  const isDepth =
    !!manifest?.region_depth_uv && (manifest?.tier === 1 || manifest?.flavor === "2.5d_depth");
  const edgeDefaults = isDepth ? EDGE_DEFAULTS.depth : EDGE_DEFAULTS.flat;
  const patch = (p: Partial<ArSettings>) => setSettings((s) => ({ ...s, ...p }));

  const wrap: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "#0b0b0f",
    color: "#eee",
    fontFamily: "system-ui, sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    textAlign: "center",
    padding: 24,
  };

  return (
    <div ref={containerRef} style={{ position: "fixed", inset: 0 }}>
      {/* dom-overlay content (transport UI could live here during AR) */}
      {/* zIndex is load-bearing: startArSession appends the WebGL canvas as a later sibling of
          this div, so with both at z-index auto the canvas paints over the whole overlay and
          every control here vanishes. A real headset masks it — the UA promotes the dom-overlay
          root into the XR compositor — but under the WebXR emulator plain CSS stacking applies
          and the overlay is simply buried. */}
      <div
        ref={overlayRef}
        style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 10 }}
      >
        {inAr && (
          <>
            {tierLabel && (
              <div
                style={{
                  position: "absolute",
                  top: 20,
                  left: 20,
                  padding: "6px 12px",
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.65)",
                  color: "#fff",
                  fontSize: 13,
                }}
              >
                {tierLabel}
              </div>
            )}
            <button
              onClick={() => sessionRef.current?.end()}
              style={{
                position: "absolute",
                top: 20,
                right: 20,
                pointerEvents: "auto",
                fontSize: 16,
                padding: "10px 18px",
                borderRadius: 8,
                border: "none",
                background: "rgba(0,0,0,0.65)",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Exit AR
            </button>
            <div style={{ position: "absolute", bottom: 24, width: "100%", textAlign: "center", color: "#fff" }}>
              {settings.lockMode === "placed"
                ? "Point at your floor and tap to place"
                : "Holding station in front of you — tune it bottom-left"}{" "}
              • tap “Exit AR” (top-right) to leave
            </div>
            <TuningPanel
              settings={settings}
              onChange={patch}
              open={panelOpen}
              onToggle={() => setPanelOpen((o) => !o)}
              showLock
              edgeDefaults={edgeDefaults}
            />
          </>
        )}
      </div>

      {inPreview && (
        <>
          {tierLabel && (
            <div
              style={{
                position: "absolute",
                top: 20,
                left: 20,
                zIndex: 2,
                padding: "6px 12px",
                borderRadius: 8,
                background: "rgba(0,0,0,0.65)",
                color: "#fff",
                fontSize: 13,
              }}
            >
              {tierLabel}
            </div>
          )}
          <button
            onClick={() => setInPreview(false)}
            style={{
              position: "absolute",
              top: 20,
              right: 20,
              zIndex: 2,
              fontSize: 16,
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: "rgba(0,0,0,0.65)",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Exit Preview
          </button>
          <div
            style={{
              position: "absolute",
              bottom: 24,
              width: "100%",
              textAlign: "center",
              zIndex: 2,
              color: "rgba(255,255,255,0.75)",
              fontSize: 14,
            }}
          >
            Drag to orbit • scroll to zoom — move around to see the relief
          </div>
          {/* Lock modes are meaningless when you're orbiting with a mouse, but the edge cut is
              the same shader — dial it in here before spending a headset session on it. */}
          <TuningPanel
            settings={settings}
            onChange={patch}
            open={panelOpen}
            onToggle={() => setPanelOpen((o) => !o)}
            showLock={false}
            edgeDefaults={edgeDefaults}
          />
        </>
      )}

      {!inAr && !inPreview && (
        <div style={wrap}>
          {error && <div style={{ color: "#ff6b6b" }}>⚠ {error}</div>}
          {posterUrl && (
            <img
              src={posterUrl}
              alt="hologram poster"
              style={{ maxHeight: "45vh", maxWidth: "80vw", objectFit: "contain" }}
            />
          )}
          {tierLabel && (
            <div
              style={{
                padding: "4px 12px",
                borderRadius: 12,
                border: "1px solid #2b3b44",
                background: "#11202a",
                color: "#7fdcff",
                fontSize: 13,
              }}
            >
              {tierLabel}
            </div>
          )}
          {/* Chosen here, before entering. The in-session panel needs dom-overlay, which is an
              optional feature the UA can refuse — under the WebXR emulator it does. This page is
              ordinary DOM, so the mode is always reachable; the render loop reads it live. */}
          {manifest && (
            <TuningPanel
              settings={settings}
              onChange={patch}
              open={panelOpen}
              onToggle={() => setPanelOpen((o) => !o)}
              showLock
              inline
              edgeDefaults={edgeDefaults}
            />
          )}
          {overlayType === null && sessionRan && (
            <div style={{ maxWidth: 360, fontSize: 13, color: "#ffb86b", lineHeight: 1.5 }}>
              That session did not grant <code>dom-overlay</code>, so the in-AR panel could not be
              shown. Set the mode here instead — it applies as soon as you enter.
            </div>
          )}
          {arSupported === true && manifest && (
            <button
              onClick={enterAR}
              style={{
                fontSize: 20,
                padding: "14px 28px",
                borderRadius: 10,
                border: "none",
                background: "#00e5ff",
                color: "#00121a",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Enter AR
            </button>
          )}
          {manifest && videoUrl && (
            <button
              onClick={() => setInPreview(true)}
              style={{
                fontSize: 16,
                padding: "10px 22px",
                borderRadius: 10,
                border: "1px solid #00e5ff",
                background: "transparent",
                color: "#00e5ff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              3D Preview
            </button>
          )}
          {arSupported === false && (
            <div style={{ maxWidth: 420, lineHeight: 1.5 }}>
              <p style={{ fontWeight: 600 }}>Open this on a Quest 3 (or WebXR headset) to place it in your room.</p>
              <p style={{ opacity: 0.7, fontSize: 14 }}>
                Immersive AR isn’t available in this browser. Preview below.
              </p>
              {videoUrl && (
                // crossOrigin here too: this element and the WebGL paths share the browser's
                // HTTP cache for the same URL, and a cached no-CORS response (no
                // Access-Control-Allow-Origin stored) poisons the later CORS-mode texture
                // fetch — the mesh then renders invisible in preview AND emulated AR.
                <video
                  src={videoUrl}
                  crossOrigin="anonymous"
                  controls
                  loop
                  muted
                  playsInline
                  style={{ maxWidth: "80vw", maxHeight: "40vh", marginTop: 12, borderRadius: 8 }}
                />
              )}
            </div>
          )}
          {arSupported === null && !error && <div style={{ opacity: 0.6 }}>Checking AR support…</div>}
        </div>
      )}
    </div>
  );
}
