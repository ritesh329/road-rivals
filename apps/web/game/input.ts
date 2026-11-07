import { useEffect } from "react";
import { controls, useGame, view } from "./store";
import { useGarageUi } from "./garage/garageStore";
import { useNav } from "./nav/navStore";
import { toggleFullscreen } from "./device";

/** Open the garage panel if the player is on a garage pad and (almost) stopped. Shared by key E and the touch button. */
export function tryOpenGarage() {
  const ui = useGarageUi.getState();
  if (ui.open) return;
  if (!ui.near) return;
  if (Math.abs(view.speed) * 3.6 > 12) { ui.notify("Slow down to enter the garage", "info"); return; }
  ui.setOpen(true);
}

const MAP: Record<string, "up" | "down" | "left" | "right"> = {
  KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
};

export function useKeyboard() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "KeyM" && !e.repeat) { useNav.getState().setMapOpen(!useNav.getState().mapOpen); e.preventDefault(); return; }
      if (useNav.getState().mapOpen) { if (e.code === "Escape") useNav.getState().setMapOpen(false); return; }
      if (useGarageUi.getState().open && e.code !== "KeyE" && e.code !== "Escape") return; // garage panel open: keys don't drive the car
      const k = MAP[e.code];
      if (k) { controls.key[k] = true; e.preventDefault(); }
      else if (e.code === "Space") { controls.keyHand = true; e.preventDefault(); }
      else if (e.code === "ShiftLeft" || e.code === "ShiftRight") controls.keyNitro = true;
      else if (e.code === "KeyF" && !e.repeat) void toggleFullscreen();
      else if (e.code === "KeyC" && !e.repeat) useGame.getState().cycleCamera();
      else if (e.code === "KeyR" && !e.repeat) controls.respawn = true;
      else if (e.code === "KeyN" && !e.repeat) useGame.getState().set({ night: !useGame.getState().night });
      else if (e.code === "KeyE" && !e.repeat) { if (useGarageUi.getState().open) useGarageUi.getState().setOpen(false); else tryOpenGarage(); }
      else if (e.code === "Escape" && !e.repeat) {
        if (useGarageUi.getState().open) useGarageUi.getState().setOpen(false);
        else useGame.getState().setMenu(!useGame.getState().menuOpen);
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = MAP[e.code];
      if (k) controls.key[k] = false;
      else if (e.code === "Space") controls.keyHand = false;
      else if (e.code === "ShiftLeft" || e.code === "ShiftRight") controls.keyNitro = false;
    };
    const blur = () => { Object.keys(controls.key).forEach((k) => ((controls.key as any)[k] = false)); controls.keyHand = controls.keyNitro = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);
}

/** Merge keyboard + touch into analogue-ish inputs. Call once per physics step. */
export function readControls() {
  const k = controls.key, t = controls.touch;
  controls.throttle = k.up || t.up ? 1 : 0;
  controls.brake = k.down || t.down ? 1 : 0;
  // keyboard / arrow buttons are digital, the touch steering pad is analog; they add up (clamped)
  controls.steer = Math.max(-1, Math.min(1, (k.right || t.right ? 1 : 0) - (k.left || t.left ? 1 : 0) + t.steer));
  controls.handbrake = controls.keyHand || t.handbrake;
  controls.nitro = controls.keyNitro || t.nitro;
  return controls;
}
