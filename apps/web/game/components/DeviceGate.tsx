"use client";
import { useEffect, useState } from "react";
import {
  enterFullscreen, fullscreenSupported, isIOS, isStandalone, isTouchDevice, keepAwake, lockLandscape, releaseAwake, unlockOrientation, exitFullscreen, usePortrait,
} from "../device";

/**
 * Wraps the game for every kind of device.
 *  - Laptop / desktop: renders the game straight away (press F for fullscreen).
 *  - Phone / tablet: one "TAP TO PLAY" screen (a tap is required by browsers to go fullscreen),
 *    then fullscreen + landscape lock + screen kept awake. If the device can't lock the orientation
 *    (iPhone Safari) a "rotate your phone" screen is shown while it is held upright.
 */
export default function DeviceGate({ children }: { children: React.ReactNode }) {
  const [touch, setTouch] = useState(false);
  const [started, setStarted] = useState(false);
  const [skipRotate, setSkipRotate] = useState(false);
  const [ios, setIos] = useState(false);
  const [canFs, setCanFs] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const portrait = usePortrait();

  useEffect(() => {
    setTouch(isTouchDevice()); setIos(isIOS()); setCanFs(fullscreenSupported()); setStandalone(isStandalone());
    document.body.classList.add("game-active");
    return () => { document.body.classList.remove("game-active"); releaseAwake(); unlockOrientation(); void exitFullscreen(); };
  }, []);

  // keep the screen on while driving (the lock is dropped when the tab is hidden, so re-take it)
  useEffect(() => {
    if (!started) return;
    void keepAwake();
    const v = () => { if (document.visibilityState === "visible") void keepAwake(); };
    document.addEventListener("visibilitychange", v);
    return () => document.removeEventListener("visibilitychange", v);
  }, [started]);

  // re-apply the landscape lock whenever fullscreen is (re-)entered
  useEffect(() => {
    if (!touch) return;
    const h = () => { if (document.fullscreenElement) void lockLandscape(); };
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, [touch]);

  async function play() {
    setStarted(true);
    if (canFs && !standalone) { if (await enterFullscreen()) await lockLandscape(); }
    else await lockLandscape(); // installed app: lock works without fullscreen on most Android browsers
  }

  const showStart = touch && !started;
  const showRotate = touch && started && portrait && !skipRotate;

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      {children}
      {showStart && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-[#07080d]/95 p-6 text-center" style={{ paddingLeft: "max(1.5rem, var(--sal))", paddingRight: "max(1.5rem, var(--sar))" }} data-testid="tap-to-play">
          <h1 className="font-display text-3xl font-black short:text-2xl">ROAD <span className="text-rival">RIVALS</span></h1>
          <p className="max-w-sm text-sm text-slate-400 short:text-xs">{ios && !standalone ? "Tap play, then turn your phone sideways." : "Plays full screen in landscape."}</p>
          <button onClick={play} className="btn btn-primary !px-10 !py-4 font-display text-xl short:!py-2" data-testid="tap-play">▶ TAP TO PLAY</button>
          {ios && !standalone && <p className="max-w-xs text-[11px] text-slate-500">Tip: for true full screen on iPhone tap <b>Share → Add to Home Screen</b>, then open Road Rivals from your home screen.</p>}
        </div>
      )}
      {showRotate && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-[#07080d]/95 p-6 text-center" data-testid="rotate-hint">
          <div className="text-6xl motion-safe:animate-[spin_3s_ease-in-out_infinite]" aria-hidden>📱</div>
          <p className="font-display text-xl">Rotate your phone</p>
          <p className="max-w-xs text-sm text-slate-400">Road Rivals plays in landscape. Turn your device sideways to drive.</p>
          <button onClick={() => setSkipRotate(true)} className="text-xs text-slate-500 underline">Continue in portrait anyway</button>
        </div>
      )}
    </div>
  );
}
