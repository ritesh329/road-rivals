"use client";
import { DAMAGE_COMPONENTS, OVERHEAT_START } from "@road-rivals/shared";
import { useGame } from "../store";
import { useDamage } from "../garage/damageSync";
import { useGarageUi } from "../garage/garageStore";
import { useRace } from "../race/raceStore";

const SHORT: Record<string, string> = { ENGINE: "ENG", FRONT_BUMPER: "FRT", REAR_BUMPER: "REAR", DOORS: "DOOR", WHEELS: "WHL", TYRES: "TYR", SUSPENSION: "SUSP", BRAKES: "BRK", RADIATOR: "RAD", TRANSMISSION: "GBX" };

const fmt = (ms: number | null) => {
  if (ms === null) return "--:--.---";
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), x = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(x).padStart(3, "0")}`;
};

export default function Hud() {
  const hud = useGame((s) => s.hud);
  const racing = useRace((s) => s.phase === "countdown" || s.phase === "running");
  const circuit = useGame((s) => s.circuit);
  const near = useGame((s) => s.nearGarage);
  const health = useDamage((s) => s.health);
  const toast = useGarageUi((s) => s.toast);
  const coins = useGarageUi((s) => s.coins);
  const garageOpen = useGarageUi((s) => s.open);
  const hurt = DAMAGE_COMPONENTS.some((c) => health[c] < 99);
  const pct = Math.min(1, hud.rpm / hud.redline);
  const gear = hud.gear === -1 ? "R" : hud.gear;
  return (
    <div className="pointer-events-none absolute inset-0 select-none font-display text-white">
      {/* circuit timer */}
      {!racing && <div className="absolute left-1/2 top-2 max-w-[46vw] -translate-x-1/2 rounded-lg bg-black/45 px-4 py-2 text-center backdrop-blur short:px-3 short:py-1">
        <div className="text-[10px] tracking-[0.3em] text-neon short:tracking-[0.2em]">{circuit.running ? `LAP ${circuit.lap} · CP ${circuit.next}` : "FREE ROAM"}</div>
        <div className="text-xl tabular-nums short:text-base">{fmt(circuit.running ? circuit.lapMs : null)}</div>
        <div className="text-[10px] text-slate-300">Best {fmt(circuit.bestMs)}<span className="short:hidden"> · Last {fmt(circuit.lastMs)}</span></div>
        <div className="truncate text-[10px] text-slate-400 short:hidden">{circuit.message}</div>
      </div>}

      {near && (
        <div className="absolute left-1/2 top-28 -translate-x-1/2 whitespace-nowrap rounded-full border border-neon/60 bg-black/60 px-4 py-1 text-sm text-neon short:top-[66px] short:text-xs">
          📍 {near} <span className="touch:hidden">— press <b>E</b> to open the garage</span><span className="hidden touch:inline">— tap GARAGE</span>
        </div>
      )}
      {coins !== null && <div className="absolute right-[88px] top-2 rounded-lg bg-black/45 px-3 py-2 text-sm text-amber-300 backdrop-blur short:px-2 short:py-1.5 short:text-xs" data-testid="hud-coins">🪙 {coins.toLocaleString()}</div>}
      {toast && <div key={toast.id} data-testid="toast" className={`absolute left-1/2 top-48 -translate-x-1/2 rounded-lg px-4 py-2 text-sm backdrop-blur short:top-[150px] short:py-1 short:text-xs ${toast.kind === "good" ? "bg-emerald-500/25 text-emerald-200" : toast.kind === "bad" ? "bg-red-500/25 text-red-200" : "bg-black/60 text-slate-100"}`}>{toast.text}</div>}
      {hud.temp > OVERHEAT_START && <div className="absolute left-1/2 top-40 -translate-x-1/2 animate-pulse whitespace-nowrap text-xl font-black text-red-400 short:top-[94px] short:text-base">ENGINE OVERHEATING</div>}
      {hurt && !garageOpen && (
        <div className="absolute bottom-24 left-3 w-40 rounded-xl bg-black/50 p-2 backdrop-blur sm:bottom-6 touch:tall:bottom-24 short:bottom-auto short:left-[130px] short:top-2 short:w-32 short:p-1.5" data-testid="hud-condition">
          <div className="mb-1 text-[10px] tracking-[0.25em] text-slate-300">CONDITION</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {DAMAGE_COMPONENTS.map((c) => (
              <div key={c}><div className="flex justify-between text-[9px] text-slate-300"><span>{SHORT[c]}</span><span>{Math.round(health[c])}</span></div>
                <div className="h-1 overflow-hidden rounded-full bg-white/15"><div className={`h-full ${health[c] > 66 ? "bg-emerald-400" : health[c] > 33 ? "bg-amber-400" : "bg-red-500"}`} style={{ width: `${health[c]}%` }} /></div></div>
            ))}
          </div>
        </div>
      )}
      {hud.drifting && <div className="absolute left-1/2 top-40 -translate-x-1/2 text-2xl font-black italic text-amber-300 drop-shadow short:top-[94px] short:text-xl">DRIFT!</div>}

      {/* speedo */}
      <div className="absolute bottom-24 right-4 w-56 rounded-xl bg-black/50 p-3 backdrop-blur sm:bottom-6 touch:tall:bottom-24 short:bottom-[136px] short:right-2 short:w-36 short:p-2">
        <div className="flex items-end justify-between">
          <div><span className="text-5xl font-black tabular-nums short:text-3xl">{Math.round(hud.speedKmh)}</span><span className="ml-1 text-xs text-slate-300">km/h</span></div>
          <div className={`text-4xl font-black short:text-2xl ${hud.shifting ? "text-slate-500" : "text-rival"}`}>{gear}</div>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15">
          <div className={`h-full ${hud.limiter || pct > 0.92 ? "bg-red-500" : "bg-neon"}`} style={{ width: `${pct * 100}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-slate-300"><span>{Math.round(hud.rpm)} rpm</span>{hud.boost > 0.3 && <span className="text-sky-300">TURBO</span>}</div>
        <div className="short:hidden"><div className="mt-2 flex justify-between text-[10px] tracking-widest text-slate-400"><span>ENGINE TEMP</span><span className={hud.temp > OVERHEAT_START ? "text-red-400" : ""}>{Math.round(hud.temp * 100)}%</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/15"><div className={`h-full ${hud.temp > OVERHEAT_START ? "bg-red-500" : hud.temp > 0.6 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(100, hud.temp * 100)}%` }} /></div></div>
        <div className="mt-2 text-[10px] tracking-widest text-slate-400 short:mt-1 short:text-[8px]">NITRO</div>
        <div className="h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full bg-sky-400" style={{ width: `${hud.nitro * 100}%` }} /></div>
      </div>
    </div>
  );
}
