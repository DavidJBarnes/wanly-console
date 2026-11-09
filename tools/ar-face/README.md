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

## Portrait-animation loops (console#742 validation)

Calm, sway-free loops from ONE still of the character, made with LivePortrait's expression editing
(head pose fixed). This is the approach chosen over LTX for Character Face Loops.

```bash
git clone https://github.com/KwaiVGI/LivePortrait && cd LivePortrait
uv venv -p 3.12 ../lpvenv
uv pip install -p ../lpvenv/bin/python torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cpu
grep -vE 'gradio|lmdb' requirements_base.txt > /tmp/req.txt && echo onnxruntime==1.19.2 >> /tmp/req.txt && echo requests >> /tmp/req.txt
uv pip install -p ../lpvenv/bin/python -r /tmp/req.txt huggingface_hub
../lpvenv/bin/python -c "from huggingface_hub import snapshot_download as d; d('KwaiVGI/LivePortrait', local_dir='pretrained_weights', allow_patterns=['insightface/*','liveportrait/*'], ignore_patterns=['*animal*'])"

# pick a neutral frontal still from renders (mouth closed, eyes open)
<mpvenv>/bin/python portrait/pick_still.py face_landmarker.task <dir of final.mp4s> stills.jpg
# probe each control, then render a loop (PYTHONPATH: the gradio stub + the checkout)
PYTHONPATH=<tools>/portrait/stubs:. ../lpvenv/bin/python <tools>/portrait/lp_driver.py probe still.png probe.jpg
PYTHONPATH=<tools>/portrait/stubs:. ../lpvenv/bin/python <tools>/portrait/lp_driver.py loop still.png blink blink.mp4
# measure sway, then prepare for AR (the loop already joins: --seamless, no ping-pong)
<mpvenv>/bin/python portrait/sway.py face_landmarker.task blink.mp4
<mpvenv>/bin/python make_face_loop.py face_landmarker.task blink.mp4 0 2.0 512 out --seamless
```

- CPU: **full precision only** (`flag_use_half_precision=False`); fp16 on CPU took >10 min/frame,
  fp32 ~4-11 s/frame. A GPU makes it seconds per loop.
- Controls that work on Kelly-2026: eye ratio (blink), smile, wink, eyebrow ±, eyeball direction.
  `lip_variation_zero` smears the mouth; the other lip variations are subtle.
- Measured: blink/smile loops sway 0.6 mm mean / ≤2.3 mm max at rigid landmarks, vs ~18 mm of
  face travel in the LTX laugh clip.
