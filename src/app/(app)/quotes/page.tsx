import { LiveRefresh } from "@/components/LiveRefresh";
import { QuoteSendMenu } from "@/components/QuoteSendMenu";
import { Empty, PageHeader } from "@/components/ui";
import { QuoteListSections, type QuoteListRow } from "@/components/QuoteListSections";
import { requirePermission } from "@/lib/auth";
import { HANDBACK_SELECT, handbackReady, startersOf, staffNamesOf } from "@/lib/quote-lead";
import { handbackStands, handbackWords, type HandbackKind } from "@/lib/quote-handback";
import type { QuoteStatus } from "@/lib/quotes";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { listLineFacts } from "@/lib/quote-list-data";
import { readTab, readWho } from "@/lib/quote-list-rules";
import { loadQuoteSummaries } from "@/lib/quote-data";

export const dynamic = "force-dynamic";

type Row = {
  id: string; number: string; version: number; status: QuoteStatus; total_aed: number; sent_at: string | null; valid_until: string | null; created_at: string; updated_at: string | null; responded_at: string | null; owner_approved_at: string | null; created_by: string | null; cancel_reason: string | null; additional_to_id: string | null; job_id: string;
  handed_back_at?: string | null; handed_back_by?: string | null; handback_kind?: HandbackKind | null; handback_summary?: string | null;
};
type Job = { id: string; job_number: string; advisor_id: string | null; gated_in_by: string | null; customer: { full_name: string; company_name: string | null } | null; vehicle: Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null } | null };

/**
 * Every quotation of the cars in the workshop, in the same sections as the estimates (1 November 2026, E-00055):
 * waiting for the owner, ready to send, sent, opened, being prepared, approved. Every advisor sees all of them,
 * their own cars first; the advisor in charge is the car's advisor, whoever made the newest version.
 */
export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; who?: string; q?: string }> }) {
  const staff = await requirePermission("editQuotes");
  const { tab: tabParam, who: whoParam, q: qParam } = await searchParams;
  const tab = readTab(tabParam);
  const who = readWho(whoParam, staff.role_id);
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const admin = createAdminClient();
  const ready = await handbackReady();
  const { data: jobs } = await admin.from("jobs").select("id, job_number, advisor_id, gated_in_by, customer:customers(full_name, company_name), vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))").eq("is_open", true);
  const jobOf = new Map(((jobs ?? []) as unknown as Job[]).map((j) => [j.id, j]));
  const ids = Array.from(jobOf.keys());
  const { data } = ids.length ? await admin.from("quotations").select(`id, number, version, status, total_aed, sent_at, valid_until, created_at, updated_at, responded_at, owner_approved_at, created_by, cancel_reason, additional_to_id, job_id${ready ? `, ${HANDBACK_SELECT}` : ""}`).eq("kind", "quotation").eq("is_active", true).neq("status", "superseded").in("job_id", ids).order("created_at", { ascending: false }) : { data: [] };
  const rows = (data ?? []) as unknown as Row[];
  const numbers = Array.from(new Set(rows.map((r) => r.number)));
  const { data: versionRows } = numbers.length ? await admin.from("quotations").select("id, number, version, status, created_by").eq("kind", "quotation").eq("is_active", true).in("number", numbers) : { data: [] };
  const versions = (versionRows ?? []) as { id: string; number: string; version: number; status: string; created_by: string | null }[];
  const starters = await startersOf(numbers);
  const leadOf = (r: Row) => { const j = jobOf.get(r.job_id); return j?.advisor_id ?? j?.gated_in_by ?? starters.get(r.number) ?? r.created_by; };
  const { data: owners } = await admin.from("staff").select("id, display_name").eq("role_id", "owner").eq("is_active", true).limit(1);
  const names = await staffNamesOf([...rows.map((r) => leadOf(r) ?? ""), ...versions.map((v) => v.created_by ?? ""), ...rows.map((r) => r.handed_back_by ?? "")]);
  const baseNumber = new Map(rows.map((r) => [r.id, r.number]));
  const [facts, summaries] = await Promise.all([listLineFacts(rows.map((r) => r.id)), loadQuoteSummaries(Array.from(new Set(rows.map((r) => r.job_id))))]);
  const list: QuoteListRow[] = rows.map((r) => {
    const j = jobOf.get(r.job_id);
    const lead = leadOf(r);
    return {
      id: r.id,
      number: r.number,
      version: r.version,
      status: r.status,
      href: `/jobs/${r.job_id}/quote/${r.id}`,
      total: Number(r.total_aed) || 0,
      sentAt: r.sent_at,
      createdAt: r.created_at,
      validUntil: r.valid_until,
      cancelReason: r.cancel_reason,
      carried: false,
      additionalTo: r.additional_to_id ? (baseNumber.get(r.additional_to_id) ?? "") : null,
      jobNumber: j?.job_number ?? null,
      car: j?.vehicle ? `${formatPlate(j.vehicle)} · ${[j.vehicle.make?.name, j.vehicle.model?.name].filter(Boolean).join(" ")}` : "",
      customer: j?.customer?.company_name ?? j?.customer?.full_name ?? null,
      leadId: lead,
      leadName: lead ? (names.get(lead) ?? null) : null,
      handback: r.handback_kind && handbackStands({ status: r.status, handed_back_at: r.handed_back_at }) ? { words: handbackWords(r.handback_kind, names.get(r.handed_back_by ?? "") ?? "the owner"), summary: r.handback_summary ?? "" } : null,
      followUp: false,
      versions: versions.filter((v) => v.number === r.number).map((v) => ({ id: v.id, version: Number(v.version) || 1, status: v.status, by: v.created_by && v.created_by !== starters.get(r.number) && v.created_by !== lead ? (names.get(v.created_by) ?? null) : null })),
      versionBase: `/jobs/${r.job_id}/quote/`,
      // The one send/resend (6 November 2026): from the row's "…" menu; the quotation's page decides which version and whether it is ready.
      menu: <QuoteSendMenu href={`/jobs/${r.job_id}/quote/${r.id}`} number={r.number} />,
      facts: { status: r.status, carried: false, handback: !!(r.handback_kind && handbackStands({ status: r.status, handed_back_at: r.handed_back_at })), withDesk: (summaries.get(r.job_id)?.waitingPrices ?? 0) + (summaries.get(r.job_id)?.openRequests ?? 0), lineCount: facts.get(r.id)?.lineCount ?? 0, total: Number(r.total_aed) || 0, createdAt: r.created_at, sentAt: r.sent_at, respondedAt: r.responded_at, handedBackAt: r.handed_back_at ?? null, updatedAt: r.updated_at },
      search: [j?.vehicle?.vin, j?.customer?.full_name, j?.customer?.company_name],
      ownerApprovedAt: r.owner_approved_at ?? (r.handback_kind ? (r.handed_back_at ?? null) : null),
    };
  });
  return (
    <>
      <LiveRefresh tables={["quotations"]} />
      <PageHeader title="Quotations" subtitle="Every quotation of the cars in the workshop. Your own cars first; the whole row opens it." />
      {list.length === 0 ? <Empty title="No quotations for the cars in the workshop" /> : null}
      <QuoteListSections rows={list} me={staff.id} ownerName={owners?.[0]?.display_name ?? "the owner"} noun="quotation" acceptedWords="Approved by the customer" tab={tab} who={who} q={qParam ?? ""} basePath="/quotes" now={now} />
    </>
  );
}
