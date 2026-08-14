import { describe, it, expect } from "vitest";
import axios from "axios";
import { REPEAT_ARRAY_PARAMS } from "./repeatArrayParams";

describe("REPEAT_ARRAY_PARAMS", () => {
  const uri = (params: Record<string, unknown>) =>
    axios.create().getUri({ url: "/images/search", params, ...REPEAT_ARRAY_PARAMS });

  it("repeats the key instead of using the bracket form", () => {
    // FastAPI reads tags=a&tags=b into a list; tags[]=a is a parameter it does not have, so the
    // filter would be dropped and the search would return everything.
    expect(uri({ tags: ["Kelly", "Missionary"] })).toBe(
      "/images/search?tags=Kelly&tags=Missionary",
    );
  });

  it("leaves scalars alone", () => {
    expect(uri({ q: "00111", limit: 50 })).toBe("/images/search?q=00111&limit=50");
  });

  it("omits undefined params, so an empty control does not filter", () => {
    expect(uri({ q: undefined, tags: ["Kelly"] })).toBe("/images/search?tags=Kelly");
  });
});
