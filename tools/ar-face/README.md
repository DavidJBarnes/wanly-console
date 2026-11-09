# AR face loop tools (console#739)

Offline prep for the AR face page (`/holo/face-spike`). CPU only; no GPU or worker image changes.

```bash
uv venv -p 3.12 .venv && uv pip install -p .venv/bin/python mediapipe opencv-python-headless numpy
curl -LO https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

# 1. Pick a source: best 3 s frontal, large, steady face window per clip.
.venv/bin/python score_clips.py face_landmarker.task <dir of final.mp4s>

# 2. Cut the loop (ping-pong), landmarks, and per-frame stabilised 3D shape.
.venv/bin/python make_face_loop.py face_landmarker.task <clip.mp4> <start s> <end s> 512 <out dir>

# 3. Upload loop.mp4, face.json, face.bin (+ poster.jpg) under s3://wanly-jobs/ar-face/<character>/<id>/
#    and point FACE_ASSET in src/pages/FaceSpike.tsx at it.
```

`make_face_loop.py` needs an ffmpeg with an H.264 encoder (`libopenh264` on Fedora's build).
Current asset: Kelly-2026, job a442cfd8, 6.0–9.0 s (most frontal and steady of 19 renders).
