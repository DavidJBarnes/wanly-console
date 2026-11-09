"""Score clips for a face-loop source: frontal, large, steady face. Prints the best 3 s window per clip."""
import glob, math, sys
import cv2, numpy as np, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions

MODEL, CLIPS = sys.argv[1], sys.argv[2]
WIN_S = 3.0

def euler(m):
    R = np.array(m)[:3, :3]
    yaw = math.degrees(math.atan2(-R[2, 0], math.hypot(R[0, 0], R[1, 0])))
    pitch = math.degrees(math.atan2(R[2, 1], R[2, 2]))
    return yaw, pitch

for path in sorted(glob.glob(f"{CLIPS}/*.mp4")):
    opts = vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=MODEL), running_mode=vision.RunningMode.VIDEO,
                                        num_faces=1, output_facial_transformation_matrixes=True)
    lm = vision.FaceLandmarker.create_from_options(opts)
    cap = cv2.VideoCapture(path); fps = cap.get(cv2.CAP_PROP_FPS) or 24; W = cap.get(3); H = cap.get(4)
    rows, i = [], 0
    while True:
        ok, fr = cap.read()
        if not ok: break
        if i % 2 == 0:
            r = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)), int(i * 1000 / fps))
            if r.face_landmarks:
                p = r.face_landmarks[0]
                h = math.hypot((p[152].x - p[10].x) * W, (p[152].y - p[10].y) * H)
                y, pt = euler(r.facial_transformation_matrixes[0])
                rows.append((i / fps, h, y, pt))
            else:
                rows.append((i / fps, 0, 99, 99))
        i += 1
    lm.close()
    if not rows: continue
    a = np.array(rows); n = max(1, int(WIN_S * fps / 2)); best = None
    for s in range(0, len(a) - n + 1, 2):
        w = a[s:s + n]
        if (w[:, 1] == 0).any(): continue
        frontal = (np.abs(w[:, 2]) < 20) & (np.abs(w[:, 3]) < 20)
        score = w[:, 1].mean() * frontal.mean() / (1 + w[:, 2].std() / 5 + w[:, 3].std() / 5)
        if not best or score > best[0]:
            best = (score, w[0, 0], w[:, 1].mean(), np.abs(w[:, 2]).mean(), np.abs(w[:, 3]).mean(), w[:, 2].std(), frontal.mean())
    name = path.split("/")[-1][:8]
    if best:
        print(f"{name} {int(W)}x{int(H)} score {best[0]:6.0f}  t={best[1]:5.1f}s  face {best[2]:4.0f}px  |yaw| {best[3]:4.1f} |pitch| {best[4]:4.1f}  yaw-sd {best[5]:4.1f}  frontal {best[6]:.0%}")
    else:
        print(f"{name} no full-face 3 s window")
