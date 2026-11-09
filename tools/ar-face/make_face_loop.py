"""Cut a face loop from a clip: stable square crop around the face, ping-pong for a seamless
loop, plus MediaPipe landmarks for every output frame (the texture coordinates the AR page uses).

usage: make_face_loop.py MODEL CLIP START END SIZE OUT_DIR [--seamless]

--seamless: the clip already loops (first frame == last, e.g. a portrait-animation loop), so it is
used as-is instead of ping-ponged.
"""
import json, subprocess, sys
import cv2, numpy as np, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions

model, clip, t0, t1, size, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5]), sys.argv[6]
SEAMLESS = "--seamless" in sys.argv[7:]
cap = cv2.VideoCapture(clip); fps = cap.get(cv2.CAP_PROP_FPS) or 24
cap.set(cv2.CAP_PROP_POS_MSEC, t0 * 1000)
frames = []
while cap.get(cv2.CAP_PROP_POS_MSEC) < t1 * 1000:
    ok, fr = cap.read()
    if not ok: break
    frames.append(fr)
H, W = frames[0].shape[:2]

def detector():
    return vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.VIDEO, num_faces=1))

# Pass 1: landmarks on the source frames -> one stable crop box for the whole loop.
d = detector(); boxes = []
for i, fr in enumerate(frames):
    r = d.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)), int(i * 1000 / fps))
    p = r.face_landmarks[0]
    xs = [q.x * W for q in p]; ys = [q.y * H for q in p]
    boxes.append((min(xs), min(ys), max(xs), max(ys)))
d.close()
b = np.array(boxes); x0, y0, x1, y1 = b[:, 0].min(), b[:, 1].min(), b[:, 2].max(), b[:, 3].max()
side = max(x1 - x0, y1 - y0) * 1.25; cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
sx, sy = int(max(0, cx - side / 2)), int(max(0, cy - side / 2)); side = int(min(side, W - sx, H - sy))
crops = [cv2.resize(fr[sy:sy + side, sx:sx + side], (size, size), interpolation=cv2.INTER_AREA) for fr in frames]
# ping-pong (f0..fN-1, fN-2..f1) loops a cut without a jump; a seamless source is used as-is
# (minus its last frame, which repeats the first).
seq = crops[:-1] if SEAMLESS else crops + crops[-2:0:-1]

# Pass 2: landmarks on the exact frames that get encoded (texture coordinates).
d = detector(); lms = []
for i, c in enumerate(seq):
    r = d.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(c, cv2.COLOR_BGR2RGB)), int(i * 1000 / fps))
    if not r.face_landmarks:
        lms.append(lms[-1] if lms else None); continue
    lms.append([v for q in r.face_landmarks[0] for v in (round(q.x, 4), round(q.y, 4))])
d.close()
assert all(lms), "face lost in some frame"

import os; os.makedirs(out, exist_ok=True)
raw = f"{out}/raw.mp4"
vw = cv2.VideoWriter(raw, cv2.VideoWriter_fourcc(*"mp4v"), fps, (size, size))
for c in seq: vw.write(c)
vw.release()
# H.264, yuv420p, faststart: what Quest Browser's <video> decodes reliably.
# (Fedora's ffmpeg has no libx264; OpenH264 at a generous bitrate is fine for a 512² face.)
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", raw, "-c:v", "libopenh264", "-pix_fmt", "yuv420p",
                "-b:v", "4M", "-movflags", "+faststart", f"{out}/loop.mp4"], check=True)
os.remove(raw)
json.dump({"source": clip.split("/")[-1], "start": t0, "end": t1, "fps": fps, "size": size, "frames": len(seq),
           "pingpong": not SEAMLESS, "landmarks": lms}, open(f"{out}/landmarks.json", "w"), separators=(",", ":"))
cv2.imwrite(f"{out}/poster.jpg", seq[0])
print(f"{len(seq)} frames @ {fps} fps = {len(seq)/fps:.2f}s, crop {side}px -> {size}px")

# ---- Per-frame stabilised 3D shape (console#739) -------------------------------------------
# The AR page drives the mesh SHAPE from the clip (so an open mouth really opens) and only
# rigidly places it on the mannequin. Here each frame's 3D landmarks are similarity-aligned to
# frame 0 on expression-free anchor points, which removes the clip's own head motion.
ANCHORS = [33, 133, 362, 263, 168, 6, 197, 195, 5, 4, 1, 10, 151, 9, 8, 116, 345, 123, 352, 234, 454]

def to3d(flat_xy, zs):
    # MediaPipe image frame (x right, y down, z away) -> right-handed (x right, y up, z toward camera), px units.
    a = np.array(flat_xy).reshape(-1, 2) * size
    return np.stack([a[:, 0], -a[:, 1], -np.array(zs) * size], axis=1)

def umeyama(src, dst):
    mu_s, mu_d = src.mean(0), dst.mean(0); s0, d0 = src - mu_s, dst - mu_d
    U, S_, Vt = np.linalg.svd(d0.T @ s0 / len(src))
    D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ D @ Vt; sc = np.trace(np.diag(S_) @ D) / (s0 ** 2).sum(axis=1).mean()
    return sc, R, mu_d - sc * R @ mu_s

# Re-detect to get z (pass 2 kept only x,y).
d = detector(); shapes = []
for i, c in enumerate(seq):
    r = d.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(c, cv2.COLOR_BGR2RGB)), int(i * 1000 / fps))
    p = r.face_landmarks[0] if r.face_landmarks else None
    shapes.append(to3d(lms[i], [q.z for q in p]) if p else shapes[-1])
d.close()
ref = shapes[0]; stab = []
for P in shapes:
    sc, R, t = umeyama(P[ANCHORS], ref[ANCHORS])
    stab.append((sc * (R @ P.T)).T + t)
resid = np.mean([np.linalg.norm(Q[ANCHORS] - ref[ANCHORS], axis=1).mean() for Q in stab])
centre = ref[ANCHORS].mean(0)
pos = np.stack([Q[:468] - centre for Q in stab]).astype(np.float32)          # frames x 468 x 3 (px, centred)
uv = np.stack([np.array(l).reshape(-1, 2)[:468] for l in lms]).astype(np.float32)  # frames x 468 x 2

# Temporal smoothing (console#739 pass 2): MediaPipe landmarks flicker ~0.7 px frame to frame,
# which shows as texture shimmer. A circular Gaussian over time (the ping-pong loop is circular)
# removes it; expressions change over many frames, so nothing visible is lost. Shape and UVs get
# the same filter so the texture stays registered to the mesh.
SIGMA = 1.2
k = np.exp(-0.5 * (np.arange(-3, 4) / SIGMA) ** 2); k /= k.sum()
def smooth(a):
    return sum(w * np.roll(a, s, axis=0) for s, w in zip(range(-3, 4), k)).astype(np.float32)
pos, uv = smooth(pos), smooth(uv)
with open(f"{out}/face.bin", "wb") as f:
    f.write(pos.tobytes()); f.write(uv.tobytes())
json.dump({"source": clip.split("/")[-1], "start": t0, "end": t1, "fps": fps, "size": size, "frames": len(seq),
           "pingpong": not SEAMLESS, "vertices": 468, "anchors": ANCHORS, "units": "px of the 512 crop, centred on the anchor centroid",
           "layout": "float32: positions[frames][468][3] then uvs[frames][468][2]",
           "anchorResidualPx": round(float(resid), 3)}, open(f"{out}/face.json", "w"), indent=1)
print(f"stabilised: mean anchor residual {resid:.2f}px; face.bin {pos.nbytes + uv.nbytes} bytes")
