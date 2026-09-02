import { describe, expect, it } from "vitest";

import { orderForDisplay, severityOf, summarise } from "./loraInventory";
import type { WorkerLoraItem } from "../api/types";

const item = (name: string, state: WorkerLoraItem["state"], kind = "content"): WorkerLoraItem =>
  ({ name, kind, state });

describe("severityOf", () => {
  it("does not flag a deferred content LoRA as a problem", () => {
    // The normal state since boot stopped eagerly fetching content LoRAs. Flag it and the
    // page is amber on every worker forever, at which point nobody reads it.
    expect(severityOf("deferred")).toBe("ok");
  });

  it("raises the alarm for a stale LoRA", () => {
    // Present and WRONG. Renders the previous character, successfully — no error anywhere.
    // This is the state the whole panel exists to surface.
    expect(severityOf("stale")).toBe("alarm");
  });

  it("raises the alarm for a missing one", () => {
    expect(severityOf("missing")).toBe("alarm");
  });

  it("notes an unverifiable LoRA without shouting", () => {
    // Verified by size alone (multipart ETag), so a same-size retrain would have slipped
    // through. Worth saying; not a known fault.
    expect(severityOf("unverifiable")).toBe("note");
  });
});

describe("summarise", () => {
  it("distinguishes never-reported from empty", () => {
    // An older daemon reports nothing; a worker with no LoRAs reports an empty list. Those
    // are different facts and must not read identically.
    expect(summarise(null)).toBe("Not reported");
    expect(summarise({ synced_at: null, dir: null, items: [] })).toBe("No LoRAs");
  });

  it("leads with what needs attention", () => {
    const s = summarise({
      synced_at: "x", dir: "/loras",
      items: [item("a", "current"), item("b", "stale"), item("c", "deferred")],
    });
    expect(s.startsWith("1 need attention")).toBe(true);
  });

  it("counts deferred separately from present", () => {
    const s = summarise({
      synced_at: "x", dir: "/loras",
      items: [item("a", "current"), item("b", "deferred"), item("c", "deferred")],
    });
    expect(s).toContain("1 of 3 present");
    expect(s).toContain("2 on demand");
  });
});

describe("orderForDisplay", () => {
  it("puts alarms first so a long healthy list cannot bury one", () => {
    const out = orderForDisplay([
      item("aaa", "current"), item("zzz", "stale"), item("mmm", "deferred"),
    ]);
    expect(out[0].name).toBe("zzz");
  });
});
