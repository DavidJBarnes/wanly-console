import { describe, expect, it } from "vitest";
import { loopFile, loopPickerLabel, loopStatsLabel, loopStatusLabel, loopVersion, needsPolling, photoHint } from "./faceLoops";

describe("face loops", () => {
  it("builds file paths only once a loop is prepared", () => {
    expect(loopFile({ asset_prefix: "s3://wanly-jobs/ar-face/kelly/abc/" }, "loop.mp4")).toBe("s3://wanly-jobs/ar-face/kelly/abc/loop.mp4");
    expect(loopFile({ asset_prefix: null }, "poster.jpg")).toBeNull();
  });

  it("says where a loop is in plain words", () => {
    expect(loopStatusLabel({ status: "rendering", render_status: "pending" })).toBe("Queued for rendering");
    expect(loopStatusLabel({ status: "rendering", render_status: "processing" })).toBe("Rendering…");
    expect(loopStatusLabel({ status: "rendering", render_status: "failed" })).toBe("Render failed");
    expect(loopStatusLabel({ status: "processing", render_status: "completed" })).toBe("Preparing the loop…");
    expect(loopStatusLabel({ status: "ready", render_status: "completed" })).toBe("Ready");
  });

  it("polls only while something is still coming", () => {
    expect(needsPolling([{ status: "ready", render_status: "completed" }])).toBe(false);
    expect(needsPolling([{ status: "rendering", render_status: "failed" }])).toBe(false);
    expect(needsPolling([{ status: "ready", render_status: null }, { status: "processing", render_status: "completed" }])).toBe(true);
  });

  it("labels stats and picker entries", () => {
    expect(loopStatsLabel({ stats: { expression_travel_mm: 3.2, face_px: 650 } })).toBe("3.2 mm movement · face 650 px");
    expect(loopStatsLabel({ stats: null })).toBe("");
    expect(loopPickerLabel({ character: "Kelly-2026", label: "Calm smile + blinks" })).toBe("Kelly-2026 — Calm smile + blinks");
  });

  it("explains a photo's rating", () => {
    const base = { suitable: true, face_px: 691, mouth_closed: true, eyes_open: true, yaw: 0.3, pitch: 13 };
    expect(photoHint(base)).toBe("face 691 px");
    expect(photoHint({ ...base, suitable: false, mouth_closed: false, yaw: 20 })).toBe("face 691 px · mouth open, head turned");
  });
});

describe("loopVersion", () => {
  it("changes the URL whenever the loop is re-prepared", () => {
    expect(loopVersion({ updated_at: "2026-11-10T17:01:01Z" })).toBe("2026-11-10T17:01:01Z");
    expect(loopVersion({ updated_at: null })).toBeUndefined();
  });
});
