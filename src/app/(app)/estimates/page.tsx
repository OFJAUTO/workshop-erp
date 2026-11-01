import { LiveRefresh } from "@/components/LiveRefresh";
import { Empty, LinkButton, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import type { QuoteStatus } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { EstimateMenu } from "./EstimateMenu";
import { QuoteListSections, type QuoteListRow } from "@/components/QuoteListSections";
import { HANDBACK_SELECT, handbackReady, startersOf, staffNamesOf } from "@/lib/quote-lead";
import { handbackStands, handbackWords, type HandbackKind } from "@/lib/quote-handback";

export const dynamic = "force-dynamic";

/** Was this sent more than the given days ago? Kept outside the page so the render stays free of clock calls. */
function olderThanDays(iso: string | null, days: number) {
  return !!iso && Date.now() - Date.parse(iso) > days * 86400000;
}

type Row = { id: string; number: string; version: number; status: QuoteStatus; cancel_reason: string | null; cancelled_at: string | null; total_aed: number; sent_at: string | null; opened_at: string | null; responded_at: string | null; valid_until: string | null; created_at: string; created_by: string | null; additional_to_id: string | null; carried_job_id: string | null; customer: { full_name: string; company_name: string | null } | null; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null; handed_back_at?: string | null; handed_back_by?: string | null; handback_kind?: HandbackKind | null; handback_summary?: string | null };

/**
 * Estimates before the car arrives. 1 November 2026 (E-00055): every advisor sees every estimate (their own first),
 * the advisor who STARTED one stays in charge whoever edits it, and the sections follow who it waits on.
 */
export default async function EstimatesPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const staff = await requirePermission("viewEstimates");
  const { message } = await searchParams;
  const settings = await getSettings();
  const admin = createAdminClient();
  const ready = await handbackReady();
  const { data } = await admin.from("quotations").select(`id, number, version, status, cancel_reason, cancelled_at, total_aed, sent_at, opened_at, responded_at, valid_until, created_at, created_by, additional_to_id, carried_job_id, customer:customers(full_name, company_name), vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))${ready ? `, ${HANDBACK_SELECT}` : ""}`).eq("kind", "estimate").eq("is_active", true).neq("status", "superseded").order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as Row[];
  // Section 1 (29 October 2026): every version of each estimate stays one tap away (old versions open read-only).
  const numbers = Array.from(new Set(rows.map((r) => r.number)));
  const { data: versionRows } = rows.length ? await admin.from("quotations").select("id, number, version, status, created_by").eq("kind", "estimate").eq("is_active", true).in("number", numbers) : { data: [] as { id: string; number: string; version: number; status: string; created_by: string | null }[] };
  const versions = (versionRows ?? []) as { id: string; number: string; version: number; status: string; created_by: string | null }[];
  const starters = await startersOf(numbers);
  const { data: owners } = await admin.from("staff").select("id, display_name").eq("role_id", "owner").eq("is_active", true).limit(1);
  const names = await staffNamesOf([...starters.values(), ...versions.map((v) => v.created_by ?? ""), ...rows.map((r) => r.handed_back_by ?? "")]);
  const versionsOf = (n: string) => versions.filter((v) => v.number === n).map((v) => ({ id: v.id, version: Number(v.version) || 1, status: v.status, by: v.created_by && v.created_by !== starters.get(n) ? (names.get(v.created_by) ?? null) : null }));
  const { data: baseRows } = rows.some((r) => r.additional_to_id) ? await admin.from("quotations").select("id, number").in("id", rows.map((r) => r.additional_to_id).filter((x): x is string => !!x)) : { data: [] as { id: string; number: string }[] };
  const numberOf = new Map((baseRows ?? []).map((b) => [b.id as string, b.number as string]));
  const followDays = Number(settings.estimate_followup_days) || 2;
  const mayManage = (lead: string | null) => !staff.viewingAs && (staff.role_id === "owner" || lead === staff.id);
  const list: QuoteListRow[] = rows.map((r) => {
    const lead = starters.get(r.number) ?? r.created_by;
    return {
      id: r.id,
      number: r.number,
      version: r.version,
      status: r.status,
      href: `/estimates/${r.id}`,
      total: Number(r.total_aed) || 0,
      sentAt: r.sent_at,
      createdAt: r.created_at,
      validUntil: r.valid_until,
      cancelReason: r.cancel_reason,
      carried: !!r.carried_job_id,
      additionalTo: r.additional_to_id ? (numberOf.get(r.additional_to_id) ?? "") : null,
      jobNumber: null,
      car: r.vehicle ? `${formatPlate(r.vehicle)} · ${[r.vehicle.make?.name, r.vehicle.model?.name].filter(Boolean).join(" ")}` : "No car",
      customer: r.customer?.company_name ?? r.customer?.full_name ?? null,
      leadId: lead,
      leadName: lead ? (names.get(lead) ?? null) : null,
      handback: r.handback_kind && handbackStands({ status: r.status, handed_back_at: r.handed_back_at }) ? { words: handbackWords(r.handback_kind, names.get(r.handed_back_by ?? "") ?? "the owner"), summary: r.handback_summary ?? "" } : null,
      followUp: (r.status === "sent" || r.status === "opened") && olderThanDays(r.sent_at, followDays),
      versions: versionsOf(r.number),
      versionBase: "/estimates/",
      menu: <EstimateMenu id={r.id} number={r.number} status={r.status} neverSent={!r.sent_at} canManage={mayManage(lead)} />,
    };
  });

  return (
    <>
      <LiveRefresh tables={["quotations"]} />
      <PageHeader title="Estimates" subtitle="Before the car arrives. The customer accepts on a branded page; at gate-in the estimate becomes the quotation." actions={<LinkButton href="/estimates/new" size="lg">New estimate</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {rows.length === 0 ? <Empty title="No estimates yet" /> : null}
      <QuoteListSections rows={list} me={staff.id} ownerName={owners?.[0]?.display_name ?? "the owner"} noun="estimate" acceptedWords="Accepted · waiting for the car" />
    </>
  );
}
