"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainZohoOutbox, enqueueBackfill, flagZohoAttention } from "@/lib/zoho-sync";

const back = (kind: "message" | "error", text: string, show?: string): never => redirect(`/zoho?${show ? `show=${show}&` : ""}${kind}=${encodeURIComponent(text)}`);

/** A failed row goes back in the queue, and the worker runs at once so the answer is on screen in a moment. */
export async function retryZohoRow(id: string, formData: FormData) {
  const staff = await requirePermission("zohoSync");
  if (staff.viewingAs) return back("error", "Viewing only.");
  void formData;
  const admin = createAdminClient();
  // A row only a human can settle (a document in the REAL book's opening balances) is never re-run: the handler does
  // not know it is already in a book and could post it again.
  const { data: row } = await admin.from("zoho_outbox").select("zoho_result").eq("id", id).maybeSingle();
  if ((row as { zoho_result?: { hand_only?: boolean } | null } | null)?.zoho_result?.hand_only === true) {
    return back("error", 'This one is corrected by hand in Zoho (it sits in the opening balances): make the change there, then press "Done by hand".', "failed");
  }
  await admin.from("zoho_outbox").update({ status: "pending", last_error: null, updated_at: new Date().toISOString() }).eq("id", id).neq("status", "synced");
  let words: string;
  try {
    const r = await drainZohoOutbox();
    words = r.skipped ? `Back in the queue. ${r.skipped}` : `${r.pushed} posted · ${r.failed} failed · ${r.waiting} waiting.`;
  } catch (e) {
    unstable_rethrow(e);
    words = `Back in the queue; the run hit a problem: ${e instanceof Error ? e.message : String(e)}`;
  }
  return back("message", words, "failed");
}

/**
 * A red row the accountant settled in Zoho by hand (a void, a document from before go-live, a VAT correction):
 * it closes as posted, with who did it, when, the words they typed and the reason it was red — never silently.
 */
export async function markZohoDoneByHand(id: string, formData: FormData) {
  const staff = await requirePermission("zohoSync");
  if (staff.viewingAs) return back("error", "Viewing only.", "failed");
  const note = String(formData.get("note") ?? "").trim().slice(0, 300);
  if (note.length < 3) return back("error", "Write what was done in Zoho (for example: entered by hand as INV-123, or voided).", "failed");
  const admin = createAdminClient();
  const { data: row } = await admin.from("zoho_outbox").select("id, kind, record_id, status, last_error, zoho_id").eq("id", id).maybeSingle();
  if (!row || row.status !== "failed") return back("error", "Only a red row can be closed by hand.", "failed");
  const now = new Date().toISOString();
  const { data: done } = await admin
    .from("zoho_outbox")
    .update({ status: "synced", synced_at: now, last_error: null, claimed_at: null, zoho_result: { manual: true, by: staff.id, name: staff.display_name, at: now, note, reason: row.last_error ?? null }, updated_at: now })
    .eq("id", id)
    .eq("status", "failed")
    .select("id");
  if (!done?.length) return back("error", "The row changed meanwhile: look at it again.", "failed");
  // An invoice settled by hand that never reached Zoho through the sync: the payments and deposits that ALREADY posted
  // for it went up unapplied (the invoice applies them when it posts — and now it never will), so each turns red.
  let extra = "";
  if (row.kind === "invoice" && !row.zoho_id) {
    const n = await flagPaymentsOfHandInvoice(String(row.record_id));
    if (n) extra = ` ${n} payment${n === 1 ? "" : "s"} already in Zoho for it turned red: apply ${n === 1 ? "it" : "them"} to the invoice there by hand.`;
  }
  return back("message", `Closed as done by hand. The row keeps who did it and why.${extra}`, "failed");
}

