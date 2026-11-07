import { useCallback, useEffect, useState } from "react";

/* Small browser helpers for phones / tablets / laptops: fullscreen, orientation lock, wake lock. */

type AnyDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type AnyEl = HTMLElement & { webkitRequestFullscreen?: () => void };

export const isTouchDevice = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches || (navigator.maxTouchPoints > 0 && window.matchMedia?.("(hover: none)").matches));

export const isIOS = () =>
  typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** Installed to the home screen / launched as an app (already full screen, no browser bars). */
export const isStandalone = () =>
  typeof window !== "undefined" &&
  (!!(navigator as unknown as { standalone?: boolean }).standalone || !!window.matchMedia?.("(display-mode: fullscreen), (display-mode: standalone)").matches);

export const fullscreenSupported = () => {
  if (typeof document === "undefined") return false;
  const el = document.documentElement as AnyEl;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
};
export const inFullscreen = () => {
  if (typeof document === "undefined") return false;
  const d = document as AnyDoc;
  return !!(document.fullscreenElement || d.webkitFullscreenElement);
};

export async function enterFullscreen(): Promise<boolean> {
  const el = document.documentElement as AnyEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch { return false; }
}
export async function exitFullscreen() {
  const d = document as AnyDoc;
  try { if (document.exitFullscreen) await document.exitFullscreen(); else d.webkitExitFullscreen?.(); } catch { /* not fullscreen */ }
}
export const toggleFullscreen = () => (inFullscreen() ? exitFullscreen() : enterFullscreen());

type Lockable = ScreenOrientation & { lock?: (o: string) => Promise<void> };
/** Works on Android Chrome/Firefox/Samsung once fullscreen; iOS Safari has no lock (we show a rotate hint instead). */
export async function lockLandscape(): Promise<boolean> {
  try { await (screen.orientation as Lockable).lock?.("landscape"); return true; } catch { return false; }
}
export function unlockOrientation() { try { screen.orientation?.unlock?.(); } catch { /* unsupported */ } }

type WakeSentinel = { release: () => Promise<void> };
let wake: WakeSentinel | null = null;
export async function keepAwake() {
  try { const w = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<WakeSentinel> } }).wakeLock; if (w && !wake) wake = await w.request("screen"); } catch { wake = null; }
}
export function releaseAwake() { void wake?.release().catch(() => {}); wake = null; }

/** Reactive fullscreen state + toggle (for menu buttons). */
export function useFullscreen() {
  const [on, setOn] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(fullscreenSupported()); setOn(inFullscreen());
    const h = () => setOn(inFullscreen());
    document.addEventListener("fullscreenchange", h); document.addEventListener("webkitfullscreenchange", h);
    return () => { document.removeEventListener("fullscreenchange", h); document.removeEventListener("webkitfullscreenchange", h); };
  }, []);
  const toggle = useCallback(async () => { if (inFullscreen()) await exitFullscreen(); else if (await enterFullscreen() && isTouchDevice()) await lockLandscape(); }, []);
  return { on, supported, toggle };
}

/** True while the viewport is taller than wide. */
export function usePortrait() {
  const [p, setP] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const h = () => setP(mq.matches);
    h(); mq.addEventListener("change", h); window.addEventListener("resize", h);
    return () => { mq.removeEventListener("change", h); window.removeEventListener("resize", h); };
  }, []);
  return p;
}
