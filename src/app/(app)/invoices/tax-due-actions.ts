"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { askEarlyTaxInvoice } from "@/lib/tax-invoice-due";
import { CHEQUE_TAX_SETTING, CHEQUE_TAX_WORDS, chequeTaxWhenOf } from "@/lib/tax-invoice-due-rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAppError } from "@/lib/app-errors";

export type TaxDueAnswer = { error?: string; words?: string } | null;

/** "Issue tax invoice now" (accounts and the owner): paid = at once; covered by a cheque still clearing = the owner approves. */
export async function issueTaxInvoiceNowAction(jobId: string, _prev: TaxDueAnswer, formData: FormData): Promise<TaxDueAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to issue it." };
  const r = await askEarlyTaxInvoice(jobId, String(formData.get("note") ?? ""), { id: staff.id, display_name: staff.display_name, role_id: staff.role_id }, await getSettings());
  revalidatePath(`/jobs/${jobId}/invoice`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");
  return r.error ? { error: r.error } : { words: r.words ?? "Done." };
}

/** Settings: when the tax invoice of a cheque payment is issued (owner and accounts only). */
export async function saveChequeTaxWhenAction(_prev: TaxDueAnswer, formData: FormData): Promise<TaxDueAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  if (!["owner", "accounts"].includes(staff.role_id)) return { error: "Only the owner or accounts change this." };
  const raw = String(formData.get("when") ?? "");
  const when = chequeTaxWhenOf(raw);
  if (raw !== when) return { error: "Pick one of the three." };
  const admin = createAdminClient();
  const { data: before } = await admin.from("settings").select("value").eq("key", CHEQUE_TAX_SETTING).maybeSingle();
  const { error } = await admin.from("settings").upsert({ key: CHEQUE_TAX_SETTING, value: when, label: "For cheque payments, issue the tax invoice", updated_by: staff.id }, { onConflict: "key" });
  if (error) {
    await logAppError("settings: cheque tax when", error, { staffId: staff.id });
    return { error: "Couldn't save – nothing was changed. Try again." };
  }
  await admin.from("audit_log").insert({ table_name: "settings", record_id: CHEQUE_TAX_SETTING, action: "update", old_data: { [CHEQUE_TAX_SETTING]: before?.value ?? "cleared" }, new_data: { [CHEQUE_TAX_SETTING]: when, by: staff.display_name }, changed_by: staff.id });
  revalidatePath("/accounts-posting");
  return { words: `Saved: ${CHEQUE_TAX_WORDS[when]}.` };
}
