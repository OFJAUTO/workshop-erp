import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Card, Empty, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { QUOTE_STATUS_LABELS, aed, type QuoteStatus } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Was this sent more than the given days ago? Kept outside the page so the render stays free of clock calls. */
function olderThanDays(iso: string | null, days: number) {
  return !!iso && Date.now() - Date.parse(iso) > days * 86400000;
}

type Row = { id: string; number: string; version: number; status: QuoteStatus; total_aed: number; sent_at: string | null; opened_at: string | null; responded_at: string | null; valid_until: string | null; created_at: string; created_by: string | null; customer: { full_name: string; company_name: string | null } | null; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null; creator: { display_name: string } | null };

/** Estimates before the car arrives: being prepared, sent, accepted, expired or no reply, with follow-ups. */
export default async function EstimatesPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const staff = await requirePermission("viewEstimates");
  const { message } = await searchParams;
  const settings = await getSettings();
  const admin = createAdminClient();
  let query = admin.from("quotations").select("id, number, version, status, total_aed, sent_at, opened_at, responded_at, valid_until, created_at, created_by, customer:customers(full_name, company_name), vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), creator:staff!quotations_created_by_fkey(display_name)").eq("kind", "estimate").eq("is_active", true).neq("status", "superseded").order("created_at", { ascending: false });
  if (staff.role_id !== "owner") query = query.eq("created_by", staff.id);
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];
  const followDays = Number(settings.estimate_followup_days) || 2;
  const needsFollowUp = (r: Row) => (r.status === "sent" || r.status === "opened") && olderThanDays(r.sent_at, followDays);
  const bucket = (r: Row) => (r.status === "approved" ? "accepted" : r.status === "expired" ? "expired" : r.status === "declined" ? "declined" : needsFollowUp(r) ? "noreply" : r.status === "sent" || r.status === "opened" ? "sent" : "draft");
  const sections: { key: string; title: string }[] = [
    { key: "noreply", title: "No reply: follow up" },
    { key: "sent", title: "Sent" },
    { key: "draft", title: "Being prepared" },
    { key: "accepted", title: "Accepted" },
    { key: "expired", title: "Expired" },
    { key: "declined", title: "Declined" },
  ];
  const tone = (s: QuoteStatus) => (s === "approved" ? "green" : s === "declined" || s === "expired" ? "red" : s === "draft" ? "outline" : "amber");

  return (
    <>
      <LiveRefresh tables={["quotations"]} pollMs={60000} />
      <PageHeader title="Estimates" subtitle="Before the car arrives. The customer accepts on a branded page; at gate-in the estimate becomes the quotation." actions={<LinkButton href="/estimates/new" size="lg">New estimate</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {rows.length === 0 ? <Empty title="No estimates yet" /> : null}
      {sections.map((s) => {
        const items = rows.filter((r) => bucket(r) === s.key);
        if (!items.length) return null;
        return (
          <section key={s.key} className="flex flex-col gap-3">
            <SectionLabel right={`${items.length}`}>{s.title}</SectionLabel>
            {items.map((r) => (
              <Link key={r.id} href={`/estimates/${r.id}`} className="block">
                <Card className={`flex flex-wrap items-center gap-3 hover:border-ink ${s.key === "noreply" ? "border-amber-bar" : ""}`}>
                  <span className="font-extrabold">{r.number}</span>
                  <span className="font-semibold">{r.vehicle ? `${formatPlate(r.vehicle)} · ${[r.vehicle.make?.name, r.vehicle.model?.name].filter(Boolean).join(" ")}` : "No car"}</span>
                  <span className="text-sm text-muted">{r.customer?.company_name ?? r.customer?.full_name}</span>
                  <Badge tone={tone(r.status)}>{QUOTE_STATUS_LABELS[r.status]}</Badge>
                  <span className="ml-auto text-sm font-semibold">{aed(r.total_aed)}</span>
                  <span className="text-xs text-muted">
                    {r.sent_at ? `sent ${formatDateTime(r.sent_at)}` : `started ${formatDateTime(r.created_at)}`}
                    {r.valid_until ? ` · valid until ${formatDate(r.valid_until)}` : ""}
                    {r.creator ? ` · ${r.creator.display_name}` : ""}
                  </span>
                </Card>
              </Link>
            ))}
          </section>
        );
      })}
    </>
  );
}
