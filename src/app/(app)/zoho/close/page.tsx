import Link from "next/link";
import { Badge, Card, Empty, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { loadMonthlyClose, validMonth } from "@/lib/zoho-close";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The monthly close checklist (phase 4, accounts + owner): each line green or red, with the Excel export. */

const aed = (n: number) => `AED ${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

function monthsBack(n: number): string[] {
  const out: string[] = [];
  const now = new Date(Date.now() + 4 * 3600 * 1000);
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export default async function ZohoClosePage({ searchParams }: { searchParams: Promise<{ month?: string; message?: string; error?: string }> }) {
  await requirePermission("zohoSync");
  const { month: rawMonth, message, error } = await searchParams;
  const months = monthsBack(6);
  const month = rawMonth && validMonth(rawMonth) ? rawMonth : months[0];
  const data = await loadMonthlyClose(month);
  const allGreen = data.lines.every((l) => l.ok);

  return (
    <>
      <PageHeader
        title="Monthly close"
        subtitle="Everything to tick before calling the month done: the totals against Zoho, what is still owed each way, and a clean sync queue."
        actions={
          <span className="flex flex-wrap gap-2">
            <a href={`/api/export/zoho-close?month=${month}`} className="inline-flex items-center justify-center rounded-control font-bold bg-white text-ink border border-line-strong hover:bg-canvas min-h-11 px-4 text-sm" data-close-export>Excel export</a>
            <LinkButton href="/zoho" tone="secondary">Back to the sync page</LinkButton>
          </span>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex flex-wrap gap-1 text-xs font-bold" data-close-months>
        {months.map((m) => (
          <Link key={m} href={`/zoho/close?month=${m}`} className={`min-h-9 inline-flex items-center rounded-control px-3 ${m === month ? "bg-ink text-white" : "bg-chip"}`}>{m}</Link>
        ))}
      </div>

      <Card className="flex flex-col gap-2" data-close-lines>
        <SectionLabel right={allGreen ? "All green" : "Open items"}>{month}</SectionLabel>
        <ul className="divide-y divide-line">
          {data.lines.map((l) => (
            <li key={l.key} className="py-3 flex flex-col gap-1" data-close-line={l.key} data-close-ok={l.ok ? "1" : "0"}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{l.label}</span>
                <span className="flex-1" />
                {typeof l.amount === "number" && l.amount > 0 ? <span className="text-sm font-bold">{aed(l.amount)}</span> : null}
                {l.ok ? <Badge tone="green">OK ✓</Badge> : <Badge tone="red">Open</Badge>}
              </div>
              <p className={`text-sm ${l.ok ? "text-muted" : "font-semibold text-red"}`}>{l.detail}</p>
            </li>
          ))}
        </ul>
        {!data.lines.length ? <Empty title="Nothing to show" /> : null}
      </Card>
    </>
  );
}
