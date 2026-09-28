import type { JobResponse } from "../api/types";

type Sized = Pick<JobResponse, "width" | "height" | "render_width" | "render_height">;

/**
 * The size a job's clips actually render at (wanly-api#359).
 *
 * A job's width/height are its START FRAME's. Since wanly-gpu-docker#148 the engine caps a
 * recipe render at the 1024x1024 area, so an upscaled 1856x1280 frame renders at 1216x832.
 * The API reports that as render_width/render_height. They are absent from older API builds
 * and from the endpoints that return the bare job row, and there the frame's size is the
 * render size, so fall back to it rather than show nothing.
 */
export function renderSize(job: Sized): { width: number; height: number } {
  return {
    width: job.render_width ?? job.width,
    height: job.render_height ?? job.height,
  };
}

/**
 * The job page's Dimensions value. Unchanged when the clip renders at the frame's size; when
 * it does not, both, so "1856x1280" is not read as the size of the video.
 */
export function dimensionsLabel(job: Sized): string {
  const r = renderSize(job);
  if (r.width === job.width && r.height === job.height) return `${job.width}x${job.height}`;
  return `${job.width}×${job.height} start frame → renders ${r.width}×${r.height}`;
}
