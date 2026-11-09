"""Head sway in a loop: motion of expression-free landmarks across all frames, in px and ~mm; loop seam."""
import sys, cv2, numpy as np, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
model, path = sys.argv[1], sys.argv[2]
d = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.VIDEO, num_faces=1))
cap = cv2.VideoCapture(path); pts = []; frames = []; i = 0
RIGID = [33, 133, 362, 263, 168, 6, 197, 195, 10, 151, 9, 8, 54, 284, 103, 332, 21, 251, 127, 356]
while True:
    ok, fr = cap.read()
    if not ok: break
    frames.append(fr); H, W = fr.shape[:2]
    r = d.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)), int(i * 1000 / 24)); i += 1
    p = r.face_landmarks[0]; pts.append([(p[k].x * W, p[k].y * H) for k in RIGID + [10, 152]])
a = np.array(pts); rig = a[:, :-2]; mm = 190 / np.linalg.norm(a[0, -2] - a[0, -1])
wander = np.linalg.norm(rig - rig.mean(0), axis=2).mean(1)
seam = np.abs(frames[0].astype(int) - frames[-1].astype(int)).mean()
step = np.mean([np.abs(frames[k].astype(int) - frames[k + 1].astype(int)).mean() for k in range(len(frames) - 1)])
print(f"{path.split('/')[-1]}: {len(frames)} frames; rigid-point sway mean {wander.mean():.2f}px max {wander.max():.2f}px (~{wander.max()*mm:.1f}mm); "
      f"loop seam diff {seam:.2f} vs avg frame step {step:.2f}")
