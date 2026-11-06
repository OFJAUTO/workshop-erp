"use server";
import { dbWords } from "@/lib/app-errors";

import { redirect, unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueBackfill, flagZohoAttention } from "@/lib/zoho-sync";
import { finishSyncRun, loadSyncPreview, retryOneRow, runSyncChunk, setSyncMode, startSyncRun, type ChunkResult, type StartResult, type SyncPreview } from "@/lib/zoho-manual";
import type { RunItem } from "@/lib/zoho-sync-rules";

const back = (kind: "message" | "error", text: string, show?: string): never => redirect(`/zoho?${show ? `show=${show}&` : ""}${kind}=${encodeURIComponent(text)}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Retry on a red row (the page's list and a stored run): THAT row goes back in the queue and is sent at once — never
 * any other row (3 November 2026: before, Retry swept the next 25 waiting documents along with it).
 */
export async function retryZohoRow(id: string, formData: FormData) {
  const staff = await requirePermission("zohoSync");
  const run = String(formData.get("run") ?? "");
  const to = (kind: "message" | "error", text: string): never => (UUID.test(run) ? redirect(`/zoho?run=${run}&${kind}=${encodeURIComponent(text)}`) : back(kind, text, "failed"));
  if (staff.viewingAs) return to("error", "Viewing only.");
  let kind: "message" | "error" = "message";
  let words: string;
  try {
    const r = await retryOneRow(id, { recheck: formData.get("recheck") === "1" });
    if (r.error) {
      kind = "error";
      words = r.error;
    } else if (!r.item) words = "Back in the queue.";
    else if (r.item.outcome === "posted") words = `Posted ✓ ${r.item.name ?? ""}${r.item.words ? ` — ${r.item.words}` : ""}`.trim();
    else if (r.item.outcome === "removed") words = `Removed from Zoho: ${r.item.name ?? ""}${r.item.words ? ` — ${r.item.words}` : ""}`.trim();
    else if (r.item.outcome === "skipped") words = `Closed, nothing sent: ${r.item.name ?? ""}${r.item.words ? ` — ${r.item.words}` : ""}`.trim();
    else if (r.item.outcome === "failed") {
      kind = "error";
      words = `Failed again: ${r.item.words ?? "see the row"}`;
    } else words = `Back in the queue. ${r.item.words ?? ""}`.trim();
  } catch (e) {
    unstable_rethrow(e);
    kind = "error";
    words = `Back in the queue; the run hit a problem: ${e instanceof Error ? dbWords(e, "zoho/actions") : String(e)}`;
  }
  return to(kind, words);
}

/* ------------------------------------------------- Sync to Zoho (the window) ------------------------------------------------- */

const VIEW_ONLY = "Viewing only: sign in as yourself to send to Zoho.";

/** Owner or accounts, from their own screen (never while viewing as someone): every step of the window checks this. */
async function sender() {
  const staff = await requirePermission("zohoSync");
  return staff.viewingAs ? null : staff;
}

/** Step 1: the preview — how many of each document and their totals, read from the ERP only. */
export async function zohoSyncPreviewAction(onlyIds: string[] | null = null): Promise<{ preview: SyncPreview | null; error: string | null }> {
  if (!(await sender())) return { preview: null, error: VIEW_ONLY };
  const ids = Array.isArray(onlyIds) ? onlyIds.filter((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 2000) : null;
  return { preview: await loadSyncPreview(ids), error: null };
}

/** Step 2: "Yes, send" — the run takes exactly the rows the person saw that still wait. */
export async function zohoSyncStartAction(
  ids: string[],
  groups: { key: string; label: string; count: number; total: number }[],
  others?: { removals?: number; removalsTotal?: number; again?: number; nothing?: number },
): Promise<StartResult> {
  const staff = await sender();
  if (!staff) return { runId: null, ids: [], error: VIEW_ONLY };
  // What the person confirmed, kept with the run: the first posts by group, and the lines that are not new money.
  const preview = {
    groups: (Array.isArray(groups) ? groups : []).slice(0, 20).map((g) => ({ key: String(g.key), label: String(g.label), count: Number(g.count) || 0, total: Number(g.total) || 0 })),
    count: Array.isArray(ids) ? ids.length : 0,
    removals: Number(others?.removals) || 0,
    removalsTotal: Number(others?.removalsTotal) || 0,
    again: Number(others?.again) || 0,
    nothing: Number(others?.nothing) || 0,
  };
  return startSyncRun(staff, Array.isArray(ids) ? ids : [], preview);
}

/** Step 3, repeated: one part of the run (about 45 seconds), answered with each row's outcome. */
export async function zohoSyncChunkAction(runId: string | null, ids: string[]): Promise<ChunkResult> {
  const staff = await sender();
  if (!staff) return { items: [], left: [], stopped: null, error: VIEW_ONLY };
  try {
    return await runSyncChunk(staff, runId && UUID.test(runId) ? runId : null, Array.isArray(ids) ? ids : []);
  } catch (e) {
    unstable_rethrow(e);
    return { items: [], left: [], stopped: null, error: `The sync stopped part-way: ${e instanceof Error ? dbWords(e, "zoho/actions") : String(e)}. What was sent stays posted; press Sync to Zoho again for the rest.` };
  }
}

/** Step 4: the run is closed as done or stopped (and yesterday's books are compared when due). */
export async function zohoSyncFinishAction(runId: string | null, stopped: string | null): Promise<{ recon: string | null }> {
  if (!(await sender())) return { recon: null };
  return finishSyncRun(runId && UUID.test(runId) ? runId : null, stopped ? "stopped" : "done", stopped ? String(stopped).slice(0, 300) : null);
}

/** Retry from the results window: the one row, its new outcome returned in place. */
export async function zohoSyncRetryAction(id: string): Promise<{ item: RunItem | null; error: string | null }> {
  if (!(await sender())) return { item: null, error: VIEW_ONLY };
  return retryOneRow(String(id));
}

/** 11.5: the owner's switch between manual and automatic (Settings > Zoho Books, and the Zoho Books page). */
export async function setZohoSyncModeAction(formData: FormData) {
  const staff = await requirePermission("zohoSync");
  const where = String(formData.get("back") ?? "") === "/settings/zoho" ? "/settings/zoho" : "/zoho";
  const r = await setSyncMode(staff, String(formData.get("mode") ?? ""));
  redirect(`${where}?${r.error ? "error" : "message"}=${encodeURIComponent(r.error ?? r.words ?? "Saved.")}`);
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

/** The owner's backfill: everything already in the ERP joins the queue once (section 7 of the phase 1 plan). */
export async function backfillZoho() {
  const staff = await requirePermission("manageSettings");
  if (staff.viewingAs) return back("error", "Viewing only.");
  let kind: "message" | "error";
  let words: string;
  try {
    const r = await enqueueBackfill(staff.id);
    words = `Queued: ${r.contacts} customer(s), ${r.deposits} deposit(s), ${r.invoices} tax invoice(s), ${r.payments} payment(s), ${r.creditnotes} credit note(s), ${r.vendors} supplier(s), ${r.bills} supplier bill(s), ${r.billpayments} supplier payment(s), ${r.commissions} commission(s), ${r.recoveries} recovery month(s), ${r.vendorcredits} supplier credit(s), ${r.cnrefunds} customer refund(s), ${r.settlements} card settlement(s). They are in the queue: press Sync to Zoho (a preview first, then Yes) to send them; on automatic they go by themselves within minutes.`;
    kind = "message";
  } catch (e) {
    unstable_rethrow(e);
    kind = "error";
    words = e instanceof Error ? dbWords(e, "zoho/actions") : String(e);
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
  if (error) return back("error", dbWords(error, "zoho/actions"));
  return back("message", "Review ticked. The owner sees it green on the go-live checklist.");
}
