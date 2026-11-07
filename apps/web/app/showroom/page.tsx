"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { VEHICLES, buildPhysicsParams, estimatePerformance } from "@road-rivals/shared";
import { api, ApiError, newRequestId, post, type ShowroomCar, type ShowroomView } from "@/services/api";
import { money } from "@/components/Badges";

const Preview = dynamic(() => import("@/game/garage/ShowroomPreview"), { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-slate-500">Loading 3D showroom…</div> });
const LABEL: Record<string, string> = { HATCHBACK: "Hatchback", SEDAN: "Sedan", MUSCLE: "Muscle", SPORTS: "Sports", RACING_GT: "Racing GT", SUPERCAR: "Supercar", HYPERCAR: "Hypercar", OFFROAD: "Off-road" };

/** Same drivetrain model that drives the car in the game (estimatePerformance) – never made-up numbers. */
const perfOf = (c: { baseStats: Record<string, number>; category: string }) => estimatePerformance(buildPhysicsParams(c.baseStats, [], c.category));

function Bar({ label, value, max, text, invert }: { label: string; value: number; max: number; text: string; invert?: boolean }) {
  const pct = Math.max(4, Math.min(100, ((invert ? max / value : value / max)) * 100));
  return <div><div className="flex justify-between text-[11px] text-slate-300"><span>{label}</span><span className="tabular-nums">{text}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-neon" style={{ width: `${pct}%` }} /></div></div>;
}

export default function ShowroomPage() {
  const router = useRouter(); const qc = useQueryClient();
  const [cat, setCat] = useState("ALL");
  const [sel, setSel] = useState<string | null>(null);
  const [gl, setGl] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const q = useQuery({ queryKey: ["showroom"], queryFn: () => api<ShowroomView>("/showroom") });
  useEffect(() => { if (q.error instanceof ApiError && q.error.status === 401) router.replace("/login?next=/showroom"); }, [q.error, router]);
  useEffect(() => { try { const c = document.createElement("canvas"); setGl(!!(c.getContext("webgl2") || c.getContext("webgl"))); } catch { setGl(false); } }, []);

  const d = q.data;
  const list = (d?.vehicles ?? []).filter((v) => cat === "ALL" || v.category === cat);
  const car: ShowroomCar | undefined = d?.vehicles.find((v) => v.slug === sel) ?? d?.vehicles.find((v) => v.active) ?? d?.vehicles[0];
  const perf = useMemo(() => Object.fromEntries(VEHICLES.map((v) => [v.slug, perfOf(v)])), []);
  const best = useMemo(() => ({ hp: Math.max(...Object.values(perf).map((p) => p.powerHp)), top: Math.max(...Object.values(perf).map((p) => p.topSpeedKmh)), acc: Math.min(...Object.values(perf).map((p) => p.zeroTo100)), brk: Math.min(...Object.values(perf).map((p) => p.brake100m)), cor: Math.max(...Object.values(perf).map((p) => p.cornerG)) }), [perf]);
  const p = car ? (perf[car.slug] ?? perfOf(car)) : null;

  const refresh = () => { void qc.invalidateQueries({ queryKey: ["showroom"] }); void qc.invalidateQueries({ queryKey: ["me"] }); void qc.invalidateQueries({ queryKey: ["garage"] }); };
  const buy = useMutation({
    mutationFn: (c: ShowroomCar) => post<{ coins: number; unlocked: { title: string; rewardCoins: number }[] }>("/showroom/buy", { vehicleSlug: c.slug, requestId: newRequestId(), expectedPrice: c.price, setActive: true }),
    onSuccess: (r, c) => { setMsg({ ok: true, text: `${c.name} is yours and now your active car!${r.unlocked?.length ? ` 🏆 ${r.unlocked.map((u) => `${u.title} (+${money(u.rewardCoins)})`).join(", ")}` : ""}` }); refresh(); },
    onError: (e) => setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Network error" }),
  });
  const select = useMutation({
    mutationFn: (c: ShowroomCar) => post("/garage/active", { ownershipId: c.ownershipId }),
    onSuccess: (_r, c) => { setMsg({ ok: true, text: `${c.name} selected` }); refresh(); },
    onError: (e) => setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Network error" }),
  });

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-black">CAR <span className="text-rival">SHOWROOM</span></h1>
        <div className="flex flex-wrap items-center gap-3">
          {d && <span className="font-display text-amber-300" data-testid="showroom-coins">🪙 {money(d.coins)}</span>}
          {d && <span className="text-sm text-slate-300">Level {d.level}</span>}
          <Link href="/inventory" className="btn btn-ghost !py-2">Inventory</Link>
          <Link href="/dashboard" className="btn btn-ghost !py-2">← Dashboard</Link>
        </div>
      </header>
      {msg && <div data-testid="showroom-msg" className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-500/15 text-emerald-200" : "bg-red-500/15 text-red-300"}`}>{msg.text}</div>}

      <div className="flex flex-wrap gap-1">
        {["ALL", ...(d?.categories ?? [])].map((c) => <button key={c} data-testid={`cat-${c}`} onClick={() => setCat(c)} className={`rounded-full px-3 py-1 text-xs ${cat === c ? "bg-rival text-white" : "bg-white/10 text-slate-200"}`}>{c === "ALL" ? "All" : LABEL[c] ?? c}</button>)}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="card h-[40vh] overflow-hidden !p-0 lg:h-[52vh]">
            {car && gl ? <Preview category={car.category} baseStats={car.baseStats} slug={car.slug} /> : <div className="flex h-full items-center justify-center p-6 text-center text-slate-500">{gl === false ? "WebGL is not available – you can still browse and buy." : "Loading…"}</div>}
          </div>
          {car && p && (
            <div className="card space-y-2" data-testid="car-detail">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div><p className="font-display text-xl">{car.name}</p><p className="text-xs text-slate-400">{LABEL[car.category] ?? car.category} · requires level {car.requiredLevel}</p></div>
                <p className="font-display text-xl text-amber-300">{car.price === 0 ? "FREE" : `🪙 ${money(car.price)}`}</p>
              </div>
              <p className="text-xs text-slate-300">{VEHICLES.find((v) => v.slug === car.slug)?.blurb}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Bar label="Power" value={p.powerHp} max={best.hp} text={`${Math.round(p.powerHp)} hp`} />
                <Bar label="Top speed" value={p.topSpeedKmh} max={best.top} text={`${Math.round(p.topSpeedKmh)} km/h`} />
                <Bar label="Acceleration" value={p.zeroTo100} max={best.acc} invert text={`0-100 in ${p.zeroTo100.toFixed(1)} s`} />
                <Bar label="Braking" value={p.brake100m} max={best.brk} invert text={`100 km/h in ${p.brake100m.toFixed(0)} m`} />
                <Bar label="Cornering" value={p.cornerG} max={best.cor} text={`${p.cornerG.toFixed(2)} g`} />
                <div className="text-[11px] text-slate-300">Mass <span className="float-right tabular-nums">{Math.round(p.massKg)} kg</span></div>
              </div>
              <div className="pt-1">
                {car.owned
                  ? car.active ? <p className="text-sm text-emerald-300">✓ Your active car</p>
                    : <button data-testid="select-car" disabled={select.isPending} className="btn btn-primary w-full" onClick={() => select.mutate(car)}>Select this car</button>
                  : <button data-testid="buy-car" disabled={!car.canBuy || buy.isPending} className="btn btn-primary w-full disabled:opacity-50" onClick={() => buy.mutate(car)}>
                      {car.canBuy ? `Buy for ${money(car.price)} coins` : car.reason}
                    </button>}
              </div>
            </div>
          )}
        </div>

        <ul className="grid max-h-[78vh] gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-1" data-testid="car-list">
          {list.map((c) => (
            <li key={c.slug}>
              <button onClick={() => { setSel(c.slug); setMsg(null); }} data-testid={`car-${c.slug}`} className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition ${car?.slug === c.slug ? "border-rival bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10"} ${c.locked && !c.owned ? "opacity-60" : ""}`}>
                <div><p className="font-display text-sm">{c.name}</p><p className="text-xs text-slate-400">{LABEL[c.category] ?? c.category} · {c.baseStats.engineHp} hp</p></div>
                <div className="text-right text-xs">
                  {c.owned ? <span className="text-emerald-300">{c.active ? "ACTIVE" : "OWNED"}</span> : c.locked ? <span className="text-slate-400">🔒 Lv {c.requiredLevel}</span> : <span className="text-amber-300">🪙 {money(c.price)}</span>}
                </div>
              </button>
            </li>
          ))}
          {d && !list.length && <li className="text-sm text-slate-500">No cars in this category.</li>}
        </ul>
      </div>
    </main>
  );
}
