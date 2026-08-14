import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { backTarget } from "../lib/backNavigation";

/**
 * A back arrow that returns to wherever the user actually came from, falling back to `fallback`
 * when this page was opened cold (pasted link, new tab, refresh).
 *
 * See backTarget for why the location key is the signal.
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  const { key } = useLocation();
  return useCallback(() => {
    const target = backTarget(key, fallback);
    // Two calls, not one: navigate() is overloaded and a history delta is a different call
    // signature from a path.
    if (typeof target === "number") navigate(target);
    else navigate(target);
  }, [navigate, key, fallback]);
}
