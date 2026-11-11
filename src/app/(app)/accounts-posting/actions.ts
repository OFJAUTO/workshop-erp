"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fillAuthFromReport, recordReport, uploadSettlementReport } from "@/lib/settlement-import";
import { createAdminClient } from "@/lib/supabase/admin";
import { terminalList } from "@/lib/bank-fees";
import { requirePermission } from "@/lib/auth";
import { recordSettlement, undoSettlement } from "@/lib/card-settlements";
import { formValues, type FormState } from "@/lib/form-state";
import { reportNumber } from "@/lib/settlement-report";

const blank = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim();
  return t ? t.slice(0, 200) : null;
};

export async function recordSettlementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("cardSettlements");
  const values = formValues(formData);
  if (staff.viewingAs) return { error: "You are viewing as someone else: switch back to record a settlement.", values };
  // Amounts as typed: "9,815.20", "-175.00" (the bank prints fees with a minus) - the fees count as plain amounts.
  const amount = (key: string) => reportNumber(formData.get(key));
  const fee = (key: string) => { const n = amount(key); return n === null ? null : Math.abs(n); };
  const res = await recordSettlement(
    {
      method: String(formData.get("method") ?? ""),
      settledOn: String(formData.get("settled_on") ?? "").slice(0, 10),
      paymentIds: formData.getAll("ids").map(String),
      net: amount("net"),
      msf: fee("msf"),
      txn: fee("txn"),
      vat: fee("vat"),
      override: formData.get("override") === "1",
      statementRef: blank(formData.get("statement_ref")),
      note: blank(formData.get("note")),
      confirmed: formData.get("confirmed") === "1",
    },
    staff.id,
  );
  if (!res.ok) return { error: res.error, values: { ...values, ...(res.askAgain ? { ask: "1" } : {}) } };
  revalidatePath("/accounts-posting");
  return { success: `${res.number} recorded: ${res.count} payment${res.count === 1 ? "" : "s"}, the bank kept AED ${res.fee.toFixed(2)} (MSF + fee AED ${res.cost.toFixed(2)} on the jobs, the VAT reclaimable)${res.difference ? `, saved with an AED ${Math.abs(res.difference).toFixed(2)} difference (written in the change log)` : ""}. Each job now shows the actual fee; Zoho gets the transfer, the fees and the input VAT.` };
}

/** THE bank fee settings save (owner and accounts): MSF % before VAT, fee per transaction, VAT on the fees, terminal IDs. */
export async function saveBankFeesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("cardSettlements");
  const values = formValues(formData);
  if (staff.viewingAs) return { error: "You are viewing as someone else: switch back to change the bank fees.", values };
  const LIMITS: [string, number, number, string][] = [
    ["bank_charge_card_percent", 0, 20, "Card machine MSF %"],
    ["bank_fee_card_txn_aed", 0, 100, "Card machine transaction fee"],
    ["bank_charge_link_percent", 0, 20, "Payment link MSF %"],
    ["bank_fee_link_txn_aed", 0, 100, "Payment link transaction fee"],
    ["bank_fee_vat_percent", 0, 20, "VAT on the fees"],
    ["bank_charge_cash_percent", 0, 20, "Cash %"],
    ["bank_charge_cheque_percent", 0, 20, "Cheque %"],
    ["bank_charge_transfer_percent", 0, 20, "Bank transfer %"],
  ];
  const updates: { key: string; value: unknown }[] = [];
  for (const [key, min, max, label] of LIMITS) {
    const raw = String(formData.get(key) ?? "").trim().replace(",", ".");
    const v = Number(raw);
    if (!raw || !Number.isFinite(v) || v < min || v > max) return { error: `${label} must be a number between ${min} and ${max}.`, values };
    updates.push({ key, value: Math.round(v * 1000) / 1000 });
  }
  const card = terminalList(formData.get("bank_terminal_ids_card"));
  const link = terminalList(formData.get("bank_terminal_ids_link"));
  const both = card.find((t) => link.includes(t));
  if (both) return { error: `Terminal ${both} is listed for both methods. Each terminal belongs to one method.`, values };
  updates.push({ key: "bank_terminal_ids_card", value: card.join(", ") });
  updates.push({ key: "bank_terminal_ids_link", value: link.join(", ") });
  // The old single "highest rate" (kept for anything still reading it).
  updates.push({ key: "bank_charge_fee_percent", value: Math.max(...updates.filter((u) => /^bank_charge_\w+_percent$/.test(u.key)).map((u) => Number(u.value) || 0)) });
  const admin = createAdminClient();
  for (const u of updates) {
    const { error } = await admin.from("settings").update({ value: u.value, updated_by: staff.id }).eq("key", u.key);
    if (error) return { error: "Couldn't save the bank fees. Try again.", values };
  }
  await admin.from("audit_log").insert({ table_name: "settings", record_id: null, action: "update", new_data: { bank_fees: Object.fromEntries(updates.map((u) => [u.key, u.value])), by: staff.display_name } }).then(() => null, () => null);
  revalidatePath("/accounts-posting");
  revalidatePath("/invoices");
  revalidatePath("/settings");
  const g = (k: string) => updates.find((u) => u.key === k)?.value;
  return { success: `Bank fees saved: card machine ${g("bank_charge_card_percent")}% + AED ${Number(g("bank_fee_card_txn_aed")).toFixed(2)}, payment link ${g("bank_charge_link_percent")}% + AED ${Number(g("bank_fee_link_txn_aed")).toFixed(2)}, VAT ${g("bank_fee_vat_percent")}% on the fees.` };
}

