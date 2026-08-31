import { describe, it, expect } from "vitest";
import { apiError } from "./apiError";

/**
 * A bare `catch { setError("Failed to X") }` throws away the one useful thing.
 *
 * Reported live (#375): "Failed to finalize job", where the API had said
 * `Cannot transition from 'failed' to 'finalized'` — which names both the problem and the fix.
 */

const axiosErr = (data: unknown, status = 400) => ({
  isAxiosError: true,
  response: { status, statusText: "Bad Request", data },
  message: "Request failed",
});

describe("apiError", () => {
  it("prefers the API's own explanation over the fallback", () => {
    const e = axiosErr({ detail: "Cannot transition from 'failed' to 'finalized'" });
    expect(apiError(e, "Failed to finalize job")).toBe(
      "Cannot transition from 'failed' to 'finalized'",
    );
  });

  it("flattens FastAPI validation arrays", () => {
    const e = axiosErr({
      detail: [{ loc: ["body", "seed"], msg: "Input should be a valid integer" }],
    });
    expect(apiError(e, "nope")).toBe("seed: Input should be a valid integer");
  });

  it("falls back with the status when there is no detail", () => {
    expect(apiError(axiosErr({}), "Failed to finalize job")).toBe(
      "Failed to finalize job — 400 Bad Request",
    );
  });

  it("says so when the API did not answer at all", () => {
    const e = { isAxiosError: true, message: "Network Error" };
    expect(apiError(e, "Failed to finalize job")).toBe(
      "Failed to finalize job — no response from the API.",
    );
  });

  it("ignores a blank detail rather than showing an empty message", () => {
    expect(apiError(axiosErr({ detail: "   " }), "Failed to finalize job")).toBe(
      "Failed to finalize job — 400 Bad Request",
    );
  });

  it("returns the bare fallback for a non-error value", () => {
    expect(apiError("something", "Failed to finalize job")).toBe("Failed to finalize job");
  });
});
