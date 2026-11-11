import Link from "next/link";
import { Badge, Card, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { refuse } from "@/lib/refusal";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { latheReady, latheReport, latheSettingsOf, latheShops, latheV2Ready, loadLatheTickets } from "@/lib/lathe";
import { LatheBillEntry, LatheBillRow, type LatheBillView } from "@/components/LatheBills";
import { signJobFiles } from "@/lib/work-data";
import { ticketStatus, unbilledTooLong } from "@/lib/lathe-rules";
import { LatheBackButton, LathePaidForm, LatheSettingsForm } from "@/components/Lathe";
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
  // 11 November 2026 (Section 6): voided bills stay on the list (marked VOID); bills are paid through Supplier payments.
  const v2 = ready && (await latheV2Ready());
  const [open, report, shops, { data: bills }] = await Promise.all([
    loadLatheTickets({ open: true }),
    latheReport(month),
    latheShops(),
    ready ? createAdminClient().from("lathe_bills").select(`id, supplier_name, bill_number, bill_date, before_vat_aed, vat_aed, total_aed, paid_at, zoho_bill_id, is_active${v2 ? ", edit_history, voided_at, void_requested_at" : ""}`).order("bill_date", { ascending: false }).limit(40) : Promise.resolve({ data: [] }),
  ]);
  type B = { id: string; supplier_name: string; bill_number: string; bill_date: string; before_vat_aed: number | string; vat_aed: number | string; total_aed: number | string; paid_at: string | null; zoho_bill_id: string | null; is_active: boolean; edit_history?: LatheBillView["history"] | null; voided_at?: string | null; void_requested_at?: string | null };
  const billRows = ((bills ?? []) as unknown as B[]).filter((b) => b.is_active || b.voided_at);
  const ids = billRows.map((b) => b.id);
  const [{ data: fileRows }, { data: tix }] = await Promise.all([
    ids.length ? createAdminClient().from("job_files").select("id, storage_path, caption, content_type, ref_id").eq("kind", "supplier_invoice").in("ref_id", ids).is("removed_at", null) : Promise.resolve({ data: [] }),
    ids.length ? createAdminClient().from("part_items").select("lathe_bill_id").in("lathe_bill_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const files = (fileRows ?? []) as { id: string; storage_path: string; caption: string | null; content_type: string | null; ref_id: string }[];
  const urls = files.length ? await signJobFiles(files.map((x) => x.storage_path)) : {};
  const views: LatheBillView[] = billRows.map((b) => ({
    id: b.id, shop: b.supplier_name, number: b.bill_number, date: String(b.bill_date).slice(0, 10), beforeVat: Number(b.before_vat_aed) || 0, vat: Number(b.vat_aed) || 0, total: Number(b.total_aed) || 0, paid: !!b.paid_at, inZoho: !!b.zoho_bill_id, voided: !!b.voided_at, voidAsked: !!b.void_requested_at,
    tickets: ((tix ?? []) as { lathe_bill_id: string }[]).filter((t) => t.lathe_bill_id === b.id).length,
    hasFile: files.some((x) => x.ref_id === b.id),
    files: files.filter((x) => x.ref_id === b.id).map((x) => ({ id: x.id, path: x.storage_path, url: urls[x.storage_path] ?? null, caption: x.caption, contentType: x.content_type, refId: x.ref_id })),
    history: (b.edit_history ?? []) as LatheBillView["history"],
  }));
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
          <LatheBillEntry shops={shops} tickets={open.map((t) => ({ partId: t.partId, shop: t.supplier, label: `${t.ticket} ${t.jobNumber} · ${t.item} × ${t.qty}`, estimate: t.estimate, sentAt: t.sentAt }))} today={today} existing={views.filter((v) => !v.voided).map((v) => `${v.shop.trim().toUpperCase()}|${v.number.trim().toUpperCase()}`)} />
        </Card>
      ) : null}
      {money && ready ? (
        <Card className="flex flex-col gap-2" data-lathe-bills>
          <SectionLabel>Bills</SectionLabel>
          {views.length ? (
            <ul className="flex flex-col divide-y divide-line text-sm">
              {views.map((b) => (
                <li key={b.id} className={`flex flex-col gap-1 py-2 ${b.voided ? "text-muted" : ""}`} data-lathe-bill={b.number} data-lathe-bill-voided={b.voided ? "1" : undefined}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={`font-bold ${b.voided ? "line-through" : ""}`}>{b.number}</span>
                    <span>{b.shop} · {formatDate(b.date)} · {aed(b.total)} · {b.tickets} ticket{b.tickets === 1 ? "" : "s"}</span>
                    {b.voided ? <Badge tone="neutral">VOID</Badge> : null}
                    {!b.voided ? <Badge tone={b.inZoho ? "green" : "neutral"}>{b.inZoho ? "In Zoho" : "Zoho: with the next Sync"}</Badge> : null}
                    {!b.voided && !b.hasFile ? <span className="rounded-full border border-amber-bar bg-amber-soft px-2 py-0.5 text-xs font-bold text-amber-text" data-lathe-no-file>No invoice attached</span> : null}
                    {b.voidAsked ? <Badge tone="amber">Void asked · waiting for the owner</Badge> : null}
                    {b.paid ? <Badge tone="green">Paid</Badge> : !b.voided ? (v2 ? <Link href="/supplier-payments" className="text-sm font-bold underline underline-offset-4" data-lathe-pay-link>Pay in Supplier payments</Link> : <LathePaidForm billId={b.id} today={today} />) : null}
                  </div>
                  {v2 ? <LatheBillRow bill={b} shops={shops} isOwner={staff.role_id === "owner"} /> : null}
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
