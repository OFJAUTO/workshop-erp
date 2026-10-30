import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Card, Empty, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { QUOTE_STATUS_LABELS, aed, type QuoteStatus } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { EstimateMenu } from "./EstimateMenu";
import { QuoteVersionSelect } from "@/components/QuoteVersionSelect";

export const dynamic = "force-dynamic";

/** Was this sent more than the given days ago? Kept outside the page so the render stays free of clock calls. */
function olderThanDays(iso: string | null, days: number) {
  return !!iso && Date.now() - Date.parse(iso) > days * 86400000;
}

type Row = { id: string; number: string; version: number; status: QuoteStatus; cancel_reason: string | null; cancelled_at: string | null; total_aed: number; sent_at: string | null; opened_at: string | null; responded_at: string | null; valid_until: string | null; created_at: string; created_by: string | null; additional_to_id: string | null; carried_job_id: string | null; customer: { full_name: string; company_name: string | null } | null; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null; creator: { display_name: string } | null };

/** Estimates before the car arrives: being prepared, sent, accepted, expired or no reply, with follow-ups. */
export default async function EstimatesPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const staff = await requirePermission("viewEstimates");
  const { message } = await searchParams;
  const settings = await getSettings();
  const admin = createAdminClient();
  let query = admin.from("quotations").select("id, number, version, status, cancel_reason, cancelled_at, total_aed, sent_at, opened_at, responded_at, valid_until, created_at, created_by, additional_to_id, carried_job_id, customer:customers(full_name, company_name), vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), creator:staff!quotations_created_by_fkey(display_name)").eq("kind", "estimate").eq("is_active", true).neq("status", "superseded").order("created_at", { ascending: false });
  if (staff.role_id !== "owner") query = query.eq("created_by", staff.id);
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];
  // Section 1 (29 October 2026): every version of each estimate stays one tap away (old versions open read-only).
  const { data: versionRows } = rows.length ? await admin.from("quotations").select("id, number, version, status").eq("kind", "estimate").eq("is_active", true).in("number", Array.from(new Set(rows.map((r) => r.number)))) : { data: [] as { id: string; number: string; version: number; status: string }[] };
  const versionsOf = (n: string) => ((versionRows ?? []) as { id: string; number: string; version: number; status: string }[]).filter((v) => v.number === n).map((v) => ({ id: v.id, version: Number(v.version) || 1, status: v.status }));
  const { data: baseRows } = rows.some((r) => r.additional_to_id) ? await admin.from("quotations").select("id, number").in("id", rows.map((r) => r.additional_to_id).filter((x): x is string => !!x)) : { data: [] as { id: string; number: string }[] };
  const numberOf = new Map((baseRows ?? []).map((b) => [b.id as string, b.number as string]));
  const followDays = Number(settings.estimate_followup_days) || 2;
  const needsFollowUp = (r: Row) => (r.status === "sent" || r.status === "opened") && olderThanDays(r.sent_at, followDays);
  // Cancelled (sent, then withdrawn) and expired (past "valid until" without a reply) share one folded section at the end.
  // 30 October 2026: an estimate carried over to a job at gate-in is at the workshop, never a follow-up.
  const bucket = (r: Row) => (r.carried_job_id && r.status !== "cancelled" ? "carried" : r.status === "approved" ? "accepted" : r.status === "expired" || r.status === "cancelled" ? "closed" : r.status === "declined" ? "declined" : needsFollowUp(r) ? "noreply" : r.status === "sent" || r.status === "opened" ? "sent" : "draft");
  const sections: { key: string; title: string; folded?: boolean }[] = [
    { key: "noreply", title: "No reply: follow up" },
    { key: "sent", title: "Sent" },
    { key: "draft", title: "Being prepared" },
    { key: "accepted", title: "Accepted" },
    { key: "carried", title: "Carried over to a job" },
    { key: "declined", title: "Declined" },
    { key: "closed", title: "Cancelled / expired", folded: true },
  ];
  const tone = (s: QuoteStatus) => (s === "approved" ? "green" : s === "declined" || s === "expired" ? "red" : s === "draft" || s === "cancelled" ? "outline" : "amber");
  const mayManage = (r: Row) => !staff.viewingAs && (staff.role_id === "owner" || r.created_by === staff.id);

  return (
    <>
      <LiveRefresh tables={["quotations"]} />
      <PageHeader title="Estimates" subtitle="Before the car arrives. The customer accepts on a branded page; at gate-in the estimate becomes the quotation." actions={<LinkButton href="/estimates/new" size="lg">New estimate</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {rows.length === 0 ? <Empty title="No estimates yet" /> : null}
      {sections.map((s) => {
        const items = rows.filter((r) => bucket(r) === s.key);
        if (!items.length) return null;
        const cards = items.map((r) => (
          <Card key={r.id} className={`flex items-center gap-3 hover:border-ink ${s.key === "noreply" ? "border-amber-bar" : ""}`} data-estimate-row={r.number} data-estimate-status={r.status}>
            <Link href={`/estimates/${r.id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <span className="font-extrabold">{r.number}</span>
              <span className="font-semibold">{r.vehicle ? `${formatPlate(r.vehicle)} · ${[r.vehicle.make?.name, r.vehicle.model?.name].filter(Boolean).join(" ")}` : "No car"}</span>
              <span className="text-sm text-muted">{r.customer?.company_name ?? r.customer?.full_name}</span>
              <Badge tone={tone(r.status)}>{QUOTE_STATUS_LABELS[r.status]}</Badge>
              {r.additional_to_id ? <span className="rounded-full border border-ink px-2 py-0.5 text-[10px] font-extrabold tracking-[0.08em]" data-estimate-additional-chip>ADDITIONAL{numberOf.get(r.additional_to_id) ? ` · to ${numberOf.get(r.additional_to_id)}` : ""}</span> : null}
              {r.status === "cancelled" && r.cancel_reason ? <span className="text-xs font-semibold text-muted" data-cancel-reason>{r.cancel_reason}</span> : null}
              <span className="ml-auto text-sm font-semibold">{aed(r.total_aed)}</span>
              <span className="text-xs text-muted">
                {r.sent_at ? `sent ${formatDateTime(r.sent_at)}` : `started ${formatDateTime(r.created_at)}`}
                {r.valid_until ? ` · valid until ${formatDate(r.valid_until)}` : ""}
                {r.creator ? ` · ${r.creator.display_name}` : ""}
              </span>
            </Link>
            {versionsOf(r.number).length > 1 ? <QuoteVersionSelect base="/estimates/" versions={versionsOf(r.number)} selectedId={r.id} /> : null}
            <EstimateMenu id={r.id} number={r.number} status={r.status} neverSent={!r.sent_at} canManage={mayManage(r)} />
          </Card>
        ));
        return s.folded ? (
          <details key={s.key} className="flex flex-col gap-3" data-estimates-closed>
            <summary className="cursor-pointer list-none"><SectionLabel right={`${items.length}`}>{s.title} ▸</SectionLabel></summary>
            <div className="mt-3 flex flex-col gap-3">{cards}</div>
          </details>
        ) : (
          <section key={s.key} className="flex flex-col gap-3" data-estimates-section={s.key}>
            <SectionLabel right={`${items.length}`}>{s.title}</SectionLabel>
            {cards}
          </section>
        );
      })}
    </>
  );
}
