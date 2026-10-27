"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainZohoOutbox, enqueueBackfill } from "@/lib/zoho-sync";

const back = (kind: "message" | "error", text: string, show?: string): never => redirect(`/zoho?${show ? `show=${show}&` : ""}${kind}=${encodeURIComponent(text)}`);

/** A failed row goes back in the queue, and the worker runs at once so the answer is on screen in a moment. */
export async function retryZohoRow(id: string, formData: FormData) {
  const staff = await requirePermission("zohoSync");
  if (staff.viewingAs) return back("error", "Viewing only.");
  void formData;
  const admin = createAdminClient();
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
    words = `Queued: ${r.contacts} customer(s), ${r.deposits} deposit(s), ${r.invoices} tax invoice(s), ${r.payments} payment(s), ${r.creditnotes} credit note(s), ${r.vendors} supplier(s), ${r.bills} supplier bill(s), ${r.billpayments} supplier payment(s), ${r.commissions} commission(s), ${r.recoveries} recovery month(s), ${r.vendorcredits} supplier credit(s), ${r.cnrefunds} customer refund(s). The five-minute sync works through them; Sync now pushes the first batch at once.`;
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
