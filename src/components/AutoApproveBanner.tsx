import Link from "next/link";
import { autoApprovedList, autoNow, dubaiToday } from "@/lib/auto-approve";
import { activeWords, summaryWords } from "@/lib/auto-approve-rules";

/** The owner's dashboard line while auto-approve is ON (12 November 2026), with today's count; a tap opens the switches. */
export async function AutoApproveBanner() {
  const now = await autoNow();
  if (!now.active) return null;
  const today = await autoApprovedList({ since: new Date(`${dubaiToday()}T00:00:00+04:00`).toISOString(), limit: 500 });
  return (
    <Link href="/settings/approvals" className="flex flex-col gap-0.5 rounded-card border-2 border-amber-bar bg-amber-soft px-4 py-3 text-sm hover:border-ink" data-auto-dashboard>
      <span className="font-extrabold">{activeWords(now.cfg)}</span>
      <span className="text-xs">{summaryWords(today.length, today.reduce((a, r) => a + r.cost, 0))} · tap to change or switch off</span>
    </Link>
  );
}
