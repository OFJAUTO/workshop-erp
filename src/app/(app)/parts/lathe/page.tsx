import Link from "next/link";
import { Badge, Card, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { refuse } from "@/lib/refusal";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { latheReady, latheReport, latheSettingsOf, loadLatheTickets } from "@/lib/lathe";
import { ticketStatus, unbilledTooLong } from "@/lib/lathe-rules";
import { LatheBackButton, LatheBillForm, LathePaidForm, LatheSettingsForm } from "@/components/Lathe";
import { dubaiToday } from "@/lib/card-settlements";

export const dynamic = "force-dynamic";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Lathe – open tickets (9 November 2026, Section 8; Parts management). Every ticket sent and not billed yet (red once a
 * month has passed), Back from the lathe, the month-end bill (accounts tick the tickets it covers; the actual cost
 * replaces the estimate on each car), the bills and their one payment, this month's report, and the price list.
 */
export default async function LathePage() {
  const staff = await requireStaff();
  if (!["owner", "parts", "accounts", "workshop_manager"].includes(staff.role_id)) return refuse("no_permission", { path: "/parts/lathe" });
  const settings = await getSettings();
  const cfg = latheSettingsOf(settings);
  const ready = await latheReady();
  const today = dubaiToday();
  const month = today.slice(0, 7);
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const [open, report, { data: sup }, { data: bills }] = await Promise.all([
    loadLatheTickets({ open: true }),
    latheReport(month),
    createAdminClient().from("suppliers").select("name").eq("is_active", true).order("name"),
    ready ? createAdminClient().from("lathe_bills").select("id, supplier_name, bill_number, bill_date, total_aed, paid_at, zoho_bill_id").eq("is_active", true).order("bill_date", { ascending: false }).limit(24) : Promise.resolve({ data: [] }),
  ]);
  const suppliers = ((sup ?? []) as { name: string }[]).map((s) => s.name);
  const money = staff.role_id === "owner" || staff.role_id === "accounts";
  const priceText = cfg.items.map((i) => `${i.item} | ${i.priceTo ? `${i.price}-${i.priceTo}` : i.price}${i.service ? ` | ${i.service}` : ""}`).join("\n");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Lathe – open tickets" subtitle="Outsourced lathe work per car (SUB- tickets), paid once a month. The cost from the price list counts at once; the monthly bill replaces it with the actual cost." />
      {!ready ? <Notice tone="info">Lathe tickets switch on with the database update of 9 November (WAITING FOR APPLY).</Notice> : null}
      <Card className="flex flex-col gap-2" data-lathe-report>
        <SectionLabel>{`This month (${month})`}</SectionLabel>
        <p className="text-sm"><b>{report.tickets}</b> ticket{report.tickets === 1 ? "" : "s"} ({report.billed} billed) · our cost <b>{aed(report.cost)}</b> · charged <b>{aed(report.charged)}</b> · profit <b data-lathe-profit>{aed(report.profit)}</b></p>
      </Card>
      <Card className="flex flex-col gap-2" data-lathe-open>
        <SectionLabel right={`${open.length}`}>Open tickets</SectionLabel>
        {open.length ? (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {open.map((t) => {
              const late = unbilledTooLong(t.sentAt, !!t.billId, nowMs);
              return (
                <li key={t.partId} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${late ? "text-red" : ""}`} data-lathe-ticket={t.ticket}>
                  <span className="font-bold">{t.ticket}</span>
                  <Badge tone={t.backAt ? "green" : "amber"}>{ticketStatus({ lathe_sent_at: t.sentAt, lathe_back_at: t.backAt, lathe_bill_id: t.billId })}</Badge>
                  <Link href={`/parts/${t.jobId}`} className="font-semibold underline underline-offset-4">{t.jobNumber}</Link>
                  <span className="uppercase">{t.plate}</span>
                  <span>{t.item} × {t.qty}</span>
                  <span className="text-muted">{t.supplier} · sent {t.sentAt ? formatDate(t.sentAt) : "–"}{t.takenBy ? ` by ${t.takenBy}` : ""}</span>
                  {money ? <span className="text-muted">estimate {aed(t.estimate)}</span> : null}
                  {late ? <span className="font-semibold" data-lathe-late>not billed after a month</span> : null}
                  {!t.backAt ? <span className="ml-auto"><LatheBackButton partId={t.partId} /></span> : null}
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-muted">No open tickets.</p>}
      </Card>
      {money && ready ? (
        <Card className="flex flex-col gap-3" id="bill">
          <SectionLabel>Enter the monthly bill</SectionLabel>
          <LatheBillForm suppliers={suppliers} tickets={open.map((t) => ({ partId: t.partId, label: `${t.ticket} ${t.jobNumber} · ${t.item} × ${t.qty}`, estimate: t.estimate }))} today={today} />
        </Card>
      ) : null}
      {money && ready ? (
        <Card className="flex flex-col gap-2" data-lathe-bills>
          <SectionLabel>Bills</SectionLabel>
          {(bills ?? []).length ? (
            <ul className="flex flex-col divide-y divide-line text-sm">
              {((bills ?? []) as { id: string; supplier_name: string; bill_number: string; bill_date: string; total_aed: number | string; paid_at: string | null; zoho_bill_id: string | null }[]).map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-lathe-bill={b.bill_number}>
                  <span className="font-bold">{b.bill_number}</span>
                  <span>{b.supplier_name} · {formatDate(b.bill_date)} · {aed(Number(b.total_aed))}</span>
                  <Badge tone={b.zoho_bill_id ? "green" : "neutral"}>{b.zoho_bill_id ? "In Zoho" : "Zoho: with the next Sync"}</Badge>
                  {b.paid_at ? <Badge tone="green">Paid {formatDate(b.paid_at)}</Badge> : <LathePaidForm billId={b.id} today={today} />}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">No bills yet.</p>}
        </Card>
      ) : null}
      {staff.role_id === "owner" || staff.role_id === "parts" ? (
        <Card className="flex flex-col gap-2">
          <SectionLabel>Price list</SectionLabel>
          <LatheSettingsForm text={priceText} threshold={cfg.threshold} minMarkup={cfg.minMarkup} isOwner={staff.role_id === "owner"} />
        </Card>
      ) : null}
    </div>
  );
}