export async function undoSettlementAction(settlementId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("cardSettlements");
  if (staff.viewingAs) return { error: "You are viewing as someone else: switch back to undo a settlement." };
  const res = await undoSettlement(settlementId, String(formData.get("reason") ?? ""), staff.id);
  if (!res.ok) return { error: res.error };
  revalidatePath("/accounts-posting");
  return { success: `${res.number} undone: its payments are back to "not settled".${res.posted ? " Zoho already had it: the sync page shows the transfer and fee to remove by hand." : ""}` };
}

/** Upload the bank's Merchant Transaction Report: kept, read, then reviewed on this page (nothing recorded yet). */
export async function uploadReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("cardSettlements");
  if (staff.viewingAs) return { error: "You are viewing as someone else: switch back to upload a report." };
  const file = formData.get("report");
  if (!(file instanceof File)) return { error: "Choose the report file (PDF, CSV or Excel)." };
  const res = await uploadSettlementReport(file, staff.id);
  if (!res.ok) return { error: res.error };
  redirect(`/accounts-posting?report=${res.id}#report`);
}

/** Record the reviewed report: one settlement per method, each payment with its exact MSF, fee and VAT. */
export async function recordReportAction(reportId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("cardSettlements");
  if (staff.viewingAs) return { error: "You are viewing as someone else: switch back to record a settlement." };
  const picks: Record<number, string> = {};
  for (const [k, v] of formData.entries()) {
    const m = /^pick_(\d+)$/.exec(k);
    if (m && String(v)) picks[Number(m[1])] = String(v);
  }
  const res = await recordReport(reportId, { picks, settledOn: String(formData.get("settled_on") ?? "").slice(0, 10), statementRef: blank(formData.get("statement_ref")), note: blank(formData.get("note")), flagsSeen: formData.get("flags_seen") === "1" }, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  if (!res.ok) return { error: res.error };
  revalidatePath("/accounts-posting");
  revalidatePath("/invoices");
  const parts = [
    res.numbers.length ? `${res.numbers.join(" and ")} recorded from the bank's report: each payment carries its exact MSF, fee and VAT, and each job now shows the actual fee.` : "Nothing new to record: every payment on this report was already settled.",
    res.settledBefore.length ? `Already settled before: ${res.settledBefore.join(", ")}.` : "",
    res.codesSaved.length ? `Auth code saved from the report: ${res.codesSaved.join(", ")}.` : "",
  ];
  return { success: parts.filter(Boolean).join(" ") };
}

/**
 * Confirm a SUGGESTED match on the bank report (3 November 2026, section 5): one tap saves the line's auth code on the
 * payment whose code was missing (logged with the report's file and line); the answer shows beside the button.
 */
export async function confirmSuggestionAction(reportId: string, index: number, paymentId: string): Promise<{ ok?: boolean; error?: string; message?: string; settledIn?: string | null }> {
  const staff = await requirePermission("cardSettlements");
  if (staff.viewingAs) return { error: "You are viewing as someone else: switch back to confirm a match." };
  if (!/^[0-9a-f-]{36}$/.test(reportId) || !/^[0-9a-f-]{36}$/.test(paymentId) || !Number.isInteger(index)) return { error: "That line or payment was not found. Reload the page." };
  const r = await fillAuthFromReport(reportId, index, paymentId, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  if (!r.ok) return { error: r.error };
  revalidatePath("/accounts-posting");
  revalidatePath("/invoices");
  return { ok: true, settledIn: r.settledIn, message: `Auth ${r.code} saved on ${r.number}${r.settledIn ? ` · already settled in ${r.settledIn}` : ""}.` };
}

/* ---- Cheques and bank transfers (9 November 2026, Section 2): THE steps in src/lib/bank-posting.ts ---- */

export type BankAnswer = { error?: string; message?: string; at: number };

async function bankActor() {
  const staff = await requirePermission("recordPayments");
  return { staff, actor: { id: staff.id, display_name: staff.display_name, role_id: staff.role_id } };
}
function bankRefresh() {
  revalidatePath("/accounts-posting");
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/jobs", "layout");
}

export async function markDepositedAction(paymentId: string, _prev: BankAnswer | null, formData: FormData): Promise<BankAnswer> {
  const { staff, actor } = await bankActor();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to change it.", at: Date.now() };
  const { markChequeDeposited } = await import("@/lib/bank-posting");
  const r = await markChequeDeposited(paymentId, { date: String(formData.get("deposited_on") ?? ""), account: String(formData.get("deposited_to") ?? "") }, actor);
  if (r.ok) bankRefresh();
  return { error: r.error, message: r.words, at: Date.now() };
}

export async function clearBankAction(_prev: BankAnswer | null, formData: FormData): Promise<BankAnswer> {
  const { staff, actor } = await bankActor();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to change it.", at: Date.now() };
  const { clearBankPayments } = await import("@/lib/bank-posting");
  const amount = reportNumber(formData.get("amount"));
  const fee = reportNumber(formData.get("fee"));
  const r = await clearBankPayments(formData.getAll("ids").map(String), { date: String(formData.get("settled_on") ?? ""), amount: amount ?? 0, statementRef: blank(formData.get("statement_ref")), fee: fee === null ? 0 : Math.abs(fee), note: blank(formData.get("note")) }, actor);
  if (r.ok) bankRefresh();
  return { error: r.error, message: r.words, at: Date.now() };
}

export async function bounceBankAction(paymentId: string, _prev: BankAnswer | null, formData: FormData): Promise<BankAnswer> {
  const { staff, actor } = await bankActor();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to change it.", at: Date.now() };
  const { bounceBankPayment } = await import("@/lib/bank-posting");
  const charge = reportNumber(formData.get("bounce_charge"));
  const r = await bounceBankPayment(paymentId, { charge: charge === null ? 0 : Math.abs(charge), note: blank(formData.get("bounce_note")) }, actor);
  if (r.ok) bankRefresh();
  return { error: r.error, message: r.words, at: Date.now() };
}

/** "Void - duplicate / entered by mistake" on a waiting row (11 November 2026, Section 5): asks the owner (accounts), or voids (the owner). */
export async function requestVoidAction(paymentId: string, _prev: BankAnswer | null, formData: FormData): Promise<BankAnswer> {
  const staff = await requirePermission("recordPayments");
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to change it.", at: Date.now() };
  const { requestPaymentVoid } = await import("@/lib/payments");
  const r = await requestPaymentVoid(paymentId, { ...staff, is_head_accountant: (staff as { is_head_accountant?: boolean }).is_head_accountant ?? false }, String(formData.get("reason") ?? ""));
  if (r.ok || !r.error) bankRefresh();
  return { error: r.error, message: r.message ?? (r.ok ? "Voided." : undefined), at: Date.now() };
}
