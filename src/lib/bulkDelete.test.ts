import { describe, it, expect } from "vitest";
import {
  deleteFailureReason,
  describeImageHolders,
  neededHolders,
  newlyNeeded,
  parseInUseResponse,
  splitSelection,
  summarizeBulkDelete,
} from "./bulkDelete";

const A = "s3://wanly-images/2026-10-01/a.png";
const B = "s3://wanly-images/2026-10-01/b.png";
const C = "s3://wanly-images/2026-10-01/c.png";

const body = {
  checked: 3,
  in_use_count: 2,
  paths: {
    [A]: {
      job_ids: [], segment_ids: [], training_ids: [], dataset_ids: ["ds-1"],
      jobs: [], segments: [], trainings: [],
      datasets: [{ id: "ds-1", name: "Kelly faces" }],
      needed: false,
    },
    [B]: {
      job_ids: ["job-1"], segment_ids: ["seg-1"], training_ids: [], dataset_ids: [],
      jobs: [{ id: "job-1", name: "beach walk", status: "pending", state: "queued" }],
      segments: [{
        id: "seg-1", job_id: "job-2", job_name: "sofa", index: 2,
        status: "awaiting_caption", state: "held",
      }],
      trainings: [], datasets: [], needed: true,
    },
  },
};

describe("parseInUseResponse", () => {
  it("reads holders, names and states into camelCase", () => {
    const out = parseInUseResponse(body);
    expect(Object.keys(out)).toEqual([A, B]);
    expect(out[A].datasets).toEqual([{ id: "ds-1", name: "Kelly faces" }]);
    expect(out[A].needed).toBe(false);
    expect(out[B].segments[0]).toEqual({
      id: "seg-1", jobId: "job-2", jobName: "sofa", index: 2,
      status: "awaiting_caption", state: "held",
    });
    expect(out[B].needed).toBe(true);
  });

  it("treats a queued holder as needed even if the flag is missing", () => {
    // The warning is the safety; it must not hinge on one boolean.
    const { needed: _drop, ...rest } = body.paths[B];
    void _drop;
    const out = parseInUseResponse({ paths: { [B]: rest } });
    expect(out[B].needed).toBe(true);
  });

  it("drops an entry with no holders and survives junk", () => {
    expect(parseInUseResponse({ paths: { [A]: { job_ids: [] } } })).toEqual({});
    expect(parseInUseResponse(null)).toEqual({});
    expect(parseInUseResponse({ paths: "nope" })).toEqual({});
  });
});

describe("splitSelection", () => {
  it("keeps selection order and splits free from held", () => {
    const inUse = parseInUseResponse(body);
    expect(splitSelection([C, B, A], inUse)).toEqual({ free: [C], held: [B, A] });
  });
});

describe("describeImageHolders", () => {
  it("reads as a sentence fragment", () => {
    const inUse = parseInUseResponse(body);
    expect(describeImageHolders(inUse[A])).toBe("1 dataset");
    expect(describeImageHolders(inUse[B])).toBe("1 job and 1 segment");
  });
});

describe("neededHolders", () => {
  it("lists queued and held holders, never dataset membership", () => {
    const needed = neededHolders(parseInUseResponse(body));
    expect(needed.map((h) => [h.kind, h.id, h.state])).toEqual([
      ["job", "job-1", "queued"],
      ["segment", "seg-1", "held"],
    ]);
    expect(needed[1].jobId).toBe("job-2");
    expect(needed[1].label).toBe("sofa · segment 3 (awaiting caption)");
  });

  it("dedupes one job holding several images, and skips idle holders", () => {
    const job = { id: "job-1", name: "j", status: "pending", state: "queued" };
    const old = { id: "job-9", name: "old", status: "archived", state: "idle" };
    const entry = (jobs: unknown[]) => ({
      job_ids: jobs.map((j) => (j as { id: string }).id), jobs,
    });
    const inUse = parseInUseResponse({ paths: { [A]: entry([job]), [B]: entry([job, old]) } });
    expect(neededHolders(inUse).map((h) => h.id)).toEqual(["job-1"]);
    expect(inUse[B].needed).toBe(true);
  });

  it("can be limited to some paths", () => {
    expect(neededHolders(parseInUseResponse(body), [A])).toEqual([]);
  });
});

describe("newlyNeeded", () => {
  it("is empty when nothing changed", () => {
    const m = parseInUseResponse(body);
    expect(newlyNeeded(m, m, [A, B])).toEqual([]);
  });

  it("names a job queued on an image after the dialog opened", () => {
    // The acknowledgement covered what was shown. A newly queued render must stop the run.
    const before = parseInUseResponse(body);
    const after = parseInUseResponse({
      paths: {
        ...body.paths,
        [A]: {
          ...body.paths[A],
          job_ids: ["job-new"],
          jobs: [{ id: "job-new", name: "new", status: "pending", state: "queued" }],
        },
      },
    });
    expect(newlyNeeded(before, after, [A, B]).map((h) => h.id)).toEqual(["job-new"]);
  });
});

describe("deleteFailureReason", () => {
  it("names the holders of a refusal", () => {
    const e = {
      response: { status: 409, data: { detail: { path: A, job_ids: ["j"], segment_ids: [] } } },
    };
    expect(deleteFailureReason(e)).toBe("now in use by 1 job, so it was skipped");
  });

  it("falls back to the error itself", () => {
    expect(deleteFailureReason(new Error("boom"))).toBe("delete failed — boom");
  });
});

describe("summarizeBulkDelete", () => {
  it("counts deleted, kept and failed", () => {
    const out = summarizeBulkDelete(
      [
        { path: A, filename: "a.png", error: null },
        { path: B, filename: "b.png", error: "timeout" },
        { path: C, filename: "c.png", error: null },
      ],
      2,
    );
    expect(out.deleted).toBe(2);
    expect(out.failures.map((f) => f.filename)).toEqual(["b.png"]);
    expect(out.message).toBe("Deleted 2 images · 2 in use kept · 1 failed");
  });

  it("reads naturally at one", () => {
    expect(summarizeBulkDelete([{ path: A, filename: "a", error: null }], 0).message)
      .toBe("Deleted 1 image");
  });
});
