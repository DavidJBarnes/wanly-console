import type { LatestSdxlLora } from "../api/ltx";
import { dateTimeLabel } from "./dateTime";

/** The SDXL chip's words (wanly-api#458): "Tested in A1111 · 266 images" or "Untested". */
export function sdxlChipLabel(l: Pick<LatestSdxlLora, "tested" | "a1111_images">): string {
  if (!l.tested) return "Untested";
  return `Tested in A1111 · ${l.a1111_images} image${l.a1111_images === 1 ? "" : "s"}`;
}

/** The SDXL tooltip: what was counted, where from, and when last used. */
export function sdxlTooltip(l: LatestSdxlLora): string {
  return [
    `Newest SDXL run: v${l.run_version}${l.at ? `, finished ${dateTimeLabel(l.at)}` : ""}.`,
    l.tested
      ? `${l.a1111_images} A1111 image${l.a1111_images === 1 ? "" : "s"} used its checkpoints` +
        (l.a1111_last_used_at ? `; last used ${dateTimeLabel(l.a1111_last_used_at)}.` : ".")
      : "No A1111 image has used any of its checkpoints yet.",
    "Counted from A1111's saved images on 3090b.",
  ].join(" ");
}
