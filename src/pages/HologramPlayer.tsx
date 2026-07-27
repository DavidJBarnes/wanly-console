import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getHologram, getFileUrl } from "../api/client";
import type { HologramManifest } from "../api/types";

// Full-screen WebXR immersive-ar player: places a finalized clip's matted subject
// (packed color+alpha) life-size on the real floor via Quest 3 passthrough. Tier-0 flat/mono.

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
  in vec2 vUv;
  out vec4 fragColor;
  void main() {
    vec2 cuv = vec2(colorRect.x + vUv.x * colorRect.z, colorRect.y + (1.0 - vUv.y) * colorRect.w);
    vec2 auv = vec2(alphaRect.x + vUv.x * alphaRect.z, alphaRect.y + (1.0 - vUv.y) * alphaRect.w);
    float ra = texture(map, auv).r;
    // Hard-clip at the matte boundary (alpha 0.5 = the crop threshold). Kills the translucent
    // "skirt" of stretched triangles the displaced mesh drapes across the subject's silhouette.
    if (ra < 0.5) discard;
    vec3 color = texture(map, cuv).rgb;
    // Cheap lambert from the depth gradient: without it the displaced surface is unlit and the
    // relief is invisible unless the viewer moves — shading gives a monocular depth cue.
    vec2 duv = vec2(depthRect.x + vUv.x * depthRect.z, depthRect.y + (1.0 - vUv.y) * depthRect.w);
    vec2 s = depthTexel * 2.0; // 2-texel step damps 8-bit + h264 gradient noise
    float dl = texture(map, duv - vec2(s.x, 0.0)).r;
    float dr = texture(map, duv + vec2(s.x, 0.0)).r;
    float dt = texture(map, duv - vec2(0.0, s.y)).r; // smaller v = up on the mesh
    float db = texture(map, duv + vec2(0.0, s.y)).r;
    float dzdx = (dr - dl) * depthScale / (4.0 * worldPerTexel.x);
    float dzdy = (dt - db) * depthScale / (4.0 * worldPerTexel.y);
    vec3 normal = normalize(vec3(-dzdx, -dzdy, 1.0));
    vec3 lightDir = normalize(vec3(0.35, 0.6, 1.0)); // upper-front, mesh-local
    float shade = clamp(0.55 + 0.55 * max(dot(normal, lightDir), 0.0), 0.0, 1.1);
    color *= shade;
    float a = smoothstep(0.5, 0.72, ra); // tight inner AA only, no wide soft halo
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
function buildHologramMesh(manifest: HologramManifest, videoUrl: string) {
  // Video → texture (packed color+alpha). crossOrigin so the texture is CORS-clean.
  const video = document.createElement("video");
  video.src = videoUrl;
  video.crossOrigin = "anonymous";
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

  const uniforms: Record<string, { value: unknown }> = {
    map: { value: videoTex },
    colorRect: { value: inset(c) },
    alphaRect: { value: inset(a) },
    edgeMin: { value: 0.05 },
    edgeMax: { value: 0.95 },
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
  return { video, quad, shadow, width, height, isDepth, dispose };
}

function startPreview(
  container: HTMLDivElement,
  manifest: HologramManifest,
  videoUrl: string,
): () => void {
  const holo = buildHologramMesh(manifest, videoUrl);

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
): Promise<void> {
  const xr = (navigator as unknown as { xr: XRSystem }).xr;

  const holo = buildHologramMesh(manifest, videoUrl);
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
  video.play().catch(() => undefined);

  const viewerSpace = await session.requestReferenceSpace("viewer");
  const hitSource = await (
    session as unknown as {
      requestHitTestSource: (o: { space: XRReferenceSpace }) => Promise<XRHitTestSource>;
    }
  ).requestHitTestSource({ space: viewerSpace });

  const place = () => {
    if (!reticle.visible) return;
    group.position.setFromMatrixPosition(reticle.matrix);
    // Face the user (yaw only) at placement, then stay put.
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    group.rotation.y = Math.atan2(camPos.x - group.position.x, camPos.z - group.position.z);
    group.visible = true;
    reticle.visible = false; // done placing — don't leave a cyan ring on the floor
  };
  session.addEventListener("select", place);

  renderer.setAnimationLoop((_t, frame?: XRFrame) => {
    if (frame && !group.visible) {
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

  // Desktop 3D preview: same mesh + shaders as AR, orbited with the mouse instead of your feet.
  useEffect(() => {
    if (!inPreview || !manifest || !videoUrl || !containerRef.current) return;
    const stop = startPreview(containerRef.current, manifest, videoUrl);
    return stop;
  }, [inPreview, manifest, videoUrl]);

  const enterAR = async () => {
    if (!manifest || !videoUrl || !containerRef.current || !overlayRef.current) return;
    try {
      setInAr(true);
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
      <div ref={overlayRef} style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
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
              Point at your floor and tap to place • tap “Exit AR” (top-right) to leave
            </div>
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
                <video
                  src={videoUrl}
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
