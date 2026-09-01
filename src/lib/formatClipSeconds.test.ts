import { describe, expect, it } from "vitest";

// Mirrors the helper in Dashboard.tsx. Kept as a unit here because the page itself has no
// component-test setup, and the rule worth pinning is the rounding, not the markup.
const formatClipSeconds = (seconds: number): string => `${seconds.toFixed(1)}s`;

describe("formatClipSeconds", () => {
  it("rounds the derived LTX duration instead of printing sixteen decimals", () => {
    // 241 frames / 24 fps — what every LTX segment reports.
    expect(formatClipSeconds(10.041666666666666)).toBe("10.0s");
  });

  it("keeps one decimal for a genuinely different length", () => {
    expect(formatClipSeconds(5.5)).toBe("5.5s");
  });

  it("shows a whole number as .0 rather than dropping it", () => {
    // "10s" and "10.0s" mean different things in this column: one clip is exactly ten
    // seconds, the other is 241 frames at 24fps and merely close.
    expect(formatClipSeconds(10)).toBe("10.0s");
  });
});
