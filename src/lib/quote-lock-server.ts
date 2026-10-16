import "server-only";
import { logQuoteEvent } from "./quote-data";
import { quoteLockOf, type LockInvoice, type QuoteLock } from "./quote-lock";
import { createAdminClient } from "./supabase/admin";

/**
 * The server side of the quotation lock (rules in src/lib/quote-lock.ts): every path that writes a quotation asks
 * here first, whatever screen or request it came from. A refused attempt is written in the quotation's history and
 * on the job, with who, what and where from. The database trigger (migration 20261103090000) is the last line.
 */

export type LockedQuoteRow = { id: string; number: string; version: number; status: string; kind: string; job_id: string | null; responded_at: string | null; revision_allowed_at: string | null };

/** The job's documents that matter to the lock. */
export async function invoicesForLock(jobId: string | null | undefined): Promise<LockInvoice[]> {
  if (!jobId) return [];
  const { data } = await createAdminClient().from("invoices").select("kind, status, number, deposit_for_quotation_id, converted_to, is_active").eq("job_id", jobId).eq("is_active", true);
  return (data ?? []) as LockInvoice[];
}

export async function loadQuoteLock(quotationId: string, viewer: { isOwner: boolean } = { isOwner: false }): Promise<{ q: LockedQuoteRow; lock: QuoteLock } | null> {
  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("id, number, version, status, kind, job_id, responded_at, revision_allowed_at").eq("id", quotationId).maybeSingle();
  if (!q) return null;
  const row = q as LockedQuoteRow;
  return { q: row, lock: quoteLockOf(row, await invoicesForLock(row.job_id), viewer) };
}

/**
 * Null when the quotation may be changed; otherwise the refusal in plain words, after the attempt is logged:
 * "Refused: Adarsh (service advisor) tried to remove a line on Q-00012 v1 from the quotation editor. This quotation is
 * locked: approved by the customer on 16 Oct. Ask the owner to revise."
 */
export async function refuseIfLocked(quotationId: string, by: string | null | undefined, what: string, from: string): Promise<string | null> {
  const found = await loadQuoteLock(quotationId);
  if (!found || !found.lock.locked) return null;
  const { q, lock } = found;
  const admin = createAdminClient();
  const { data: who } = by ? await admin.from("staff").select("display_name, role_id").eq("id", by).maybeSingle() : { data: null };
  const name = who ? `${who.display_name} (${String(who.role_id).replace(/_/g, " ")})` : "Someone not signed in";
  const note = `Refused: ${name} tried to ${what} on ${q.number} v${q.version} from the ${from}. ${lock.refusal ?? "Locked."}`;
  await logQuoteEvent(q.id, q.job_id, by ?? null, "edit_refused", note);
  if (q.job_id) await admin.from("job_events").insert({ job_id: q.job_id, event_type: "quote_edit_refused", note, created_by: by ?? null }).then(() => null, () => null);
  return lock.refusal;
}
