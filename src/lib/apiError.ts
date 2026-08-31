import axios from "axios";

/**
 * The API's own explanation, or a fallback.
 *
 * FastAPI returns `detail` as a plain string for HTTPException and as an array of objects for
 * request validation. Both reach the user, so both are handled.
 *
 * This exists because a bare `catch { setError("Failed to X") }` throws away the one piece of
 * information worth having. A real report: "Failed to finalize job", where the API had said
 * `Cannot transition from 'failed' to 'finalized'` — which names the problem and the fix, and
 * the console discarded it.
 */
export function apiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      const parts = detail
        .map((d) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}`)
        .filter(Boolean);
      if (parts.length) return parts.join("; ");
    }
    if (!err.response) return `${fallback} — no response from the API.`;
    return `${fallback} — ${err.response.status} ${err.response.statusText}`;
  }
  return err instanceof Error && err.message ? `${fallback} — ${err.message}` : fallback;
}
