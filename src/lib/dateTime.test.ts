import { describe, expect, it } from "vitest";
import { dateTimeLabel, sameDay, spanLabel } from "./dateTime";

describe("dateTimeLabel", () => {
  const now = new Date(2026, 9, 10, 12, 0);
  it("gives the date and the time", () => {
    const s = dateTimeLabel(new Date(2026, 9, 9, 14, 14), now);
    expect(s).toMatch(/Oct/);
    expect(s).toMatch(/9/);
    expect(s).toMatch(/2:14/);
    expect(s).not.toMatch(/2026/);
  });
  it("adds the year only when it is not this year", () => {
    expect(dateTimeLabel(new Date(2025, 11, 31, 9, 5), now)).toMatch(/2025/);
  });
});

describe("spanLabel", () => {
  it("names the end's date only when it is another day", () => {
    const sameDaySpan = spanLabel(new Date(2026, 9, 9, 13, 2), new Date(2026, 9, 9, 14, 14));
    expect(sameDaySpan.match(/Oct/g)?.length).toBe(1);
    const overnight = spanLabel(new Date(2026, 9, 9, 23, 40), new Date(2026, 9, 10, 1, 5));
    expect(overnight.match(/Oct/g)?.length).toBe(2);
  });
  it("sameDay compares the calendar day, not 24 hours", () => {
    expect(sameDay(new Date(2026, 9, 9, 23, 59), new Date(2026, 9, 10, 0, 1))).toBe(false);
  });
});
