"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BODY_KITS, BUMPERS, DAMAGE_COMPONENTS, DECALS, EXHAUSTS, NEON_COLORS, PAINT_PRESETS, PART_TYPES, PART_TYPE_LABEL, REPAIR_SERVICES,
  RIM_COLORS, SPOILER_STYLES, WHEEL_STYLES, buildPhysicsParams, canInstall, computeDamageEffects, emergencyAllowed, estimatePerformance,
  quoteCustomization, quoteRepair, type ConfigKey, type CustomizeChanges, type Option, type PartTypeKey, type VehicleConfig,
} from "@road-rivals/shared";
import { api, ApiError, newRequestId, post, type GarageOverview, type GarageVehicle, type PartRow } from "@/services/api";
import { view } from "../store";
import { useDamage } from "./damageSync";
import { useGarageUi } from "./garageStore";

type Tab = "repair" | "upgrades" | "customize" | "vehicle";
export interface PanelProps { mode: "world" | "home"; garageSlug?: string; onClose?: () => void }

const LABEL: Record<string, string> = {
  ENGINE: "Engine", FRONT_BUMPER: "Front bumper", REAR_BUMPER: "Rear bumper", DOORS: "Doors", WHEELS: "Wheels",
  TYRES: "Tyres", SUSPENSION: "Suspension", BRAKES: "Brakes", RADIATOR: "Radiator", TRANSMISSION: "Transmission",
};
const money = (n: number) => `🪙 ${n.toLocaleString()}`;
const healthColor = (h: number) => (h > 66 ? "bg-emerald-400" : h > 33 ? "bg-amber-400" : "bg-red-500");

