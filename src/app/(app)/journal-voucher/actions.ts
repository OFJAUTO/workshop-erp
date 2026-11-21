"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { logAppError, SAVE_FAILED } from "@/lib/app-errors";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { manualVoucher, markReimbursed, payLaterVoucher, payVoucher, recordChargeVouchers, voidVoucher } from "@/lib/journal-vouchers";
import { JV_TYPES, type JvType } from "@/lib/jv-rules";
import { photoSizesLater } from "@/lib/photo-sizes";
import { newUuid } from "@/lib/uuid";

/** Journal Voucher actions (17 November 2026, Section 6): accounts and the owner only, checked here on the server. */
export type JvState = { ok?: boolean; error?: string; message?: string; at?: number } | null;

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
};
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

async function who() {
  const staff = await requireStaff();
  if (!can(staff.role_id as RoleId, "journalVouchers")) return { error: "Only accounts or the owner use the Journal Voucher." } as const;
  if (staff.viewingAs) return { error: "View as is read-only – use Act as." } as const;
  return { staff } as const;
}

/** The proof photo or PDF (a receipt, a card slip, a transfer slip), kept in the job files under journal-vouchers/. */
async function saveProof(formData: FormData): Promise<{ path: string | null; error?: string }> {
  const f = formData.get("proof");
  if (!(f instanceof File) || !f.size) return { path: null };
  if (f.size > 25 * 1024 * 1024) return { path: null, error: "The proof is too large (over 25 MB)." };
  const ext = f.type.includes("png") ? "png" : f.type.includes("webp") ? "webp" : f.type.includes("pdf") ? "pdf" : "jpg";
  const path = `journal-vouchers/${newUuid()}.${ext}`;
  const { error } = await createAdminClient().storage.from("job-files").upload(path, Buffer.from(await f.arrayBuffer()), { contentType: f.type || "image/jpeg", upsert: false });
  if (error) return { path: null, error: "The proof could not be saved – nothing was recorded. Try again." };
  photoSizesLater("job-files", path, f.type || "image/jpeg");
  return { path };
}

type RawBill = { supplierId?: string | null; newProvider?: string | null; trn?: string | null; invoiceNumber?: string | null; invoiceDate?: string | null };
function linesOf(formData: FormData): { chargeLineId: string; amount: number; vat: number; bill: RawBill | null }[] {
  try {
    const raw = JSON.parse(String(formData.get("lines") ?? "[]")) as { id: string; amount: string | number; vat: string | number; bill?: RawBill | null }[];
    const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return raw.map((l) => ({ chargeLineId: String(l.id), amount: Number(String(l.amount).replace(/,/g, "")), vat: Number(String(l.vat).replace(/,/g, "")) || 0, bill: l.bill ? { supplierId: t(l.bill.supplierId), newProvider: t(l.bill.newProvider), trn: t(l.bill.trn), invoiceNumber: t(l.bill.invoiceNumber), invoiceDate: t(l.bill.invoiceDate) } : null }));
  } catch {
    return [];
  }
}
const refresh = () => {
  revalidatePath("/journal-voucher");
  revalidatePath("/jobs", "layout");
};

export async function recordJvAction(_prev: JvState, formData: FormData): Promise<JvState> {
  const w = await who();
  if ("error" in w) return { error: w.error, at: Date.now() };
  try {
    const proof = await saveProof(formData);
    if (proof.error) return { error: proof.error, at: Date.now() };
    const r = await recordChargeVouchers(linesOf(formData), { paidBy: str(formData.get("paid_by")), staffId: str(formData.get("staff_id")), paidOn: str(formData.get("paid_on")), reference: str(formData.get("reference")), proofPath: proof.path }, w.staff, str(formData.get("note")));
    if (r.error) return { error: r.error, at: Date.now() };
    refresh();
    return { ok: true, message: `Recorded ${r.numbers!.join(", ")}.`, at: Date.now() };
  } catch (e) {
    await logAppError("journal-voucher/record", e, { staffId: w.staff.id });
    return { error: SAVE_FAILED, at: Date.now() };
  }
}

