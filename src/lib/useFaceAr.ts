// Face Loops AR from any page (console#749): warms the cameras when the page opens on a headset
// that can do immersive-ar, and gives a launch() to call straight from a tap. Elsewhere (a
// desktop browser) `supported` is false and nothing is started.
import { useCallback, useEffect, useState } from "react";
import type { FaceLoop } from "../api/types";
import type { FaceArEngine, WarmState } from "./faceAr";
import { isHairMode } from "./faceHair";
import type { HairMode } from "./faceHair";

const MODE_KEY = "wanly.faceLoops.mode";

function savedMode(): HairMode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return isHairMode(m) ? m : "face";
  } catch {
    return "face";
  }
}

function saveMode(m: HairMode) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* private mode — the default is fine */
  }
}

export interface FaceAr {
  /** null while checking; false = not a headset (desktop): offer a preview instead. */
  supported: boolean | null;
  state: WarmState;
  error: string | null;
  inSession: boolean;
  launch: (loop: FaceLoop) => void;
  /** What a launch starts in (Face / Face + hair / Hair); A/X changes it in AR, remembered. */
  mode: HairMode;
  setMode: (m: HairMode) => void;
}

export function useFaceAr(): FaceAr {
  const xr = (navigator as unknown as { xr?: XRSystem }).xr;
  const [supported, setSupported] = useState<boolean | null>(xr ? null : false);
  const [, bump] = useState(0);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [engine, setEngine] = useState<FaceArEngine | null>(null);
  const [mode, setModeState] = useState<HairMode>(savedMode);
  const setMode = useCallback((m: HairMode) => {
    setModeState(m);
    saveMode(m);
  }, []);

  useEffect(() => {
    if (!xr) return;
    let cancelled = false;
    xr.isSessionSupported("immersive-ar").then(
      (ok) => !cancelled && setSupported(ok),
      () => !cancelled && setSupported(false),
    );
    return () => {
      cancelled = true;
    };
  }, [xr]);

  useEffect(() => {
    if (!supported) return;
    let e: FaceArEngine | null = null;
    let cancelled = false;
    import("./faceAr").then(({ FaceArEngine }) => {
      if (cancelled) return;
      e = new FaceArEngine(() => bump((n) => n + 1));
      setEngine(e);
      void e.warm();
    });
    return () => {
      cancelled = true;
      e?.dispose();
      setEngine(null);
    };
  }, [supported]);

  const launch = useCallback((loop: FaceLoop) => {
    const e = engine;
    setLaunchError(null);
    if (!e) {
      setLaunchError("AR is still starting — try again in a moment");
      return;
    }
    if (e.state === "failed") void e.warm(); // e.g. camera permission granted since
    e.launch(loop, mode, setMode).catch((err) => setLaunchError(err instanceof Error ? err.message : String(err)));
  }, [engine, mode, setMode]);

  const e = engine;
  return {
    supported,
    state: e?.state ?? (supported ? "starting" : "idle"),
    error: launchError ?? e?.error ?? null,
    inSession: e?.inSession ?? false,
    launch,
    mode,
    setMode,
  };
}
