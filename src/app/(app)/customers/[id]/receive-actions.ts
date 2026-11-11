"use server";

import { proofMissingWords, proofRequired } from "@/lib/payment-proof";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { receiveCombined } from "@/lib/payment-groups";
import { logAppError, SAVE_FAILED } from "@/lib/app-errors";

export type ReceiveAnswer = { error?: string; message?: string; at: number };

/** Receive payment from the customer (9 November 2026, Section 3): one payment over several cars, oldest first. */
export async function receivePaymentAction(customerId: string, _prev: ReceiveAnswer | null, formData: FormData): Promise<ReceiveAnswer> {
  const staff = await requirePermission("recordPayments");
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to record.", at: Date.now() };
  const num = (v: FormDataEntryValue | null) => Number(String(v ?? "").replace(/,/g, "")) || 0;
  const shares = formData.getAll("share_invoice").map((id, i) => ({ invoiceId: String(id), amount: num(formData.getAll("share_amount")[i] ?? null) })).filter((s) => s.amount > 0);
  const replaceIds = formData.getAll("replace_id").map(String).filter(Boolean);
  // Proof on every payment method (10 November 2026, Section 6): required for card, transfer and cheque.
  const method = String(formData.get("method") ?? "");
  const proof = formData.get("proof");
  const proofFile = proof instanceof File && proof.size > 0 ? proof : null;
  if (proofRequired(method) && !proofFile) return { error: proofMissingWords(method), at: Date.now() };
  if (proofFile && proofFile.size > 25 * 1024 * 1024) return { error: "The proof is too large (over 25 MB).", at: Date.now() };
  try {
    const r = await receiveCombined(customerId, {
      method: String(formData.get("method") ?? ""),
      amount: num(formData.get("amount")),
      reference: String(formData.get("reference") ?? "").trim() || null,
      authCode: String(formData.get("auth_code") ?? "").trim() || null,
      cheque: { number: String(formData.get("cheque_number") ?? "").trim() || null, bank: String(formData.get("cheque_bank") ?? "").trim() || null, date: String(formData.get("cheque_date") ?? "").trim() || null },
      shares,
      clientKey: String(formData.get("client_key") ?? ""),
      replace: replaceIds.length ? { paymentIds: replaceIds, reason: String(formData.get("replace_reason") ?? "") } : null,
    }, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id, is_head_accountant: staff.is_head_accountant });
    if (r.ok && proofFile) {
      // The one proof goes on every receipt of the payment (each car's share).
      const admin = createAdminClient();
      const { data: g } = await admin.from("payment_groups").select("id").eq("client_key", String(formData.get("client_key") ?? "")).maybeSingle();
      if (g?.id) {
        const ext = proofFile.type.includes("png") ? "png" : proofFile.type.includes("webp") ? "webp" : proofFile.type.includes("pdf") ? "pdf" : "jpg";
        const path = `payments/group-${g.id}.${ext}`;
        const { error: upErr } = await admin.storage.from("job-files").upload(path, Buffer.from(await proofFile.arrayBuffer()), { contentType: proofFile.type || "image/jpeg", upsert: true });
        if (upErr) await logAppError("customers/receive-actions:proof", upErr, { staffId: staff.id });
        else await admin.from("payments").update({ proof_path: path, updated_by: staff.id }).eq("group_id", g.id).is("proof_path", null);
      }
    }
    if (r.ok) {
      revalidatePath(`/customers/${customerId}`);
      revalidatePath("/invoices");
      revalidatePath("/accounts-posting");
      revalidatePath("/jobs", "layout");
    }
    return { error: r.error, message: r.words, at: Date.now() };
  } catch (e) {
    await logAppError("customers/receive-actions", e, { staffId: staff.id });
    return { error: SAVE_FAILED, at: Date.now() };
  }
}
