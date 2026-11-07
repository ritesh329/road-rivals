"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PART_TYPE_LABEL, type PartTypeKey } from "@road-rivals/shared";
import { api, ApiError, post, type GarageOverview, type PartRow } from "@/services/api";
import { money } from "@/components/Badges";

export default function InventoryPage() {
  const router = useRouter(); const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const q = useQuery({ queryKey: ["garage"], queryFn: () => api<GarageOverview & { parts: PartRow[] }>("/garage/overview") });
  useEffect(() => { if (q.error instanceof ApiError && q.error.status === 401) router.replace("/login?next=/inventory"); }, [q.error, router]);
  const select = useMutation({
    mutationFn: (id: string) => post("/garage/active", { ownershipId: id }),
    onSuccess: () => { setMsg("Active car changed"); void qc.invalidateQueries({ queryKey: ["garage"] }); void qc.invalidateQueries({ queryKey: ["me"] }); },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : "Network error"),
  });
  const d = q.data;
  const parts = (d?.parts ?? []).filter((p) => p.owned > 0);
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-black">IN<span className="text-rival">VENTORY</span></h1>
        <div className="flex gap-2"><Link href="/showroom" className="btn btn-primary !py-2">Showroom</Link><Link href="/garage" className="btn btn-ghost !py-2">Garage</Link><Link href="/dashboard" className="btn btn-ghost !py-2">← Dashboard</Link></div>
      </header>
      {msg && <div className="rounded-lg bg-white/10 px-3 py-2 text-sm" data-testid="inventory-msg">{msg}</div>}
      <section className="space-y-2">
        <h2 className="font-display text-lg">My cars ({d?.vehicles.length ?? 0})</h2>
        <div className="grid gap-3 sm:grid-cols-2" data-testid="owned-cars">
          {d?.vehicles.map((v) => (
            <div key={v.ownershipId} className={`card space-y-1 ${v.active ? "border-rival/70" : ""}`}>
              <div className="flex items-start justify-between"><div><p className="font-display">{v.name}</p><p className="text-xs text-slate-400">{v.category} · {v.baseStats.engineHp} hp · {v.upgrades.length} upgrades</p></div><span className="h-5 w-5 rounded-full border border-white/30" style={{ background: v.config.paint }} /></div>
              <div className="flex items-center justify-between pt-1 text-xs">
                <span className={Object.values(v.damage).some((h) => h < 99) ? "text-amber-300" : "text-slate-400"}>{Object.values(v.damage).some((h) => h < 99) ? "Damaged – visit a garage" : "Perfect condition"}</span>
                {v.active ? <span className="text-emerald-300">ACTIVE</span> : <button className="btn btn-ghost !px-3 !py-1 text-xs" disabled={select.isPending} onClick={() => select.mutate(v.ownershipId)}>Select</button>}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="font-display text-lg">Parts in storage</h2>
        {parts.length ? (
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="owned-parts">
            {parts.map((p) => <li key={p.slug} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm"><span>{p.name} <span className="text-xs text-slate-400">· {PART_TYPE_LABEL[p.type as PartTypeKey] ?? p.type} tier {p.tier}</span></span><span className="text-xs text-slate-300">×{p.owned} · worth {money(p.price)}</span></li>)}
          </ul>
        ) : <p className="text-sm text-slate-500">No spare parts. Parts you remove or buy without installing appear here – install them in the <Link href="/garage" className="underline">garage</Link>.</p>}
      </section>
    </main>
  );
}
