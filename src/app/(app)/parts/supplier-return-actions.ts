"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { enterCreditNote, saveReturnRules, startReturns } from "@/lib/supplier-returns";
import { RETURN_REASONS, type ReturnReasonKey } from "@/lib/supplier-return-rules";

export type ReturnAnswer = { error?: string; words?: string } | null;
const num = (v: FormDataEntryValue | null) => { const t = String(v ?? "").replace(/,/g, "").trim(); const n = Number(t); return t && Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

function refresh(poId: string) {
  revalidatePath(`/parts/orders/${poId}`);
  revalidatePath("/parts/returns");
  revalidatePath("/parts/suppliers");
  revalidatePath("/parts-accounts");
}

/** "Return to supplier" from the LPO: the ticked received parts, how many, why, and an optional replacement line. */
export async function startReturnsAction(poId: string, _prev: ReturnAnswer, formData: FormData): Promise<ReturnAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to send parts back." };
  const items = formData.getAll("part").map(String).map((partId) => ({ partId, qty: num(formData.get(`qty_${partId}`)) ?? 0 })).filter((i) => i.qty > 0);
  const reason = String(formData.get("reason") ?? "") as ReturnReasonKey;
  if (!RETURN_REASONS.some((r) => r.key === reason)) return { error: "Pick why they go back." };
  const wantsReplacement = formData.get("replacement") === "yes";
  const r = await startReturns(poId, { items, reason, note: String(formData.get("note") ?? ""), replacement: wantsReplacement ? { name: String(formData.get("replacement_name") ?? ""), price: num(formData.get("replacement_price")) } : null }, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  refresh(poId);
  return r.error ? { error: r.error } : { words: r.words };
}

/** The supplier's credit note (accounts and the owner), from the Purchase returns page or the LPO. */
export async function enterCreditNoteAction(_prev: ReturnAnswer, formData: FormData): Promise<ReturnAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to enter a credit note." };
  const poId = String(formData.get("po_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(poId)) return { error: "Pick the invoice the credit note refers to." };
  const lines = formData.getAll("part").map(String).map((partId) => ({ partId, amount: num(formData.get(`amount_${partId}`)) ?? 0 }));
  const r = await enterCreditNote({ poId, number: String(formData.get("number") ?? ""), date: String(formData.get("date") ?? "").slice(0, 10), lines, vat: num(formData.get("vat")), scanPath: String(formData.get("scan_path") ?? "").trim() || null }, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  refresh(poId);
  return r.error ? { error: r.error } : { words: r.words };
}

/** A supplier's return window (Parts > Suppliers). */
export async function saveReturnRulesAction(supplierId: string, _prev: ReturnAnswer, formData: FormData): Promise<ReturnAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  const days = (k: string) => { const n = num(formData.get(k)); return n === null ? null : Math.max(0, Math.round(n)); };
  const r = await saveReturnRules(supplierId, { returnDays: days("return_days"), creditDays: days("credit_days"), noElectrical: formData.get("no_electrical") === "1" }, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
  revalidatePath("/parts/suppliers");
  return r.error ? { error: r.error } : { words: "Saved." };
}
