import { describe, expect, it } from "vitest";

import type { TrainingJob } from "../api/types";
import { latestVersions, runDatasetName, versionRows } from "./characterVersions";
import { characterIconUri, offeredCharacters } from "./characterIcon";
import { preselectCharacter } from "./defaultSelection";
import type { Character } from "../api/ltx";

const run = (version: number, arch: "ltx" | "sdxl", status = "completed", created = "2026-10-01",
             dataset = "Joana v1") =>
  ({ id: `${arch}${version}${status}${created}`, version, status, created_at: created,
     config: { ...(arch === "sdxl" ? { arch } : {}), dataset: { name: dataset } } }) as unknown as TrainingJob;

describe("versionRows (console#616)", () => {
  it("lines LTX and SDXL up by version number, newest first, with gaps visible", () => {
    const rows = versionRows([run(1, "ltx"), run(1, "sdxl"), run(2, "ltx")]);
    expect(rows.map((r) => [r.version, r.ltx?.version ?? null, r.sdxl?.version ?? null]))
      .toEqual([[2, 2, null], [1, 1, 1]]);
  });
  it("a retried version shows the run that matters: live, else completed, else newest", () => {
    const failed = run(1, "ltx", "failed", "2026-10-01");
    const done = run(1, "ltx", "completed", "2026-10-02");
    expect(versionRows([failed, done])[0].ltx).toBe(done);
    const live = run(1, "ltx", "running", "2026-10-03");
    expect(versionRows([failed, done, live])[0].ltx).toBe(live);
  });
  it("latest is the highest COMPLETED version per arch", () => {
    expect(latestVersions([run(1, "ltx"), run(2, "ltx", "running"), run(1, "sdxl")]))
      .toEqual({ ltx: 1, sdxl: 1 });
    expect(latestVersions([])).toEqual({ ltx: null, sdxl: null });
  });
  it("reads the dataset name off the run's snapshot", () => {
    expect(runDatasetName(run(1, "ltx"))).toBe("Joana v1");
    expect(runDatasetName({ config: {} })).toBeNull();
  });
});

describe("character icon and hidden (console#616, #617)", () => {
  const ch = (over: Partial<Character>) => ({ name: "Joana", ...over }) as Character;
  it("the picked icon wins, then the trained face, the face reference, the sheet", () => {
    expect(characterIconUri(ch({ icon_uri: "s3://i", image_uri: "s3://f" }))).toBe("s3://i");
    expect(characterIconUri(ch({ image_uri: "s3://f", face_ref_uri: "s3://r" }))).toBe("s3://f");
    expect(characterIconUri(ch({ face_ref_uri: "s3://r", sheet_uri: "s3://s" }))).toBe("s3://r");
    expect(characterIconUri(ch({ sheet_uri: "s3://s" }))).toBe("s3://s");
    expect(characterIconUri(ch({}))).toBeNull();
  });
  it("pickers leave hidden characters out -- except the one already selected", () => {
    const list = [ch({ name: "A" }), ch({ name: "B", hidden: true })];
    expect(offeredCharacters(list).map((c) => c.name)).toEqual(["A"]);
    expect(offeredCharacters(list, "B").map((c) => c.name)).toEqual(["A", "B"]);
  });
  it("a hidden character is never preselected, even as the default", () => {
    const list = [ch({ name: "A" }), ch({ name: "B", hidden: true, is_default: true })];
    expect(preselectCharacter("", list)).toBe("A");
    expect(preselectCharacter("B", list)).toBe("B");   // an explicit value is kept
  });
});
