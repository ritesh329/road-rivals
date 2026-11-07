import { TIER_INFO, type TierKey } from "@road-rivals/shared";

export function TierBadge({ tier }: { tier: string }) {
  const t = TIER_INFO[tier as TierKey] ?? TIER_INFO.BRONZE;
  return <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: t.color, borderColor: t.color + "88" }} data-testid="tier-badge">{t.label}</span>;
}
export const money = (n: number) => n.toLocaleString();
