import { describe, expect, it } from "vitest";
import { blendRgb, sampleSkin, toLinear, TONE_GAIN_MAX, toneGain } from "./faceSkin";

const flat = (w: number, h: number, rgb: [number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { data, width: w, height: h };
};

describe("skin tone match", () => {
  it("decodes sRGB to linear", () => {
    expect(toLinear(0)).toBe(0);
    expect(toLinear(255)).toBeCloseTo(1);
    expect(toLinear(128)).toBeCloseTo(0.2158, 3);
  });
  it("samples the skin colour at the landmarks, ignoring one outlier point", () => {
    const img = flat(100, 100, [200, 150, 120]);
    // a dark blob under the third point
    for (let y = 45; y < 56; y++) for (let x = 85; x < 96; x++) img.data.set([10, 10, 10, 255], (y * 100 + x) * 4);
    const s = sampleSkin(img, [[0.2, 0.2], [0.5, 0.5], [0.9, 0.5]])!;
    expect(s[0]).toBeCloseTo(toLinear(200));
    expect(s[2]).toBeCloseTo(toLinear(120));
    expect(sampleSkin(img, [[5, 5]])).toBeNull();
  });
  it("gains her toward the mannequin, partly and within limits", () => {
    const g = toneGain([0.4, 0.3, 0.2], [0.2, 0.3, 0.4], 1);
    expect(g[0]).toBeCloseTo(TONE_GAIN_MAX); // 2.0 clamped
    expect(g[1]).toBeCloseTo(1);
    expect(g[2]).toBeCloseTo(0.5);
    expect(toneGain([0.4, 0.3, 0.3], [0.2, 0.3, 0.3], 0.5)[0]).toBeCloseTo(Math.SQRT2);
  });
  it("smooths the running estimate", () => {
    expect(blendRgb(null, [1, 1, 1])).toEqual([1, 1, 1]);
    expect(blendRgb([0, 0, 0], [1, 1, 1], 0.25)).toEqual([0.25, 0.25, 0.25]);
  });
});
