import { describe, expect, it } from "vitest";

import type { Pose } from "../api/ltx";
import { guessPoseFromTags } from "./poseFromTags";

// The 10eros/sulphur books as they stood on production 2026-10-25.
const pose = (name: string, book_name = "10eros", is_default = false): Pose =>
  ({ id: `${book_name}/${name}`, name, book_name, is_default } as unknown as Pose);
const POSES = [
  pose("AAA Identity", "10eros", true),
  pose("Blowjob"),
  pose("Cowgirl"),
  pose("Doggystyle"),
  pose("Doggystyle Insertion POV"),
  pose("Doggystyle POV"),
  pose("Doggystyle Pullout Cumshot"),
  pose("Handjob"),
  pose("Handjob Cumshot"),
  pose("Hard cut to Missionary"),
  pose("Missionary"),
  pose("Missionary POV"),
  pose("Blowjob", "sulphur"),
  pose("Doggystyle", "sulphur"),
];
const guess = (tags: string | null) => guessPoseFromTags(tags, POSES);

describe("guessPoseFromTags (console#694)", () => {
  it("picks the plain pose for a single action tag", () => {
    expect(guess("Kelly, Doggystyle")).toEqual({ poseId: "10eros/Doggystyle", matched: ["Doggystyle"] });
    expect(guess("Payton, Missionary")?.poseId).toBe("10eros/Missionary");
    expect(guess("Cowgirl")?.poseId).toBe("10eros/Cowgirl");
  });

  it("uses a second tag to choose the more specific pose", () => {
    expect(guess("Kelly, Doggystyle, POV")?.poseId).toBe("10eros/Doggystyle POV");
    expect(guess("Missionary, POV")?.poseId).toBe("10eros/Missionary POV");
    expect(guess("Handjob, Cumshot")?.poseId).toBe("10eros/Handjob Cumshot");
  });

  it("does not pick a more specific pose the tags do not ask for", () => {
    expect(guess("Handjob")?.poseId).toBe("10eros/Handjob");
    expect(guess("Doggystyle, Insertion, POV")?.poseId).toBe("10eros/Doggystyle Insertion POV");
  });

  it("matches case-insensitively, whole words only", () => {
    expect(guess("doggystyle")?.poseId).toBe("10eros/Doggystyle");
    expect(guess("Doggy")).toBeNull();
  });

  it("prefers the default pose's book when a name repeats", () => {
    const sulphurDefault = POSES.map((p) =>
      ({ ...p, is_default: p.id === "sulphur/Blowjob" }) as Pose);
    expect(guess("Blowjob")?.poseId).toBe("10eros/Blowjob");
    expect(guessPoseFromTags("Blowjob", sulphurDefault)?.poseId).toBe("sulphur/Blowjob");
  });

  it("returns null when nothing matches, so the starred default applies", () => {
    expect(guess("Kelly, Panties")).toBeNull();
    expect(guess(null)).toBeNull();
    expect(guess("")).toBeNull();
    expect(guessPoseFromTags("Doggystyle", [])).toBeNull();
  });
});
