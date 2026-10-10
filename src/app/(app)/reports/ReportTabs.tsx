import Link from "next/link";
import { LinkButton } from "@/components/ui";
import { monthKey, monthLabel, shiftMonth } from "@/lib/owner-report";

const TABS = [
  { href: "/reports/monthly", label: "Monthly summary" },
  { href: "/reports/cars", label: "Finished cars" },
  { href: "/reports/people", label: "People" },
];

/** The three report pages share one strip: the tabs and the month with its arrows. */
export function ReportTabs({ current, month, pdfHref }: { current: string; month: string; pdfHref?: string | null }) {
  const thisMonth = monthKey();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav className="flex flex-wrap gap-1 rounded-control border border-line p-1">
        {TABS.map((t) => (
          <Link key={t.href} href={`${t.href}?month=${month}`} className={`min-h-9 inline-flex items-center rounded-control px-3 text-sm font-bold ${t.href === current ? "bg-ink text-white" : "text-ink hover:bg-chip"}`}>{t.label}</Link>
        ))}
      </nav>
      <span className="flex items-center gap-1 ml-auto">
        <Link href={`${current}?month=${shiftMonth(month, -1)}`} className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-control border border-line text-lg font-bold" aria-label="Previous month">‹</Link>
        <span className="min-w-36 text-center text-sm font-bold">{monthLabel(month)}</span>
        <Link href={`${current}?month=${shiftMonth(month, 1)}`} className={`min-h-9 min-w-9 inline-flex items-center justify-center rounded-control border border-line text-lg font-bold ${month >= thisMonth ? "pointer-events-none opacity-40" : ""}`} aria-label="Next month">›</Link>
      </span>
      {pdfHref ? <LinkButton href={pdfHref} tone="secondary" size="md">Download PDF</LinkButton> : null}
    </div>
  );
}

export function monthParam(month: string | undefined) {
  return month && /^\d{4}-\d{2}$/.test(month) ? month : monthKey();
}

export const verdictTone = (v: "good" | "acceptable" | "talk") => (v === "good" ? "green" : v === "acceptable" ? "amber" : "red") as "green" | "amber" | "red";
export const aedText = (n: number | null | undefined) => (n === null || n === undefined ? "–" : `AED ${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`);
