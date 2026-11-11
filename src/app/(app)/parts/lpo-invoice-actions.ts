"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { formValues, type FormState } from "@/lib/form-state";
import { checkLpoInvoice, editLpoInvoice, addLpoInvoice, splitLpoInvoice, lpoInvoiceState, lpoInvoiceById, setFirstInvoiceLines, lpoInvoicesReady } from "@/lib/lpo-invoices";
import { firstAfterSplit, linesFromForm } from "@/lib/lpo-invoice-rules";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ONE LPO, SEVERAL SUPPLIER INVOICES (10 November 2026, Section 3): the LPO page's actions. Owner and accounts only (the
 * parts desk never enters invoices, 4 November 2026); the answer shows inside the card that was used.
 */
async function payer(): Promise<{ id: string; display_name: string } | { error: string }> {
  const staff = await requireStaff();
  if (!["owner", "accounts"].includes(staff.role_id) || staff.viewingAs) return { error: "Only accounts or the owner enter supplier invoices." };
  return { id: staff.id, display_name: staff.display_name };
}

const num = (v: FormDataEntryValue | null): number | null => {
  const t = String(v ?? "").replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

function refresh(poId: string) {
  revalidatePath(`/parts/orders/${poId}`);
  revalidatePath("/supplier-invoices");
  revalidatePath("/parts-accounts");
}

async function lineIdsOf(poId: string): Promise<string[]> {
  return ((await lpoInvoiceState(poId))?.lines ?? []).map((l) => l.id);
}

/** "Add another invoice": a further supplier invoice for the lines still waiting for one. */
export async function addLpoInvoiceAction(poId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const who = await payer();
  if ("error" in who) return { error: who.error };
  const ids = await lineIdsOf(poId);
  const r = await addLpoInvoice(poId, { id: String(formData.get("invoice_id") ?? "") || null, number: String(formData.get("number") ?? ""), date: String(formData.get("date") ?? ""), amount: num(formData.get("amount")), vat: num(formData.get("vat")), lines: linesFromForm((k) => (formData.get(k) as string | null) ?? null, ids), remark: String(formData.get("remark") ?? "") || null }, who);
  if (r.error) return { error: r.error, values: formValues(formData) };
  refresh(poId);
  return { success: `${r.words ?? "Saved"} ✓ Accounts check it, then it goes to Zoho as its own bill.` };
}

/** "Split this invoice": lines move off the first invoice onto a new invoice number, each with its own amounts as printed. */
export async function splitLpoInvoiceAction(poId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const who = await payer();
  if ("error" in who) return { error: who.error };
  const ids = await lineIdsOf(poId);
  const r = await splitLpoInvoice(poId, { id: String(formData.get("invoice_id") ?? "") || null, number: String(formData.get("number") ?? ""), date: String(formData.get("date") ?? ""), amount: num(formData.get("amount")), vat: num(formData.get("vat")), lines: linesFromForm((k) => (formData.get(k) as string | null) ?? null, ids), firstAmount: num(formData.get("first_amount")), firstVat: num(formData.get("first_vat")), remark: String(formData.get("remark") ?? "") || null }, who);
  if (r.error) return { error: r.error, values: formValues(formData) };
  refresh(poId);
  return { success: `${r.words ?? "Split"} ✓` };
}

/** Accounts check a further invoice: it then goes to Zoho as its own bill. */
export async function checkLpoInvoiceAction(id: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  void _formData;
  const who = await payer();
  if ("error" in who) return { error: who.error };
  const inv = await lpoInvoiceById(id);
  const r = await checkLpoInvoice(id, who);
  if (inv) refresh(inv.po_id);
  return r.error ? { error: r.error } : { success: `${r.words} ✓` };
}

/** Edit a further invoice with a compulsory remark (kept in the edit history). */
export async function editLpoInvoiceAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const who = await payer();
  if ("error" in who) return { error: who.error };
  const inv = await lpoInvoiceById(id);
  if (!inv) return { error: "This invoice is no longer on the LPO." };
  const ids = await lineIdsOf(inv.po_id);
  const r = await editLpoInvoice(id, { number: String(formData.get("number") ?? ""), date: String(formData.get("date") ?? ""), amount: num(formData.get("amount")), vat: num(formData.get("vat")), lines: linesFromForm((k) => (formData.get(k) as string | null) ?? null, ids) }, String(formData.get("remark") ?? ""), who);
  if (r.error) return { error: r.error, values: formValues(formData) };
  refresh(inv.po_id);
  return { success: `${r.words ?? "Saved"} ✓` };
}

/** "Not on this invoice yet": lines (or part of a line) the first invoice does not cover - they wait for their own invoice. */
export async function notOnFirstAction(poId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const who = await payer();
  if ("error" in who) return { error: who.error };
  if (!(await lpoInvoicesReady())) return { error: "Several invoices per LPO switch on once the database change is applied." };
  const state = await lpoInvoiceState(poId);
  if (!state?.first.entered) return { error: "There is no entered invoice on this LPO yet." };
  const picked = linesFromForm((k) => (formData.get(k) as string | null) ?? null, state.lines.map((l) => l.id)).filter((l) => l.qty > 0);
  if (!picked.length) return { error: "Tick the lines that are not on this invoice." };
  for (const p of picked) {
    const c = state.coverage.find((x) => x.lineId === p.line_id);
    if (!c || p.qty > c.onFirst + 0.0005) return { error: "A line you ticked is not on this invoice (or not that many of it)." };
  }
  const remaining = firstAfterSplit(state.coverage, picked);
  if (!remaining.length) return { error: `Every line would leave invoice ${state.first.number}: change the invoice itself instead.` };
  const r = await setFirstInvoiceLines(poId, remaining, who);
  if (r.error) return { error: r.error };
  if (state.po.job_id) await createAdminClient().from("job_events").insert({ job_id: state.po.job_id, event_type: "supplier_invoice", note: `${state.po.number}: ${picked.length} line${picked.length === 1 ? "" : "s"} not on invoice ${state.first.number}, waiting for their own invoice (${who.display_name})`, created_by: who.id });
  refresh(poId);
  return { success: `Marked ✓ ${picked.length} line${picked.length === 1 ? "" : "s"} wait for their own invoice: use "Add another invoice" when it comes.` };
}