export async function payLaterJvAction(_prev: JvState, formData: FormData): Promise<JvState> {
  const w = await who();
  if ("error" in w) return { error: w.error, at: Date.now() };
  try {
    // 21 November 2026: the provider comes from the supplier list (picked, or added as new).
    const { resolveProvider } = await import("@/lib/providers");
    const prov = await resolveProvider({ supplierId: str(formData.get("supplier_id")), newName: str(formData.get("provider_new")), trn: str(formData.get("trn")) }, w.staff);
    if (prov.error) return { error: prov.error, at: Date.now() };
    const r = await payLaterVoucher(linesOf(formData), { provider: prov.provider?.name ?? String(formData.get("provider") ?? ""), trn: prov.provider?.trn ?? str(formData.get("trn")), invoiceNumber: String(formData.get("invoice_number") ?? ""), invoiceDate: str(formData.get("invoice_date")), supplierId: prov.provider?.id ?? null }, w.staff, str(formData.get("note")));
    if (r.error) return { error: r.error, at: Date.now() };
    refresh();
    return { ok: true, message: `${r.number}: kept as "pay later" until the provider is paid.`, at: Date.now() };
  } catch (e) {
    await logAppError("journal-voucher/pay-later", e, { staffId: w.staff.id });
    return { error: SAVE_FAILED, at: Date.now() };
  }
}

export async function payJvAction(id: string, _prev: JvState, formData: FormData): Promise<JvState> {
  const w = await who();
  if ("error" in w) return { error: w.error, at: Date.now() };
  try {
    const proof = await saveProof(formData);
    if (proof.error) return { error: proof.error, at: Date.now() };
    const r = await payVoucher(id, { paidBy: str(formData.get("paid_by")), staffId: str(formData.get("staff_id")), paidOn: str(formData.get("paid_on")), reference: str(formData.get("reference")), proofPath: proof.path }, w.staff);
    if (r.error) return { error: r.error, at: Date.now() };
    refresh();
    return { ok: true, message: `${r.number} paid.`, at: Date.now() };
  } catch (e) {
    await logAppError("journal-voucher/pay", e, { staffId: w.staff.id });
    return { error: SAVE_FAILED, at: Date.now() };
  }
}

export async function manualJvAction(_prev: JvState, formData: FormData): Promise<JvState> {
  const w = await who();
  if ("error" in w) return { error: w.error, at: Date.now() };
  try {
    const typeRaw = String(formData.get("type") ?? "");
    const type = (JV_TYPES.some((t) => t.key === typeRaw) ? typeRaw : "other") as JvType;
    const proof = await saveProof(formData);
    if (proof.error) return { error: proof.error, at: Date.now() };
    const r = await manualVoucher({ type, description: String(formData.get("description") ?? ""), provider: str(formData.get("provider")), trn: str(formData.get("trn")), amount: num(formData.get("amount")), vat: num(formData.get("vat")) || 0, paidBy: str(formData.get("paid_by")), staffId: str(formData.get("staff_id")), paidOn: str(formData.get("paid_on")), reference: str(formData.get("reference")), proofPath: proof.path }, w.staff);
    if (r.error) return { error: r.error, at: Date.now() };
    refresh();
    return { ok: true, message: `Recorded ${r.number}.`, at: Date.now() };
  } catch (e) {
    await logAppError("journal-voucher/manual", e, { staffId: w.staff.id });
    return { error: SAVE_FAILED, at: Date.now() };
  }
}

export async function reimburseJvAction(ids: string[], _prev: JvState, formData: FormData): Promise<JvState> {
  const w = await who();
  if ("error" in w) return { error: w.error, at: Date.now() };
  const r = await markReimbursed(ids, { method: String(formData.get("method") ?? ""), reference: str(formData.get("reference")), date: String(formData.get("paid_on") ?? "").slice(0, 10) || new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10) }, w.staff);
  if (r.error) return { error: r.error, at: Date.now() };
  refresh();
  return { ok: true, message: `${r.count} voucher${r.count === 1 ? "" : "s"} marked reimbursed.`, at: Date.now() };
}

export async function voidJvAction(id: string, _prev: JvState, formData: FormData): Promise<JvState> {
  const w = await who();
  if ("error" in w) return { error: w.error, at: Date.now() };
  const r = await voidVoucher(id, String(formData.get("reason") ?? ""), w.staff);
  if (r.error) return { error: r.error, at: Date.now() };
  refresh();
  return { ok: true, message: `${r.number} voided: its charge is back to record.`, at: Date.now() };
}

/** "Ask <advisor> for the receipt" (21 November 2026, Section 2): the answer shows on the row. */
export async function askReceiptAction(chargeLineId: string, _prev: JvState, _formData: FormData): Promise<JvState> {
  void _prev;
  void _formData;
  const w = await who();
  if ("error" in w) return { error: w.error, at: Date.now() };
  try {
    const { askForReceipt } = await import("@/lib/journal-vouchers");
    const r = await askForReceipt(chargeLineId, w.staff);
    if (r.error) return { error: r.error, at: Date.now() };
    revalidatePath("/journal-voucher");
    return { ok: true, message: r.words, at: Date.now() };
  } catch (e) {
    await logAppError("journal-voucher/ask-receipt", e, { staffId: w.staff.id });
    return { error: SAVE_FAILED, at: Date.now() };
  }
}
