"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEPOSIT_METHODS, EXPENSE_TYPES, INCOME_TYPES, PURCHASE_TYPES, SUGGESTED_MAP, SUPPLIER_PAY_METHODS, type ZohoAccountMap } from "@/lib/zoho-sync";

const back = (kind: "message" | "error", text: string): never => redirect(`/settings/zoho/mapping?${kind}=${encodeURIComponent(text)}`);

/** Saves the account mapping: Zoho account NAMES per line type and payment method (one settings key). */
export async function saveZohoMapping(formData: FormData) {
  const staff = await requirePermission("zohoSync");
  if (staff.viewingAs) return back("error", "Viewing only.");
  const map: ZohoAccountMap = { income: {}, depositTo: {}, purchases: {}, expense: {} };
  for (const t of INCOME_TYPES) {
    const v = String(formData.get(`map__income__${t.key}`) ?? "").trim();
    if (v) map.income[t.key] = v.slice(0, 200);
  }
  for (const m of DEPOSIT_METHODS) {
    const v = String(formData.get(`map__deposit__${m.key}`) ?? "").trim();
    if (v) map.depositTo[m.key] = v.slice(0, 200);
  }
  for (const p of PURCHASE_TYPES) {
    const v = String(formData.get(`map__purchase__${p.key}`) ?? "").trim();
    if (v) map.purchases[p.key] = v.slice(0, 200);
  }
  for (const e of EXPENSE_TYPES) {
    const v = String(formData.get(`map__expense__${e.key}`) ?? "").trim();
    if (v) map.expense[e.key] = v.slice(0, 200);
  }
  const paidFrom = String(formData.get("map__paid_from") ?? "").trim();
  if (paidFrom) map.paidFrom = paidFrom.slice(0, 200);
  map.paidFromBy = {};
  for (const m of SUPPLIER_PAY_METHODS) {
    const v = String(formData.get(`map__paid_by__${m.key}`) ?? "").trim();
    if (v) map.paidFromBy[m.key] = v.slice(0, 200);
  }
  const bank = String(formData.get("map__bank_charges") ?? "").trim();
  const adv = String(formData.get("map__advances") ?? "").trim();
  const advRefund = String(formData.get("map__advances_refund") ?? "").trim();
  if (bank) map.bankCharges = bank.slice(0, 200);
  if (adv) map.advances = adv.slice(0, 200);
  if (advRefund) map.advancesRefund = advRefund.slice(0, 200);
  const missing = [
    ...INCOME_TYPES.filter((t) => !map.income[t.key]).map((t) => t.label),
    ...DEPOSIT_METHODS.filter((m) => !map.depositTo[m.key]).map((m) => `Deposit-to for ${m.label}`),
    ...PURCHASE_TYPES.filter((p) => !map.purchases[p.key]).map((p) => p.label),
    ...EXPENSE_TYPES.filter((e) => !map.expense[e.key]).map((e) => e.label),
    ...(map.paidFrom ? [] : ["Paid-from account"]),
  ];
  const { error } = await createAdminClient().from("settings").update({ value: map as unknown as Record<string, unknown>, updated_by: staff.id }).eq("key", "zoho_account_map");
  if (error) return back("error", error.message);
  return back("message", missing.length ? `Saved. Still missing: ${missing.join(", ")} — those documents will fail with "Mapping missing" until picked.` : "Saved. Every line type and payment method has its account.");
}

/** One tap fills every empty box with the suggested name; missing accounts are created in OFJ TEST at the first sync. */
export async function useSuggestedMapping() {
  const staff = await requirePermission("zohoSync");
  if (staff.viewingAs) return back("error", "Viewing only.");
  const admin = createAdminClient();
  const { data: row } = await admin.from("settings").select("value").eq("key", "zoho_account_map").maybeSingle();
  const stored = (row?.value ?? {}) as ZohoAccountMap;
  const map: ZohoAccountMap = {
    income: { ...SUGGESTED_MAP.income, ...(stored.income ?? {}) },
    depositTo: { ...SUGGESTED_MAP.depositTo, ...(stored.depositTo ?? {}) },
    purchases: { ...SUGGESTED_MAP.purchases, ...(stored.purchases ?? {}) },
    expense: { ...SUGGESTED_MAP.expense, ...(stored.expense ?? {}) },
    paidFrom: stored.paidFrom || SUGGESTED_MAP.paidFrom,
    paidFromBy: { ...SUGGESTED_MAP.paidFromBy, ...(stored.paidFromBy ?? {}) },
    bankCharges: stored.bankCharges || SUGGESTED_MAP.bankCharges,
    advances: stored.advances || SUGGESTED_MAP.advances,
    advancesRefund: stored.advancesRefund || SUGGESTED_MAP.advancesRefund,
  };
  const { error } = await admin.from("settings").update({ value: map as unknown as Record<string, unknown>, updated_by: staff.id }).eq("key", "zoho_account_map");
  if (error) return back("error", error.message);
  return back("message", "Every empty box took the suggested name. Accounts that do not exist yet are created in OFJ TEST at the first sync; in the REAL book the accountant creates them before go-live.");
}
