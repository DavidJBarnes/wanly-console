/**
 * Skin tone match (console#759): her face and neck are drawn over a mannequin whose own skin
 * shows around them, so a different tone reads as a mask. Sample the mannequin's skin in the
 * headset camera image at its own face landmarks, sample hers in the loop at the same
 * landmarks, and multiply her colour by the per-channel ratio (partial, clamped).
 *
 * All arithmetic is in linear light: the shaders sample sRGB textures (decoded to linear), so a
 * gain applied there must be a linear ratio.
 */

export type Rgb = [number, number, number];

/** Cheeks and forehead: flat, lit, rarely under hair or in a crease. */
export const SKIN_POINTS = [50, 280, 101, 330, 151, 108, 337];
/** How much of the measured difference to apply: the camera image is not exactly what
 * passthrough shows, so stop short of a full match. */
export const TONE_STRENGTH = 0.8;
export const TONE_GAIN_MIN = 0.5;
export const TONE_GAIN_MAX = 1.8;
/** Patch half-width in pixels of the sampled image. */
export const PATCH = 2;

export function toLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Mean linear colour of the skin in an RGBA image at landmarks given as 0..1 image coordinates
 * (x right, y down). Per channel, the median over the points: one point in shadow or under a
 * strand of hair should not move it. null if no point lands in the image.
 */
export function sampleSkin(img: { data: ArrayLike<number>; width: number; height: number }, pts: [number, number][]): Rgb | null {
  const per: Rgb[] = [];
  for (const [u, v] of pts) {
    const cx = Math.round(u * img.width);
    const cy = Math.round(v * img.height);
    const acc: Rgb = [0, 0, 0];
    let n = 0;
    for (let y = cy - PATCH; y <= cy + PATCH; y++) {
      for (let x = cx - PATCH; x <= cx + PATCH; x++) {
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
        const i = (y * img.width + x) * 4;
        for (let k = 0; k < 3; k++) acc[k] += toLinear(img.data[i + k]);
        n++;
      }
    }
    if (n) per.push(acc.map((a) => a / n) as Rgb);
  }
  if (!per.length) return null;
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return [0, 1, 2].map((k) => median(per.map((p) => p[k]))) as Rgb;
}

/** Per-channel gain taking her skin toward the mannequin's. */
export function toneGain(mannequin: Rgb, hers: Rgb, strength = TONE_STRENGTH): Rgb {
  return [0, 1, 2].map((k) => {
    const ratio = Math.max(1e-4, mannequin[k]) / Math.max(1e-4, hers[k]);
    return Math.min(TONE_GAIN_MAX, Math.max(TONE_GAIN_MIN, ratio ** strength));
  }) as Rgb;
}

/** Running average of the mannequin's skin, so one bad frame does not flash her colour. */
export function blendRgb(prev: Rgb | null, next: Rgb, k = 0.3): Rgb {
  if (!prev) return next;
  return [0, 1, 2].map((i) => prev[i] + (next[i] - prev[i]) * k) as Rgb;
}
