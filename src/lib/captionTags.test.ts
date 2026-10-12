/** wanly-api#462: which tags an SDXL run's captions named, and which the trigger carries. */
import { describe, expect, it } from "vitest";

import { captionTagGroups, keptRows, promptText, strippedRows, TOP_N } from "./captionTags";
import type { CaptionTagGroup } from "../api/types";

const joana: CaptionTagGroup = {
  label: "j0ana", kind: "identity", images: 73,
  kept: [["earrings", 58], ["hoop_earrings", 41], ["j0ana", 73], ["smile", 20]],
  stripped: [["glasses", 70]],
};

describe("caption tags", () => {
  it("is absent for LTX runs and empty tallies", () => {
    expect(captionTagGroups({ caption_tags: null })).toBeNull();
    expect(captionTagGroups({})).toBeNull();
    expect(captionTagGroups({ caption_tags: { images: 0, groups: [] } })).toBeNull();
    expect(captionTagGroups({ caption_tags: { images: 73, groups: [joana] } })).toEqual([joana]);
  });

  it("drops the trigger row, gives % of images and flags >= 50%", () => {
    expect(keptRows(joana)).toEqual([
      { tag: "earrings", count: 58, pct: 79, flagged: true },
      { tag: "hoop_earrings", count: 41, pct: 56, flagged: true },
      { tag: "smile", count: 20, pct: 27, flagged: false },
    ]);
  });

  it("keeps a pair's class tokens off the list too", () => {
    const g = { ...joana, label: "k3lly, 1girl", kept: [["1girl", 5], ["hug", 2]] as [string, number][], images: 5 };
    expect(keptRows(g).map((r) => r.tag)).toEqual(["hug"]);
  });

  it("lists the top N only", () => {
    const many = { ...joana, kept: Array.from({ length: 40 }, (_, i) => [`t${i}`, 40 - i] as [string, number]) };
    expect(keptRows(many)).toHaveLength(TOP_N);
  });

  it("says when the stripped tags are unknowable", () => {
    expect(strippedRows({ ...joana, stripped: null })).toBeNull();
    expect(strippedRows(joana)).toEqual([{ tag: "glasses", count: 70, pct: 96, flagged: false }]);
  });

  it("copies tags exactly as captioned, prompt-ready", () => {
    expect(promptText(keptRows(joana).filter((r) => r.flagged))).toBe("earrings, hoop_earrings");
  });
});
