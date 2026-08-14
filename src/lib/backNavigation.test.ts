import { describe, it, expect } from "vitest";
import { backTarget } from "./backNavigation";

describe("backTarget", () => {
  it("steps back through history when the page was navigated to in-app", () => {
    // Any pushed location gets a generated key. -1 is what preserves the list's page, filters
    // and scroll position, because useQueryState kept them on that history entry.
    expect(backTarget("a1b2c3", "/jobs")).toBe(-1);
  });

  it("falls back when the page was opened cold", () => {
    // "default" is the first entry of a session: pasted link, new tab, refresh, or arrived from
    // another site. history.back() would leave the app entirely.
    expect(backTarget("default", "/jobs")).toBe("/jobs");
  });

  it("falls back when there is no key at all", () => {
    // Defensive: a missing key is not evidence that going back is safe.
    expect(backTarget(undefined, "/workers")).toBe("/workers");
  });
});
