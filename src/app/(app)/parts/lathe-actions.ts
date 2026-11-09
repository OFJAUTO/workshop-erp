"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLatheTicket, markLatheBack, recordLatheBill } from "@/lib/lathe";
import { parsePriceList } from "@/lib/lathe-rules";
import { logAppError, SAVE_FAILED } from "@/lib/app-errors";

export type LatheAnswer = { error?: string; message?: string; at: number };
const num = (v: FormDataEntryValue | null) => Number(String(v ?? "").replace(/,/g, "")) || 0;
const actorOf = (s: { id: string; display_name: string; role_id: string }) => ({ id: s.id, display_name: s.display_name, role_id: s.role_id });

/** "Outsourced – lathe" on a car (9 November 2026, Section 8). */
export async function createLatheAction(jobId: string, _prev: LatheAnswer | null, formData: FormData): Promise<LatheAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to record.", at: Date.now() };
  const r = await createLatheTicket(jobId, { item: String(formData.get("item") ?? ""), service: String(formData.get("service") ?? ""), qty: num(formData.get("qty")) || 1, cost: num(formData.get("cost")) || null, supplier: String(formData.get("supplier") ?? ""), sentOn: String(formData.get("sent_on") ?? ""), takenBy: String(formData.get("taken_by") ?? "") }, await getSettings(), actorOf(staff));
  if (r.ok) {
    revalidatePath(`/parts/${jobId}`);
    revalidatePath("/parts/lathe");
    revalidatePath(`/jobs/${jobId}`);
  }
  return { error: r.error, message: r.words, at: Date.now() };
}

export async function latheBackAction(partId: string): Promise<LatheAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only.", at: Date.now() };
  const r = await markLatheBack(partId, actorOf(staff));
  if (r.ok) revalidatePath("/parts/lathe");
  return { error: r.error, message: r.ok ? "Back from the lathe ✓" : undefined, at: Date.now() };
}

/** The month-end lathe bill: ticked tickets (typed amounts or shared by estimate) and lines with no ticket. */
export async function recordLatheBillAction(_prev: LatheAnswer | null, formData: FormData): Promise<LatheAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only.", at: Date.now() };
  const ids = formData.getAll("ticket").map(String);
  const tickets = ids.map((id) => {
    const typed = String(formData.get(`amount_${id}`) ?? "").trim();
    return { partId: id, estimate: num(formData.get(`estimate_${id}`)), typed: typed ? num(typed) : null };
  });
  const extraLines = formData.getAll("extra_desc").map((d, i) => ({ description: String(d).trim(), amount: num(formData.getAll("extra_amount")[i] ?? null) })).filter((l) => l.description && l.amount);
  try {
    const r = await recordLatheBill({ supplier: String(formData.get("supplier") ?? ""), billNumber: String(formData.get("bill_number") ?? ""), billDate: String(formData.get("bill_date") ?? ""), beforeVat: num(formData.get("before_vat")), vat: num(formData.get("vat")), tickets, extraLines }, actorOf(staff));
    if (r.ok) {
      revalidatePath("/parts/lathe");
      revalidatePath("/jobs", "layout");
    }
    return { error: r.error, message: r.words, at: Date.now() };
  } catch (e) {
    await logAppError("lathe: bill action", e, { staffId: staff.id });
    return { error: SAVE_FAILED, at: Date.now() };
  }
}

/** The bill paid as ONE supplier payment (accounts / owner). */
export async function latheBillPaidAction(billId: string, _prev: LatheAnswer | null, formData: FormData): Promise<LatheAnswer> {
  const staff = await requireStaff();
  if (!(staff.role_id === "owner" || staff.role_id === "accounts") || staff.viewingAs) return { error: "Accounts or the owner record the payment.", at: Date.now() };
  const method = String(formData.get("method") ?? "transfer");
  const day = String(formData.get("paid_on") ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Pick the day it was paid.", at: Date.now() };
  const { error } = await createAdminClient().from("lathe_bills").update({ paid_at: `${day}T08:00:00.000Z`, paid_method: ["transfer", "card", "cash", "cheque"].includes(method) ? method : "transfer", paid_reference: String(formData.get("reference") ?? "").trim() || null, paid_by: staff.id, updated_by: staff.id }).eq("id", billId).is("paid_at", null);
  if (error) { await logAppError("lathe: paid", error, { staffId: staff.id }); return { error: SAVE_FAILED, at: Date.now() }; }
  const { reopenZoho } = await import("@/lib/zoho-sync");
  await reopenZoho("lathebill", billId).catch(() => null);
  revalidatePath("/parts/lathe");
  return { message: "Paid ✓ – one supplier payment, sent to Zoho with the next Sync.", at: Date.now() };
}

/** The price list and the two limits (owner; Parts may keep the price list). */
export async function saveLatheSettingsAction(_prev: LatheAnswer | null, formData: FormData): Promise<LatheAnswer> {
  const staff = await requireStaff();
  if (!(staff.role_id === "owner" || staff.role_id === "parts") || staff.viewingAs) return { error: "The owner or Parts keep the lathe price list.", at: Date.now() };
  const items = parsePriceList(String(formData.get("price_list") ?? ""));
  const admin = createAdminClient();
  const rows: { key: string; label: string; value: unknown }[] = [{ key: "lathe_price_list", label: "Lathe price list (item, price in AED; the highest when a range)", value: items }];
  if (staff.role_id === "owner") {
    const threshold = num(formData.get("threshold"));
    const minMarkup = num(formData.get("min_markup"));
    if (threshold > 0) rows.push({ key: "lathe_lpo_threshold_aed", label: "Lathe work under this cost (AED) skips LPO approval", value: threshold });
    if (minMarkup > 0) rows.push({ key: "lathe_min_markup_percent", label: "Lathe work: minimum markup on the cost (%)", value: minMarkup });
  }
  const { error } = await admin.from("settings").upsert(rows.map((r) => ({ ...r, updated_by: staff.id, updated_at: new Date().toISOString() })), { onConflict: "key" });
  if (error) { await logAppError("lathe: settings", error, { staffId: staff.id }); return { error: SAVE_FAILED, at: Date.now() }; }
  revalidatePath("/parts/lathe");
  return { message: `Saved: ${items.length} item${items.length === 1 ? "" : "s"} on the price list.`, at: Date.now() };
}
