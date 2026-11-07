"use client";
import type { VehiclePhysicsParams } from "@road-rivals/shared";
import type { ActiveCar } from "../components/GameCanvas";
import GaragePanel from "./GaragePanel";
import { useGarageUi } from "./garageStore";

/** In-world garage: opens with E / GARAGE button on a garage pad; the car is held still (see Vehicle.tsx). */
export default function GarageOverlay(_props: { car: ActiveCar; params: VehiclePhysicsParams }) {
  const open = useGarageUi((s) => s.open);
  const near = useGarageUi((s) => s.near);
  const setOpen = useGarageUi((s) => s.setOpen);
  if (!open || !near) return null;
  return (
    <div className="pointer-events-auto absolute inset-y-0 right-0 z-30 flex w-full max-w-2xl items-center p-2 sm:p-5 short:p-2" style={{ paddingTop: "max(0.5rem, var(--sat))", paddingRight: "max(0.5rem, var(--sar))", paddingBottom: "max(0.5rem, var(--sab))", paddingLeft: "max(0.5rem, var(--sal))" }}>
      <GaragePanel mode="world" garageSlug={near.slug} onClose={() => setOpen(false)} />
    </div>
  );
}
