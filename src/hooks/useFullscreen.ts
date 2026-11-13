import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fullscreen a CONTAINER, not the <video> in it (console#765).
 *
 * The browser's own fullscreen button belongs to the video element, so it ends whenever that
 * element is replaced -- every clip of a playlist. Fullscreening the wrapper keeps the page's
 * own controls (prev / next / loop) on screen and lets the video inside change freely.
 *
 * `supported` is false where only a video element can go fullscreen (iPhone Safari); the
 * caller hides its button there and the native control still works.
 */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => setActive(!!ref.current && document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      // Whatever is fullscreen -- ours, or the native video control's -- this leaves it.
      void document.exitFullscreen().catch(() => {});
    } else {
      void ref.current?.requestFullscreen().catch(() => {});
    }
  }, []);

  const supported = typeof document !== "undefined" && !!document.fullscreenEnabled;
  return { ref, active, toggle, supported };
}
