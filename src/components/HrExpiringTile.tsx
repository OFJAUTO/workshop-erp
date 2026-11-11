import Link from "next/link";
import { hrExpiring } from "@/lib/hr";

/** The dashboard tile for the owner and the head accountant (11 November 2026, Section 15): "Documents expiring (n)". */
export async function HrExpiringTile() {
  const items = await hrExpiring().catch(() => []);
  const expired = items.filter((i) => i.stage === 0).length;
  return (
    <Link href="/team/hr" className={`flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 rounded-card border-2 px-4 py-3 ${expired ? "border-red-bar bg-red-soft" : items.length ? "border-amber-bar bg-amber-soft" : "border-line bg-white"}`} data-tile="hr-expiring" data-tile-count={items.length}>
      <span className="text-xs font-extrabold uppercase tracking-[0.08em]">Documents expiring ({items.length})</span>
      <span className="text-sm text-muted">{items.length ? `${expired ? `${expired} expired · ` : ""}${items.length - expired} expiring soon` : "All HR documents in date"}</span>
    </Link>
  );
}
