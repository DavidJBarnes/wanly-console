"""Drive LivePortrait's single-image expression editing from a script (no gradio UI).

Run with cwd = LivePortrait checkout and PYTHONPATH = <stubs>:<LivePortrait>.
  probe:  lp_driver.py probe STILL OUT.jpg            one frame per control at full strength
  loop:   lp_driver.py loop STILL PRESET OUT.mp4      a seamless expression loop (512² face crop)
"""
import math, sys, time
import cv2, numpy as np, torch
from src.config.argument_config import ArgumentConfig
from src.config.inference_config import InferenceConfig
from src.config.crop_config import CropConfig
from src.gradio_pipeline import GradioPipeline

def partial_fields(cls, kw):
    return cls(**{k: v for k, v in kw.items() if hasattr(cls, k)})

# fp16 on CPU has no fast kernels: one frame took >10 min. Full precision on CPU.
args = ArgumentConfig(flag_force_cpu=True, flag_use_half_precision=False)
pipe = GradioPipeline(inference_cfg=partial_fields(InferenceConfig, args.__dict__),
                      crop_cfg=partial_fields(CropConfig, args.__dict__), args=args)

def prepare(still):
    eye, lip = pipe.init_retargeting_image(2.5, 0.0, 0.0, still)
    return eye, lip

ZERO = dict(input_head_pitch_variation=0.0, input_head_yaw_variation=0.0, input_head_roll_variation=0.0,
            mov_x=0.0, mov_y=0.0, mov_z=1.0, lip_variation_zero=0.0, lip_variation_one=0.0, lip_variation_two=0.0,
            lip_variation_three=0.0, smile=0.0, wink=0.0, eyebrow=0.0, eyeball_direction_x=0.0, eyeball_direction_y=0.0)

def render(still, eye0, lip0, **kw):
    p = dict(ZERO); p.update(kw)
    out, _ = pipe.execute_image_retargeting(input_eye_ratio=p.pop("eye", eye0), input_lip_ratio=p.pop("lip", lip0),
                                            input_image=still, retargeting_source_scale=2.5,
                                            flag_stitching_retargeting_input=True, flag_do_crop_input_retargeting_image=True, **p)
    return cv2.cvtColor(out, cv2.COLOR_RGB2BGR)

mode, still = sys.argv[1], sys.argv[2]
eye0, lip0 = prepare(still)
print(f"source eye ratio {eye0}, lip ratio {lip0}")

if mode == "probe":
    probes = [("neutral", {}), ("eye 0 (blink)", {"eye": 0.0}), ("smile 1.0", {"smile": 1.0}), ("smile -0.5", {"smile": -0.5}),
              ("wink 15", {"wink": 15.0}), ("eyebrow 10", {"eyebrow": 10.0}), ("eyebrow -10", {"eyebrow": -10.0}),
              ("look x 10", {"eyeball_direction_x": 10.0}), ("lip var0 1", {"lip_variation_zero": 1.0}),
              ("lip var1 10", {"lip_variation_one": 10.0}), ("lip var2 5", {"lip_variation_two": 5.0}), ("lip var3 20", {"lip_variation_three": 20.0})]
    tiles = []
    for name, kw in probes:
        t0 = time.time(); im = cv2.resize(render(still, eye0, lip0, **kw), (256, 256))
        cv2.putText(im, name, (4, 18), 0, 0.55, (0, 255, 255), 1); tiles.append(im)
        print(f"{name}: {time.time() - t0:.1f}s")
    rows = [np.hstack(tiles[i:i + 4]) for i in range(0, len(tiles), 4)]
    cv2.imwrite(sys.argv[3], np.vstack(rows))

def ease(x):  # 0..1 -> 0..1 smooth
    return 0.5 - 0.5 * math.cos(math.pi * max(0.0, min(1.0, x)))

def blink_curve(f, start, eye0):
    """Eye-open ratio for a natural blink starting at frame `start`: 3 frames down, 2 shut, 4 up."""
    d = f - start
    if d < 0 or d > 9: return eye0
    if d < 3: return eye0 * (1 - ease((d + 1) / 3))
    if d < 5: return 0.0
    return eye0 * ease((d - 4) / 5)

PRESETS = {
    # frames @24fps, per-frame controls. Every preset starts and ends at the source pose -> seamless.
    "blink": (48, lambda f, e0, l0: {"eye": blink_curve(f, 18, e0)}),
    "smile": (72, lambda f, e0, l0: {"smile": 0.9 * math.sin(math.pi * f / 72) ** 2, "eye": blink_curve(f, 34, e0)}),
}

if mode == "loop":
    preset, out = sys.argv[3], sys.argv[4]
    n, fn = PRESETS[preset]
    import subprocess, os
    raw = out + ".raw.mp4"
    vw = None; t0 = time.time()
    for f in range(n):
        im = render(still, eye0, lip0, **fn(f, eye0, lip0))
        if vw is None:
            vw = cv2.VideoWriter(raw, cv2.VideoWriter_fourcc(*"mp4v"), 24, (im.shape[1], im.shape[0]))
        vw.write(im)
        if f % 8 == 0: print(f"{preset} frame {f}/{n} {time.time() - t0:.0f}s", flush=True)
    vw.release()
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", raw, "-c:v", "libopenh264", "-pix_fmt", "yuv420p", "-b:v", "4M",
                    "-movflags", "+faststart", out], check=True)
    os.remove(raw)
    print(f"done {out} in {time.time() - t0:.0f}s")
