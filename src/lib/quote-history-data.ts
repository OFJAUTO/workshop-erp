import "server-only";
import { createAdminClient } from "./supabase/admin";
import { additionalTo, quoteFamilies, type QuoteFamily, type QuoteVersionRow } from "./quote-history";

/** Every quotation and version of these jobs (kept versions included; cancelled and deleted ones left out), grouped per job. */
export async function loadQuoteHistory(jobIds: string[]): Promise<Map<string, QuoteFamily[]>> {
  const out = new Map<string, QuoteFamily[]>();
  if (!jobIds.length) return out;
  const { data } = await createAdminClient()
    .from("quotations")
    .select("id, job_id, number, version, kind, status, total_aed, approved_total_aed, rounded_total_aed, sent_at, opened_at, responded_at, approver_name, created_at, created_by, token")
    .in("job_id", jobIds)
    .eq("kind", "quotation")
    .eq("is_active", true)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .order("created_at");
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toRow);
  for (const id of jobIds) out.set(id, quoteFamilies(rows.filter((r) => r.job_id === id)));
  return out;
}

export async function loadJobQuotes(jobId: string): Promise<QuoteFamily[]> {
  return (await loadQuoteHistory([jobId])).get(jobId) ?? [];
}

/** For the customer's copy of a quotation: the earlier approved quotations it adds to. */
export async function additionalToOf(jobId: string | null, number: string) {
  if (!jobId) return [];
  return additionalTo(await loadJobQuotes(jobId), number);
}

/** Staff names by id, for "replaced by v2 on 29 Oct by Mathew". */
export async function staffNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!unique.length) return new Map();
  const { data } = await createAdminClient().from("staff").select("id, display_name").in("id", unique);
  return new Map((data ?? []).map((r) => [r.id as string, r.display_name as string]));
}

function toRow(r: Record<string, unknown>): QuoteVersionRow {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: r.id as string,
    job_id: (r.job_id as string | null) ?? null,
    number: r.number as string,
    version: Number(r.version) || 1,
    kind: r.kind as string,
    status: r.status as string,
    total_aed: Number(r.total_aed) || 0,
    approved_total_aed: n(r.approved_total_aed),
    rounded_total_aed: n(r.rounded_total_aed),
    sent_at: (r.sent_at as string | null) ?? null,
    opened_at: (r.opened_at as string | null) ?? null,
    responded_at: (r.responded_at as string | null) ?? null,
    approver_name: (r.approver_name as string | null) ?? null,
    created_at: r.created_at as string,
    created_by: (r.created_by as string | null) ?? null,
    token: (r.token as string | null) ?? null,
  };
}
