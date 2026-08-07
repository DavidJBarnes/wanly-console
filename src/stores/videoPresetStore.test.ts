import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VideoSettingsPreset } from "../api/types";

// Mocked, not imported: api/client installs axios interceptors at import time, one of which
// assigns window.location on a 401. vi.mock keeps the real module from ever loading.
const getVideoPresets = vi.fn();
vi.mock("../api/client", () => ({ getVideoPresets: (...a: unknown[]) => getVideoPresets(...a) }));

const { useVideoPresetStore } = await import("./videoPresetStore");

const preset = (name: string, archived: boolean): VideoSettingsPreset =>
  ({ id: `id-${name}`, name, archived }) as VideoSettingsPreset;

describe("videoPresetStore — the picker/history split", () => {
  beforeEach(() => {
    getVideoPresets.mockReset();
    useVideoPresetStore.setState({ presets: [], allPresets: [], loading: false, error: null });
  });

  it("keeps archived presets out of the picker list but resolvable by id", async () => {
    // The whole point of archiving over deleting: a job that ran on 'old' must still be able
    // to show what it ran with, while nobody can pick it for a new job.
    getVideoPresets.mockResolvedValue([preset("old", true), preset("current", false)]);

    await useVideoPresetStore.getState().fetchPresets();
    const { presets, allPresets } = useVideoPresetStore.getState();

    expect(presets.map((p) => p.name)).toEqual(["current"]);
    expect(allPresets.map((p) => p.name)).toEqual(["current", "old"]);
    expect(allPresets.find((p) => p.id === "id-old")).toBeDefined();
  });

  it("asks the API for archived presets — filtering happens here, not server-side", () => {
    getVideoPresets.mockResolvedValue([]);
    useVideoPresetStore.getState().fetchPresets();
    expect(getVideoPresets).toHaveBeenCalledWith(true);
  });

  it("sorts by name", async () => {
    getVideoPresets.mockResolvedValue([preset("b", false), preset("a", false)]);
    await useVideoPresetStore.getState().fetchPresets();
    expect(useVideoPresetStore.getState().presets.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("surfaces a fetch failure instead of leaving an empty picker looking correct", async () => {
    getVideoPresets.mockRejectedValue(new Error("boom"));
    await useVideoPresetStore.getState().fetchPresets();
    expect(useVideoPresetStore.getState().error).toBe("boom");
    expect(useVideoPresetStore.getState().loading).toBe(false);
  });

  it("applyPreset updates both lists without a refetch — the postback fix", async () => {
    // Archiving used to call fetchPresets(), which flips `loading` and makes the library swap
    // its whole grid for a spinner. Folding the PATCH response in directly avoids that, so the
    // network must NOT be touched.
    getVideoPresets.mockResolvedValue([preset("keep", false), preset("target", false)]);
    await useVideoPresetStore.getState().fetchPresets();
    getVideoPresets.mockClear();

    useVideoPresetStore.getState().applyPreset(preset("target", true));

    const { presets, allPresets } = useVideoPresetStore.getState();
    expect(getVideoPresets).not.toHaveBeenCalled();
    expect(presets.map((p) => p.name)).toEqual(["keep"]);
    expect(allPresets.map((p) => p.name)).toEqual(["keep", "target"]);
    expect(allPresets.find((p) => p.id === "id-target")!.archived).toBe(true);
  });

  it("applyPreset does not disturb the order of the other presets", async () => {
    // Same keys in the same order is what lets React leave the other cards mounted.
    getVideoPresets.mockResolvedValue([preset("a", false), preset("b", false), preset("c", false)]);
    await useVideoPresetStore.getState().fetchPresets();

    useVideoPresetStore.getState().applyPreset(preset("b", true));

    expect(useVideoPresetStore.getState().allPresets.map((p) => p.id)).toEqual([
      "id-a",
      "id-b",
      "id-c",
    ]);
  });

  it("restoring puts a preset back in the picker list", async () => {
    getVideoPresets.mockResolvedValue([preset("old", true)]);
    await useVideoPresetStore.getState().fetchPresets();
    expect(useVideoPresetStore.getState().presets).toHaveLength(0);

    useVideoPresetStore.getState().applyPreset(preset("old", false));
    expect(useVideoPresetStore.getState().presets.map((p) => p.name)).toEqual(["old"]);
  });
});
