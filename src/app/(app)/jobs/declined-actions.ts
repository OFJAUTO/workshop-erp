"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { declineAllWork } from "@/lib/declined";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * [CUSTOMER DECLINED ALL WORK] (29 October 2026, batch 2 section 2): the owner or an advisor records that the customer
 * approved nothing. The answer is shown in the window that asked (never a page to scroll to).
 */
export async function customerDeclinedAllAction(jobId: string, formData: FormData): Promise<{ error?: string; ok?: string; invoice?: string | null }> {
  const staff = await requireStaff();
  if (!["owner", "service_advisor"].includes(staff.role_id) || staff.viewingAs) return { error: "Only the owner or an advisor can record this." };
  const raw = String(formData.get("amount") ?? "").replace(/,/g, "").trim();
  const amount = raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return { error: "Enter the amount to charge (0 for no charge)." };
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const res = await declineAllWork(jobId, { id: staff.id, display_name: staff.display_name }, await getSettings(), { amount, reason, isOwner: staff.role_id === "owner" });
  if ("error" in res) return { error: res.error };
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
  const charged = res.invoiceNumber ? `${res.invoiceNumber} made for the inspection (AED ${res.total!.toLocaleString("en-GB", { minimumFractionDigits: 2 })} with VAT).` : "No charge: no invoice.";
  return { ok: `Recorded. ${charged} ${res.saved} item${res.saved === 1 ? "" : "s"} saved as declined work. The car is Ready to collect.`, invoice: res.invoiceNumber };
}

/** "Called ✓" on Waiting on you: the advisor called the customer about the declined work (the rows close). */
export async function markDeclinedCalled(ids: string, formData: FormData): Promise<void> {
  const staff = await requireStaff();
  if (!["owner", "service_advisor"].includes(staff.role_id) || staff.viewingAs) return;
  const list = ids.split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!list.length) return;
  const note = String(formData.get("note") ?? "").trim() || null;
  await createAdminClient().from("declined_work").update({ followed_up_at: new Date().toISOString(), followed_up_by: staff.id, follow_up_note: note, updated_by: staff.id }).in("id", list).is("followed_up_at", null);
  revalidatePath("/dashboard");
}
