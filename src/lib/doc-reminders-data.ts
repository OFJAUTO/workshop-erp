import "server-only";
import { createAdminClient } from "./supabase/admin";
import { docAlertsOf, docLimitsOf, type DocAlert, type DocFacts } from "./doc-reminders";
import { workingTimeOf } from "./jobs";
import type { Settings } from "./settings";

/**
 * The document alerts of many jobs at once (the dashboard) or one (the job card): the timestamps come from the jobs,
 * the inspections, the report links, the quotations and the invoices; the rules live in src/lib/doc-reminders.ts.
 */
export async function loadDocAlerts(jobIds: string[], settings: Settings, now = new Date()): Promise<Map<string, DocAlert[]>> {
  const out = new Map<string, DocAlert[]>();
  if (!jobIds.length) return out;
  const admin = createAdminClient();
  const [{ data: jobs }, { data: insps }, { data: links }, { data: quotes }, { data: invoices }, { data: parts }] = await Promise.all([
    admin.from("jobs").select("id, status, is_open, stage_entered_at, parts_pricing_done_at, ready_sent_at").in("id", jobIds),
    admin.from("inspections").select("job_id, approved_at, created_at").in("job_id", jobIds).eq("is_active", true).not("approved_at", "is", null).order("created_at", { ascending: false }),
    admin.from("report_links").select("job_id, sent_at, created_at").in("job_id", jobIds).not("sent_at", "is", null).order("created_at", { ascending: false }),
    admin.from("quotations").select("job_id, kind, status, sent_at, opened_at, responded_at, created_at").in("job_id", jobIds).eq("is_active", true).eq("kind", "quotation").order("created_at", { ascending: false }),
    admin.from("invoices").select("job_id, kind, status, created_at, sent_at, converted_from").in("job_id", jobIds).eq("is_active", true).eq("kind", "tax_invoice").order("created_at", { ascending: false }),
    admin.from("part_requests").select("job_id").in("job_id", jobIds).eq("is_active", true),
  ]);
  const limits = docLimitsOf(settings);
  const wt = workingTimeOf(settings);
  const first = <T extends { job_id: string }>(rows: T[] | null | undefined) => {
    const m = new Map<string, T>();
    for (const r of rows ?? []) if (!m.has(r.job_id)) m.set(r.job_id, r);
    return m;
  };
  const insp = first(insps as { job_id: string; approved_at: string | null }[] | null);
  const link = first(links as { job_id: string; sent_at: string | null }[] | null);
  const quote = first(quotes as { job_id: string; status: string; sent_at: string | null; opened_at: string | null; responded_at: string | null }[] | null);
  const inv = first(invoices as { job_id: string; status: string; created_at: string; sent_at: string | null }[] | null);
  const partCounts = new Map<string, number>();
  for (const p of (parts ?? []) as { job_id: string }[]) partCounts.set(p.job_id, (partCounts.get(p.job_id) ?? 0) + 1);
  for (const j of (jobs ?? []) as { id: string; status: string; is_open: boolean; stage_entered_at: string | null; parts_pricing_done_at: string | null; ready_sent_at: string | null }[]) {
    const q = quote.get(j.id);
    const i = inv.get(j.id);
    const facts: DocFacts = {
      jobStatus: j.status,
      isOpen: j.is_open,
      reportApprovedAt: insp.get(j.id)?.approved_at ?? null,
      reportSentAt: link.get(j.id)?.sent_at ?? null,
      pricingDoneAt: j.parts_pricing_done_at,
      partsCount: partCounts.get(j.id) ?? 0,
      quotation: q ? { sentAt: q.sent_at, openedAt: q.opened_at, respondedAt: q.responded_at, status: q.status } : null,
      readyAt: ["ready", "pending_payment", "in_delivery"].includes(j.status) ? j.stage_entered_at : null,
      readySentAt: j.ready_sent_at,
      taxInvoiceAt: i && i.status !== "void" ? i.created_at : null,
      taxInvoiceSentAt: i?.sent_at ?? null,
    };
    out.set(j.id, docAlertsOf(facts, limits, wt, now));
  }
  return out;
}