export default function GaragePanel({ mode, garageSlug, onClose }: PanelProps) {
  const qc = useQueryClient();
  const setCoins = useGarageUi((g) => g.setCoins);
  const setPreview = useGarageUi((g) => g.setPreview);
  const uiOpen = useGarageUi((g) => g.open);
  const [tab, setTab] = useState<Tab>("repair");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "good" | "bad" } | null>(null);
  const [ready, setReady] = useState(mode === "home");

  // in the world, push any unsent crash damage to the server first so prices/health are exact
  useEffect(() => {
    if (mode !== "world") return;
    let alive = true;
    (async () => {
      for (let i = 0; i < 3 && useDamage.getState().pending.length; i++) await useDamage.getState().flush();
      await qc.invalidateQueries({ queryKey: ["garage"] });
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, [mode, qc]);

  const overview = useQuery({ queryKey: ["garage"], queryFn: () => api<GarageOverview>("/garage/overview") });
  const partsQ = useQuery({ queryKey: ["parts"], queryFn: () => api<{ parts: PartRow[] }>("/garage/parts") });
  const ov = overview.data;
  const car: GarageVehicle | undefined = ov?.vehicles.find((v) => v.active) ?? ov?.vehicles[0];
  const garage = mode === "world" ? ov?.garages.find((g) => g.slug === garageSlug) : undefined;
  const caps = mode === "home" ? ov?.home.caps : garage?.caps;
  const where = useMemo(() => (mode === "world" ? { garage: garageSlug, pos: { x: view.x, z: view.z } } : {}), [mode, garageSlug, uiOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs = useMemo(() => {
    const t: { id: Tab; label: string }[] = [];
    if (caps && caps.repairs.length) t.push({ id: "repair", label: "🔧 Repair" });
    if (caps?.parts) t.push({ id: "upgrades", label: "⚙️ Upgrades" });
    if (caps?.customize) t.push({ id: "customize", label: "🎨 Customize" });
    t.push({ id: "vehicle", label: "🚗 Vehicle" });
    return t;
  }, [caps]);
  useEffect(() => { if (caps && !tabs.some((t) => t.id === tab)) setTab(tabs[0].id); }, [caps, tabs, tab]); // only once caps are known (else we'd jump to the Vehicle tab)
  useEffect(() => { if (tab !== "customize") setPreview(null); }, [tab, setPreview]);
  useEffect(() => () => useGarageUi.getState().setPreview(null), []);

  async function act<T extends object>(fn: () => Promise<T>, ok: (r: T) => string, after?: (r: T) => void) {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      const c = (r as { coins?: unknown }).coins; if (typeof c === "number") setCoins(c);
      after?.(r);
      setMsg({ text: ok(r), kind: "good" });
      await Promise.all([qc.invalidateQueries({ queryKey: ["garage"] }), qc.invalidateQueries({ queryKey: ["parts"] }), qc.invalidateQueries({ queryKey: ["me"] })]);
    } catch (e) {
      if (e instanceof ApiError) {
        setMsg({ text: e.data.code === "PRICE_CHANGED" ? `${e.message} (now 🪙 ${e.data.cost})` : e.message, kind: "bad" });
        if (e.data.code === "PRICE_CHANGED") await qc.invalidateQueries({ queryKey: ["garage"] });
      } else setMsg({ text: "Network error – try again", kind: "bad" });
    } finally { setBusy(false); }
  }

  if (!ov || !car || !ready) return <div className="card text-center text-slate-400">Loading garage…</div>;
  const coins = ov.coins;

  return (
    <div className="card flex max-h-[92dvh] w-full max-w-3xl flex-col gap-3 overflow-hidden !p-4 short:max-h-full short:gap-2 short:!p-3" data-testid="garage-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg">{mode === "world" ? garage?.name ?? "Garage" : "My Garage"}</h2>
          <p className="text-xs text-slate-400">{car.name} · {car.category} · Level {ov.level}{mode === "home" ? " · home garage (repairs cost 1.5×)" : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-display text-amber-300" data-testid="coins">{money(coins)}</span>
          {onClose && <button className="btn btn-ghost !px-3 !py-1.5 text-sm" onClick={onClose}>Close ✕</button>}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)} className={`btn !px-4 !py-2 text-sm ${tab === t.id ? "btn-primary" : "btn-ghost"}`}>{t.label}</button>
        ))}
      </div>

      {msg && <div data-testid="garage-msg" className={`rounded-lg px-3 py-2 text-sm ${msg.kind === "good" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>{msg.text}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === "repair" && <RepairTab {...{ car, coins, mode, garage, where, busy, act, caps: caps! }} />}
        {tab === "upgrades" && <UpgradesTab {...{ car, level: ov.level, coins, parts: partsQ.data?.parts ?? [], where, busy, act }} />}
        {tab === "customize" && <CustomizeTab {...{ car, coins, where, busy, act }} />}
        {tab === "vehicle" && <VehicleTab {...{ car, ov, busy, act }} />}
      </div>
    </div>
  );
}

type Act = <T extends object>(fn: () => Promise<T>, ok: (r: T) => string, after?: (r: T) => void) => Promise<void>;
type Where = { garage?: string; pos?: { x: number; z: number } };

/* --------------------------------------------------------------- repair */

function RepairTab({ car, coins, mode, garage, where, busy, act, caps }: { car: GarageVehicle; coins: number; mode: "world" | "home"; garage?: GarageOverview["garages"][number]; where: Where; busy: boolean; act: Act; caps: { repairs: string[] } }) {
  const home = mode === "home";
  const priceOf = (code: string) => garage?.services.find((s) => s.code === code)?.basePrice;
  const opts = (code: string) => ({ vehiclePrice: car.price, home, basePrice: priceOf(code) });
  const full = quoteRepair("FULL", car.damage, opts("FULL"));
  const worst = Math.min(...DAMAGE_COMPONENTS.map((c) => car.damage[c]));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <h3 className="font-display text-sm text-slate-300">Condition</h3>
        {DAMAGE_COMPONENTS.map((c) => (
          <div key={c} data-testid={`health-${c}`}>
            <div className="flex justify-between text-xs"><span>{LABEL[c]}</span><span className="tabular-nums">{Math.round(car.damage[c])}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full ${healthColor(car.damage[c])}`} style={{ width: `${car.damage[c]}%` }} /></div>
          </div>
        ))}
        {worst >= 99.5 && <p className="text-xs text-emerald-300">Factory condition – nothing to repair.</p>}
      </div>
      <div className="space-y-2">
        <h3 className="font-display text-sm text-slate-300">Services</h3>
        {REPAIR_SERVICES.filter((s) => caps.repairs.includes(s.code)).map((s) => {
          const q = quoteRepair(s.code, car.damage, opts(s.code));
          if (!q) return null;
          const emergency = s.code === "EMERGENCY";
          const allowed = emergency ? emergencyAllowed(coins, full?.cost ?? 0) : coins >= q.cost;
          const disabled = busy || !q.needed || !allowed;
          return (
            <div key={s.code} className="rounded-xl border border-white/10 p-3">
              <div className="flex items-start justify-between gap-2">
                <div><p className="text-sm font-semibold">{s.name}</p><p className="text-xs text-slate-400">{s.description}</p></div>
                <span className="whitespace-nowrap text-sm text-amber-300">{emergency ? "FREE" : money(q.cost)}</span>
              </div>
              <button
                data-testid={`repair-${s.code}`} disabled={disabled} className="btn btn-primary mt-2 w-full !py-1.5 text-sm"
                title={!q.needed ? "Nothing to fix" : !allowed ? (emergency ? "Only when you cannot afford a full repair" : "Not enough coins") : ""}
                onClick={() => act(
                  () => post<{ coins: number; cost: number; damage: Record<string, number> }>("/garage/repair", { ownershipId: car.ownershipId, service: s.code, expectedCost: q.cost, requestId: newRequestId(), ...where }),
                  (r) => `${s.name} done${r.cost ? ` for ${money(r.cost)}` : ""}`,
                  (r) => { if (car.active) useDamage.getState().setBaseline(r.damage); },
                )}
              >{!q.needed ? "Nothing to repair" : !allowed ? (emergency ? "Not available" : "Not enough coins") : emergency ? "Apply emergency patch" : `Repair · ${money(q.cost)}`}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- upgrades */

function UpgradesTab({ car, level, coins, parts, where, busy, act }: { car: GarageVehicle; level: number; coins: number; parts: PartRow[]; where: Where; busy: boolean; act: Act }) {
  const [type, setType] = useState<PartTypeKey>("ENGINE");
  const installed = (t: string) => car.upgrades.find((u) => u.slot === t);
  const installedParts = useMemo(() => car.upgrades.map((u) => ({ type: u.slot, physicsModifiers: u.physicsModifiers })), [car]);
  const fx = useMemo(() => computeDamageEffects(car.damage), [car]);
  const perf = (list: { type: string; physicsModifiers: Record<string, number> }[]) => estimatePerformance(buildPhysicsParams(car.baseStats, list, car.category), fx);
  const current = useMemo(() => perf(installedParts), [installedParts, fx]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = parts.filter((p) => p.type === type);
  const deltas = useMemo(() => Object.fromEntries(options.map((p) => [p.slug, perf([...installedParts.filter((x) => x.type !== type), { type: p.type, physicsModifiers: p.physicsModifiers }])])), [options.length, type, installedParts, fx, parts]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {PART_TYPES.map((t) => (
          <button key={t} data-testid={`ptype-${t}`} onClick={() => setType(t)} className={`rounded-lg border px-2.5 py-1 text-xs ${type === t ? "border-neon text-neon" : "border-white/15 text-slate-300"}`}>
            {PART_TYPE_LABEL[t]}{installed(t) ? " ●" : ""}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-400">
        Installed: {installed(type) ? <span className="text-slate-200">{installed(type)!.name}</span> : "stock"}. Numbers below come from the same physics model that drives the car.
      </p>
      <div className="space-y-2">
        {options.map((p) => {
          const isInstalled = installed(type)?.partSlug === p.slug;
          const chk = canInstall({ ...p, compatibleCategories: p.compatibleCategories }, car.category, level);
          const e = deltas[p.slug];
          const d = (a: number, b: number, unit: string, better: "low" | "high", digits = 1) => {
            const diff = a - b;
            if (Math.abs(diff) < 0.005) return <span className="text-slate-500">{a.toFixed(digits)}{unit}</span>;
            const good = better === "low" ? diff < 0 : diff > 0;
            return <span className={good ? "text-emerald-300" : "text-red-300"}>{a.toFixed(digits)}{unit} <small>({diff > 0 ? "+" : ""}{diff.toFixed(digits)})</small></span>;
          };
          const canBuy = chk.ok && coins >= p.price;
          return (
            <div key={p.slug} data-testid={`part-${p.slug}`} className={`rounded-xl border p-3 ${isInstalled ? "border-neon/60 bg-neon/5" : "border-white/10"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{p.name} <span className="text-xs font-normal text-slate-500">T{p.tier}</span></p>
                  <p className="text-xs text-slate-400">{p.blurb}</p>
                  {!chk.ok && <p className="text-xs text-red-300">🔒 {chk.message}</p>}
                </div>
                <span className="whitespace-nowrap text-sm text-amber-300">{p.price ? money(p.price) : "Stock"}</span>
              </div>
              {chk.ok && e && (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-300 sm:grid-cols-4">
                  <span>0-100 {d(e.zeroTo100, current.zeroTo100, "s", "low", 2)}</span>
                  <span>Top {d(e.topSpeedKmh, current.topSpeedKmh, "", "high", 0)}</span>
                  <span>Brake {d(e.brake100m, current.brake100m, "m", "low", 0)}</span>
                  <span>Corner {d(e.cornerG, current.cornerG, "g", "high", 2)}</span>
                  <span>Mass {d(e.massKg, current.massKg, "kg", "low", 0)}</span>
                  <span>Cooling {d(e.cooling, current.cooling, "×", "high", 2)}</span>
                  <span>Nitro {d(e.nitroS, current.nitroS, "s", "high", 1)}</span>
                  <span>Armor {d(e.durabilityPct, current.durabilityPct, "%", "high", 0)}</span>
                </div>
              )}
              <div className="mt-2 flex gap-2">
                {isInstalled ? (
                  <>
                    <span className="flex-1 rounded-lg bg-neon/15 py-1.5 text-center text-sm text-neon">Installed</span>
                    {p.price > 0 && <button disabled={busy} className="btn btn-ghost !py-1.5 text-sm" onClick={() => act(() => post<{ ok: boolean }>("/garage/parts/uninstall", { ownershipId: car.ownershipId, slot: p.type, ...where }), () => `${p.name} removed (kept in your inventory)`)}>Remove</button>}
                  </>
                ) : p.owned > 0 || p.price === 0 ? (
                  <button data-testid={`install-${p.slug}`} disabled={busy || !chk.ok} className="btn btn-primary flex-1 !py-1.5 text-sm"
                    onClick={() => act(() => post<{ ok: boolean }>("/garage/parts/install", { ownershipId: car.ownershipId, partSlug: p.slug, ...where }), () => `${p.name} installed – the car now drives differently`)}>
                    Install{p.owned > 0 ? ` (owned ×${p.owned})` : ""}
                  </button>
                ) : (
                  <button data-testid={`buy-${p.slug}`} disabled={busy || !canBuy} className="btn btn-primary flex-1 !py-1.5 text-sm"
                    onClick={() => act(() => post<{ coins: number }>("/garage/parts/buy", { partSlug: p.slug, install: true, ownershipId: car.ownershipId, requestId: newRequestId(), ...where }), () => `Bought and installed ${p.name}`)}>
                    {!chk.ok ? "Locked" : coins < p.price ? "Not enough coins" : `Buy & install · ${money(p.price)}`}
                  </button>
                )}
                {!isInstalled && p.owned === 0 && p.price > 0 && chk.ok && (
                  <button disabled={busy || coins < p.price} className="btn btn-ghost !py-1.5 text-sm" title="Buy to inventory without installing"
                    onClick={() => act(() => post<{ coins: number }>("/garage/parts/buy", { partSlug: p.slug, requestId: newRequestId(), ...where }), () => `${p.name} added to your inventory`)}>Buy only</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ customize */

function CustomizeTab({ car, coins, where, busy, act }: { car: GarageVehicle; coins: number; where: Where; busy: boolean; act: Act }) {
  const setPreview = useGarageUi((s) => s.setPreview);
  const [draft, setDraft] = useState<CustomizeChanges>({});
  useEffect(() => { setDraft({}); }, [car.ownershipId, car.config]);
  useEffect(() => { setPreview(Object.keys(draft).length ? (draft as Partial<VehicleConfig>) : null); }, [draft, setPreview]);

  const merged = { ...car.config, ...draft } as VehicleConfig;
  const quote = quoteCustomization(car.config, draft);
  const set = (k: ConfigKey, v: string | null) => setDraft((d) => ({ ...d, [k]: v } as CustomizeChanges));

  const chips = (k: ConfigKey, list: Option[]) => (
    <div className="flex flex-wrap gap-1.5">
      {list.map((o) => (
        <button key={o.id} data-testid={`opt-${k}-${o.id}`} onClick={() => set(k, o.id)}
          className={`rounded-lg border px-2.5 py-1 text-xs ${merged[k] === o.id ? "border-neon text-neon" : "border-white/15 text-slate-300"}`}>
          {o.name}{o.price ? <span className="ml-1 text-amber-300/80">{o.price}</span> : null}
        </button>
      ))}
    </div>
  );
  const row = (title: string, children: React.ReactNode) => <div key={title}><p className="mb-1 text-xs text-slate-400">{title}</p>{children}</div>;

  return (
    <div className="space-y-3">
      {row("Paint (preview is live on the car)", (
        <div className="flex flex-wrap items-center gap-1.5">
          {PAINT_PRESETS.map((p) => (
            <button key={p.id} data-testid={`paint-${p.id}`} title={`${p.name} · ${p.price}`} onClick={() => set("paint", p.color)}
              className={`h-7 w-7 rounded-full border-2 ${merged.paint.toLowerCase() === p.color ? "border-white" : "border-transparent"}`} style={{ background: p.color }} />
          ))}
          <label className="ml-2 flex items-center gap-1 text-xs text-slate-400">custom
            <input type="color" value={merged.paint} onChange={(e) => set("paint", e.target.value)} className="h-7 w-9 cursor-pointer rounded bg-transparent" />
          </label>
        </div>
      ))}
      {row("Wheels", chips("wheels", WHEEL_STYLES))}
      {row("Rim colour", (
        <div className="flex flex-wrap gap-1.5">{RIM_COLORS.map((o) => (
          <button key={o.id} data-testid={`opt-rims-${o.id}`} onClick={() => set("rims", o.id)} className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${merged.rims === o.id ? "border-neon text-neon" : "border-white/15 text-slate-300"}`}>
            <i className="inline-block h-3 w-3 rounded-full" style={{ background: o.color }} />{o.name}{o.price ? <span className="text-amber-300/80">{o.price}</span> : null}
          </button>))}</div>
      ))}
      {row("Spoiler style (the aero SPOILER part is under Upgrades)", chips("spoiler", SPOILER_STYLES))}
      {row("Body kit", chips("bodyKit", BODY_KITS))}
      {row("Bumpers", chips("bumpers", BUMPERS))}
      {row("Decals", chips("decal", DECALS))}
      {row("Underglow", (
        <div className="flex flex-wrap gap-1.5">{NEON_COLORS.map((o) => (
          <button key={o.id} data-testid={`opt-neon-${o.id}`} onClick={() => set("neon", o.id === "none" ? null : o.id)}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${(merged.neon ?? "none") === o.id ? "border-neon text-neon" : "border-white/15 text-slate-300"}`}>
            {o.id !== "none" && <i className="inline-block h-3 w-3 rounded-full" style={{ background: o.color }} />}{o.name}{o.price ? <span className="text-amber-300/80">{o.price}</span> : null}
          </button>))}</div>
      ))}
      {row("Exhaust", chips("exhaust", EXHAUSTS))}

      <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0b0d14]/95 p-3 backdrop-blur">
        <span className="text-sm">{quote.items.length ? `${quote.items.length} change(s) · ` : "No changes"}<b className="text-amber-300">{quote.cost ? money(quote.cost) : ""}</b></span>
        <div className="flex gap-2">
          <button className="btn btn-ghost !py-1.5 text-sm" disabled={!quote.items.length || busy} onClick={() => setDraft({})}>Reset</button>
          <button data-testid="apply-custom" className="btn btn-primary !py-1.5 text-sm" disabled={!quote.items.length || busy || coins < quote.cost}
            onClick={() => act(() => post<{ coins: number; cost: number }>("/garage/customize", { ownershipId: car.ownershipId, changes: draft, expectedCost: quote.cost, requestId: newRequestId(), ...where }), (r) => `Customization applied for ${money(r.cost)}`)}>
            {coins < quote.cost ? "Not enough coins" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- vehicle */

function VehicleTab({ car, ov, busy, act }: { car: GarageVehicle; ov: GarageOverview; busy: boolean; act: Act }) {
  const parts = car.upgrades.map((u) => ({ type: u.slot, physicsModifiers: u.physicsModifiers }));
  const params = useMemo(() => buildPhysicsParams(car.baseStats, parts, car.category), [car]); // eslint-disable-line react-hooks/exhaustive-deps
  const stockPerf = useMemo(() => estimatePerformance(buildPhysicsParams(car.baseStats, [], car.category)), [car]);
  const now = useMemo(() => estimatePerformance(params, computeDamageEffects(car.damage)), [params, car.damage]);
  const clean = useMemo(() => estimatePerformance(params), [params]);
  const penalty = clean.zeroTo100 > 0 ? (now.zeroTo100 / clean.zeroTo100 - 1) * 100 : 0;
  const stat = (label: string, v: number, ref0: number, unit: string, digits = 0, low = false) => {
    const better = low ? v < ref0 - 1e-6 : v > ref0 + 1e-6, worse = low ? v > ref0 + 1e-6 : v < ref0 - 1e-6;
    return <div key={label} className="rounded-lg bg-white/5 p-2"><p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`font-display text-lg ${better ? "text-emerald-300" : worse ? "text-red-300" : ""}`}>{v.toFixed(digits)}<small className="ml-0.5 text-xs text-slate-400">{unit}</small></p></div>;
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="vehicle-stats">
        {stat("Power", now.powerHp, stockPerf.powerHp, "hp")}
        {stat("0-100", now.zeroTo100, stockPerf.zeroTo100, "s", 2, true)}
        {stat("Top speed", now.topSpeedKmh, stockPerf.topSpeedKmh, "km/h")}
        {stat("100→0", now.brake100m, stockPerf.brake100m, "m", 0, true)}
        {stat("Cornering", now.cornerG, stockPerf.cornerG, "g", 2)}
        {stat("Mass", now.massKg, stockPerf.massKg, "kg", 0, true)}
        {stat("Cooling", now.cooling, stockPerf.cooling, "×", 2)}
        {stat("Nitro", now.nitroS, stockPerf.nitroS, "s", 1)}
      </div>
      <p className="text-xs text-slate-400">Green/red compare with the stock {car.name}. {penalty > 1 ? <span className="text-red-300">Damage is costing you {penalty.toFixed(0)}% acceleration.</span> : "No damage penalty."}</p>
      <div>
        <h3 className="mb-1 font-display text-sm text-slate-300">Installed upgrades</h3>
        {car.upgrades.length === 0 ? <p className="text-xs text-slate-500">Stock car. Visit the Upgrades tab.</p> :
          <ul className="grid gap-1 text-sm sm:grid-cols-2">{car.upgrades.map((u) => <li key={u.slot} className="rounded-lg bg-white/5 px-3 py-1.5">{PART_TYPE_LABEL[u.slot as PartTypeKey] ?? u.slot}: <b>{u.name}</b></li>)}</ul>}
      </div>
      <div>
        <h3 className="mb-1 font-display text-sm text-slate-300">Your cars</h3>
        <div className="space-y-1">
          {ov.vehicles.map((v) => (
            <div key={v.ownershipId} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm">
              <span>{v.name} <span className="text-xs text-slate-500">{v.category}</span></span>
              {v.active ? <span className="text-xs text-neon">Active</span> :
                <button disabled={busy} className="btn btn-ghost !py-1 text-xs" onClick={() => act(() => post<{ ok: boolean }>("/garage/active", { ownershipId: v.ownershipId }), () => `${v.name} is now your active car`)}>Drive this</button>}
            </div>
          ))}
        </div>
        {ov.vehicles.length === 1 && <p className="mt-1 text-xs text-slate-500">More cars arrive with the Showroom (Phase 6).</p>}
      </div>
    </div>
  );
}
