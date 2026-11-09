"""Best neutral source still across clips: frontal, mouth closed, eyes open, large, sharp."""
import glob, math, sys, cv2, numpy as np, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
model, clips, out = sys.argv[1:4]
det = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=model), num_faces=1,
      output_facial_transformation_matrixes=True))
cands = []
for path in sorted(glob.glob(f"{clips}/*.mp4")):
    cap = cv2.VideoCapture(path); fps = cap.get(5) or 24; n = int(cap.get(7))
    for fi in range(0, n, 6):
        cap.set(1, fi); ok, fr = cap.read()
        if not ok: break
        r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)))
        if not r.face_landmarks: continue
        p = r.face_landmarks[0]; H, W = fr.shape[:2]
        P = lambda i: np.array([p[i].x * W, p[i].y * H])
        fh = np.linalg.norm(P(10) - P(152))
        mouth = np.linalg.norm(P(13) - P(14)) / fh
        eyes = (np.linalg.norm(P(159) - P(145)) + np.linalg.norm(P(386) - P(374))) / 2 / fh
        R = np.array(r.facial_transformation_matrixes[0])[:3, :3]
        yaw = math.degrees(math.atan2(-R[2, 0], math.hypot(R[0, 0], R[1, 0]))); pitch = math.degrees(math.atan2(R[2, 1], R[2, 2]))
        xs = [q.x * W for q in p]; ys = [q.y * H for q in p]
        sub = fr[max(0, int(min(ys))):int(max(ys)), max(0, int(min(xs))):int(max(xs))]
        if sub.size == 0: continue
        sharp = cv2.Laplacian(cv2.cvtColor(sub, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
        if mouth > 0.02 or eyes < 0.035 or abs(yaw) > 12 or abs(pitch) > 15: continue
        score = fh * (1 - abs(yaw) / 30) * (1 - abs(pitch) / 40) * min(1, sharp / 150)
        cands.append((score, path, fi, fh, yaw, pitch, mouth, eyes, sharp))
cands.sort(reverse=True)
tiles = []
for c in cands[:6]:
    print(f"{c[1].split('/')[-1][:8]} frame {c[2]} t={c[2]/24:.1f}s face {c[3]:.0f}px yaw {c[4]:.1f} pitch {c[5]:.1f} mouth {c[6]:.3f} eyes {c[7]:.3f} sharp {c[8]:.0f}")
    cap = cv2.VideoCapture(c[1]); cap.set(1, c[2]); ok, fr = cap.read()
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(fr, cv2.COLOR_BGR2RGB))); p = r.face_landmarks[0]; H, W = fr.shape[:2]
    xs = [q.x * W for q in p]; ys = [q.y * H for q in p]; cx, cy = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2; s = max(max(xs)-min(xs), max(ys)-min(ys))*0.7
    t = cv2.resize(fr[int(max(0,cy-s)):int(cy+s), int(max(0,cx-s)):int(cx+s)], (240, 240))
    cv2.putText(t, f"{c[1].split('/')[-1][:8]} f{c[2]}", (4, 16), 0, 0.5, (0, 255, 255), 1); tiles.append(t)
cv2.imwrite(out, np.hstack(tiles[:3]) if len(tiles) < 6 else np.vstack([np.hstack(tiles[:3]), np.hstack(tiles[3:6])]))