/** The payments of an invoice closed by hand that already posted (unapplied) to Zoho: red, to be applied by hand. */
async function flagPaymentsOfHandInvoice(invoiceId: string): Promise<number> {
  const admin = createAdminClient();
  const { data: inv } = await admin.from("invoices").select("id, number, job_id, zoho_invoice_id").eq("id", invoiceId).maybeSingle();
  const i = inv as { id: string; number: string; job_id: string | null; zoho_invoice_id: string | null } | null;
  if (!i || i.zoho_invoice_id) return 0;
  const { data: pays } = await admin
    .from("payments")
    .select("id, number, amount_aed, is_deposit")
    .eq("status", "recorded")
    .or(`invoice_id.eq.${i.id}${i.job_id ? `,and(job_id.eq.${i.job_id},is_deposit.eq.true)` : ""}`);
  let n = 0;
  for (const p of (pays ?? []) as { id: string; number: string; amount_aed: number; is_deposit: boolean }[]) {
    const kind = p.is_deposit ? "deposit" : "payment";
    const { data: ob } = await admin.from("zoho_outbox").select("status, zoho_id").eq("kind", kind).eq("record_id", p.id).maybeSingle();
    if ((ob as { status?: string; zoho_id?: string | null } | null)?.status !== "synced" || !(ob as { zoho_id?: string | null }).zoho_id) continue;
    await flagZohoAttention(kind, p.id, `${i.number} was settled by hand in Zoho, so ${p.number} (AED ${Number(p.amount_aed).toFixed(2)}), already posted there unapplied, was never applied to it: apply it in Zoho by hand, then press "Done by hand".`);
    n++;
  }
  return n;
}

/** The whole queue runs now instead of waiting for the five-minute cron. */
export async function syncZohoNow() {
  const staff = await requirePermission("zohoSync");
  if (staff.viewingAs) return back("error", "Viewing only.");
  let kind: "message" | "error";
  let words: string;
  try {
    const r = await drainZohoOutbox(40);
    kind = r.skipped ? "error" : "message";
    words = r.skipped ?? `${r.pushed} posted · ${r.failed} failed · ${r.waiting} waiting.`;
  } catch (e) {
    unstable_rethrow(e);
    kind = "error";
    words = e instanceof Error ? e.message : String(e);
  }
  return back(kind, words);
}

/** The owner's backfill: everything already in the ERP joins the queue once (section 7 of the phase 1 plan). */
export async function backfillZoho() {
  const staff = await requirePermission("manageSettings");
  if (staff.viewingAs) return back("error", "Viewing only.");
  let kind: "message" | "error";
  let words: string;
  try {
    const r = await enqueueBackfill(staff.id);
    words = `Queued: ${r.contacts} customer(s), ${r.deposits} deposit(s), ${r.invoices} tax invoice(s), ${r.payments} payment(s), ${r.creditnotes} credit note(s), ${r.vendors} supplier(s), ${r.bills} supplier bill(s), ${r.billpayments} supplier payment(s), ${r.commissions} commission(s), ${r.recoveries} recovery month(s), ${r.vendorcredits} supplier credit(s), ${r.cnrefunds} customer refund(s), ${r.settlements} card settlement(s). The five-minute sync works through them; Sync now pushes the first batch at once.`;
    kind = "message";
  } catch (e) {
    unstable_rethrow(e);
    kind = "error";
    words = e instanceof Error ? e.message : String(e);
  }
  return back(kind, words);
}

/** Mathew's own tick: the OFJ TEST side-by-side review is done (accounts login only; the owner cannot tick it). */
export async function tickGoLiveReview() {
  const staff = await requirePermission("zohoSync");
  if (staff.viewingAs || staff.actingAs) return back("error", "Viewing only.");
  if (staff.role_id !== "accounts") return back("error", "This tick belongs to accounts: Mathew confirms the review from his own login.");
  const admin = createAdminClient();
  const { error } = await admin.from("settings").update({ value: { by: staff.id, name: staff.display_name, at: new Date().toISOString() }, updated_by: staff.id }).eq("key", "zoho_golive_reviewed");
  if (error) return back("error", error.message);
  return back("message", "Review ticked. The owner sees it green on the go-live checklist.");
}
