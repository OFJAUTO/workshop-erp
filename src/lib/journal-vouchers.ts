import "server-only";
import { createAdminClient } from "./supabase/admin";
import { schemaReady } from "./schema-ready";
import { pageAll } from "./page-all";
import { formatPlate } from "./types";
import { checkJvPay, checkPayLater, correctionWords, jvTypeOfKind, type JvType } from "./jv-rules";
import { reopenZoho, tryEnqueueZoho } from "./zoho-sync";

/*
 * JOURNAL VOUCHERS (17 November 2026, Section 6). THE server side of the Journal Voucher tab (accounts and the owner):
 *  - TO RECORD: every charge cost entered on a job ("Cost (we pay)") not on a live voucher yet. A recovery done by our
 *    drivers or a recovery company through the Recovery page (a trip) is paid there, never here (one record, not two).
 *  - Record: who paid (not pre-selected), the date, the reference, the proof - one voucher per charge (JV-00001…).
 *    A corrected amount (from the receipt) changes the job's cost too, logged.
 *  - Pay later: several charges of one provider on one invoice = one voucher, unpaid until it is paid.
 *  - Manual voucher: an expense not tied to a car.
 *  - To reimburse: vouchers paid with a staff member's own money, per person.
 *  - Void with a reason (the charge goes back to TO RECORD; Zoho takes the expense back).
 */

export async function jvReady(): Promise<boolean> {
  return schemaReady("journal_vouchers", "id, number, status, paid_by");
}

export type ToRecordRow = {
  id: string;
  jobId: string | null;
  jobNumber: string | null;
  car: string | null;
  kind: string;
  type: JvType;
  description: string;
  provider: string | null;
  amount: number;
  vat: number;
  trn: string | null;
  date: string;
  enteredBy: string | null;
  receiptPath: string | null;
};

type ChargeRow = { id: string; job_id: string | null; entry_id: string | null; kind: string; description: string; provider: string | null; cost_aed: number | string; cost_vat_aed: number | string | null; supplier_trn: string | null; bill_path: string | null; trip_id: string | null; service_date: string | null; created_at: string; created_by: string | null };

/** The charge costs waiting for accounts (oldest first). */
export async function loadToRecord(): Promise<ToRecordRow[]> {
  if (!(await jvReady())) return [];
  const admin = createAdminClient();
  const charges = await pageAll<ChargeRow>((a, b) => admin.from("charge_lines").select("id, job_id, entry_id, kind, description, provider, cost_aed, cost_vat_aed, supplier_trn, bill_path, trip_id, service_date, created_at, created_by").eq("is_active", true).gt("cost_aed", 0).is("trip_id", null).order("created_at").range(a, b) as unknown as PromiseLike<{ data: ChargeRow[] | null; error: { message: string } | null }>);
  if (!charges.length) return [];
  const { data: used } = await admin.from("journal_voucher_lines").select("charge_line_id").eq("is_active", true);
  const taken = new Set(((used ?? []) as { charge_line_id: string }[]).map((u) => u.charge_line_id));
  const open = charges.filter((c) => !taken.has(c.id));
  return describe(open);
}

async function describe(rows: ChargeRow[]): Promise<ToRecordRow[]> {
  const admin = createAdminClient();
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id).filter((x): x is string => !!x)));
  const staffIds = Array.from(new Set(rows.map((r) => r.created_by).filter((x): x is string => !!x)));
  const lineIds = rows.map((r) => r.id);
  const [{ data: jobs }, { data: ppl }, { data: files }] = await Promise.all([
    jobIds.length ? admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number)").in("id", jobIds) : Promise.resolve({ data: [] }),
    staffIds.length ? admin.from("staff").select("id, display_name").in("id", staffIds) : Promise.resolve({ data: [] }),
    lineIds.length ? admin.from("job_files").select("ref_id, storage_path").eq("kind", "supplier_invoice").in("ref_id", lineIds).is("removed_at", null) : Promise.resolve({ data: [] }),
  ]);
  const jobOf = new Map(((jobs ?? []) as unknown as { id: string; job_number: string; vehicle: Parameters<typeof formatPlate>[0] | null }[]).map((j) => [j.id, j]));
  const who = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const fileOf = new Map(((files ?? []) as { ref_id: string; storage_path: string }[]).map((f) => [f.ref_id, f.storage_path]));
  return rows.map((r) => {
    const j = r.job_id ? jobOf.get(r.job_id) : null;
    return {
      id: r.id,
      jobId: r.job_id,
      jobNumber: j?.job_number ?? null,
      car: j?.vehicle ? formatPlate(j.vehicle) : null,
      kind: r.kind,
      type: jvTypeOfKind(r.kind),
      description: r.description,
      provider: r.provider,
      amount: Number(r.cost_aed) || 0,
      vat: Number(r.cost_vat_aed) || 0,
      trn: r.supplier_trn,
      date: String(r.service_date ?? r.created_at).slice(0, 10),
      enteredBy: r.created_by ? who.get(r.created_by) ?? null : null,
      receiptPath: r.bill_path ?? fileOf.get(r.id) ?? null,
    };
  });
}

/** How many charge costs wait for accounts (the menu badge). */
export async function jvToRecordCount(): Promise<number> {
  return (await loadToRecord()).length;
}

export type VoucherRow = { id: string; number: string; kind: string; status: string; paidBy: string | null; staffId: string | null; staffName: string; paidOn: string | null; reference: string | null; proofPath: string | null; provider: string | null; providerInvoice: string | null; type: JvType; description: string | null; amount: number; vat: number; reimbursedAt: string | null; voidReason: string | null; jobs: string[]; by: string | null; createdAt: string; zoho: boolean };

/** Every voucher, newest first (the history, the unpaid ones, the ones to reimburse). */
export async function loadVouchers(): Promise<VoucherRow[]> {
  if (!(await jvReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("journal_vouchers").select("id, number, kind, status, paid_by, staff_id, paid_on, reference, proof_path, provider, provider_invoice_number, expense_type, description, amount_aed, vat_aed, reimbursed_at, void_reason, created_at, created_by, zoho_expense_id").eq("is_active", true).order("created_at", { ascending: false }).limit(500);
  const vs = (data ?? []) as { id: string; number: string; kind: string; status: string; paid_by: string | null; staff_id: string | null; paid_on: string | null; reference: string | null; proof_path: string | null; provider: string | null; provider_invoice_number: string | null; expense_type: JvType; description: string | null; amount_aed: number | string; vat_aed: number | string; reimbursed_at: string | null; void_reason: string | null; created_at: string; created_by: string | null; zoho_expense_id: string | null }[];
  if (!vs.length) return [];
  const { data: lines } = await admin.from("journal_voucher_lines").select("voucher_id, job_id").in("voucher_id", vs.map((v) => v.id)).eq("is_active", true);
  const jobIds = Array.from(new Set(((lines ?? []) as { job_id: string | null }[]).map((l) => l.job_id).filter((x): x is string => !!x)));
  const staffIds = Array.from(new Set(vs.flatMap((v) => [v.staff_id, v.created_by]).filter((x): x is string => !!x)));
  const [{ data: jobs }, { data: ppl }] = await Promise.all([
    jobIds.length ? admin.from("jobs").select("id, job_number").in("id", jobIds) : Promise.resolve({ data: [] }),
    staffIds.length ? admin.from("staff").select("id, display_name").in("id", staffIds) : Promise.resolve({ data: [] }),
  ]);
  const jn = new Map(((jobs ?? []) as { id: string; job_number: string }[]).map((j) => [j.id, j.job_number]));
  const who = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  return vs.map((v) => ({
    id: v.id,
    number: v.number,
    kind: v.kind,
    status: v.status,
    paidBy: v.paid_by,
    staffId: v.staff_id,
    staffName: v.staff_id ? who.get(v.staff_id) ?? "" : "",
    paidOn: v.paid_on,
    reference: v.reference,
    proofPath: v.proof_path,
    provider: v.provider,
    providerInvoice: v.provider_invoice_number,
    type: v.expense_type,
    description: v.description,
    amount: Number(v.amount_aed) || 0,
    vat: Number(v.vat_aed) || 0,
    reimbursedAt: v.reimbursed_at,
    voidReason: v.void_reason,
    jobs: Array.from(new Set(((lines ?? []) as { voucher_id: string; job_id: string | null }[]).filter((l) => l.voucher_id === v.id && l.job_id).map((l) => jn.get(l.job_id as string) ?? ""))).filter(Boolean),
    by: v.created_by ? who.get(v.created_by) ?? null : null,
    createdAt: v.created_at,
    zoho: !!v.zoho_expense_id,
  }));
}

type Actor = { id: string; display_name: string; role_id: string };
type Pay = { paidBy: string | null; staffId: string | null; paidOn: string | null; reference: string | null; proofPath: string | null };
const r2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
const may = (by: Actor) => by.role_id === "owner" || by.role_id === "accounts";

/** The ticked charges, read again (they must still be open), with the amounts accounts typed. */
async function pickCharges(lines: { chargeLineId: string; amount: number; vat: number }[]): Promise<{ rows: ChargeRow[]; error?: string }> {
  const admin = createAdminClient();
  const ids = Array.from(new Set(lines.map((l) => l.chargeLineId)));
  if (!ids.length) return { rows: [], error: "Tick the charges to record." };
  const { data } = await admin.from("charge_lines").select("id, job_id, entry_id, kind, description, provider, cost_aed, cost_vat_aed, supplier_trn, bill_path, trip_id, service_date, created_at, created_by").in("id", ids).eq("is_active", true);
  const rows = (data ?? []) as ChargeRow[];
  if (rows.length !== ids.length) return { rows, error: "One of the ticked charges is not there any more. Reload the page." };
  const { data: used } = await admin.from("journal_voucher_lines").select("charge_line_id").in("charge_line_id", ids).eq("is_active", true);
  if ((used ?? []).length) return { rows, error: "One of the ticked charges is already on a voucher. Reload the page." };
  if (rows.some((r) => r.trip_id)) return { rows, error: "A recovery done as a trip is paid on the Recovery page, not here." };
  for (const l of lines) if (!(l.amount >= 0) || !(l.vat >= 0)) return { rows, error: "Amounts must be 0 or more." };
  return { rows };
}

/** A corrected amount changes the charge's cost (the job's profit follows), with a line in the job's history. */
async function applyCorrections(rows: ChargeRow[], lines: { chargeLineId: string; amount: number; vat: number }[], voucherNumber: string, by: Actor): Promise<void> {
  const admin = createAdminClient();
  for (const r of rows) {
    const l = lines.find((x) => x.chargeLineId === r.id)!;
    const words = correctionWords(Number(r.cost_aed) || 0, l.amount);
    const vatChanged = Math.abs((Number(r.cost_vat_aed) || 0) - l.vat) > 0.004;
    if (!words && !vatChanged) continue;
    await admin.from("charge_lines").update({ cost_aed: r2(l.amount), cost_vat_aed: r2(l.vat), updated_by: by.id }).eq("id", r.id);
    if (r.job_id) await admin.from("job_events").insert({ job_id: r.job_id, event_type: "charge_cost_corrected", note: `${voucherNumber}: ${r.description} – ${words ?? "VAT corrected"} by ${by.display_name} (the job's cost follows).`, created_by: by.id });
  }
}

/** Record ticked charges as PAID: one voucher per charge. */
export async function recordChargeVouchers(lines: { chargeLineId: string; amount: number; vat: number }[], pay: Pay, by: Actor, note: string | null): Promise<{ error?: string; numbers?: string[] }> {
  if (!may(by)) return { error: "Only accounts or the owner record journal vouchers." };
  if (!(await jvReady())) return { error: "The Journal Voucher switches on once the database change is applied." };
  const bad = checkJvPay({ ...pay, today: today() });
  if (bad) return { error: bad };
  const picked = await pickCharges(lines);
  if (picked.error) return { error: picked.error };
  const admin = createAdminClient();
  const numbers: string[] = [];
  for (const r of picked.rows) {
    const l = lines.find((x) => x.chargeLineId === r.id)!;
    const { data: v, error } = await admin
      .from("journal_vouchers")
      .insert({ kind: "charge", status: "paid", paid_by: pay.paidBy, staff_id: pay.paidBy === "staff" ? pay.staffId : null, paid_on: pay.paidOn, reference: pay.reference, proof_path: pay.proofPath, provider: r.provider, provider_trn: r.supplier_trn, expense_type: jvTypeOfKind(r.kind), description: r.description, amount_aed: r2(l.amount), vat_aed: r2(l.vat), note, created_by: by.id, updated_by: by.id })
      .select("id, number")
      .single();
    if (error || !v) return { error: numbers.length ? `Recorded ${numbers.join(", ")}; the rest could not be saved – reload and try again.` : "Couldn't save – nothing was recorded." };
    const { error: lErr } = await admin.from("journal_voucher_lines").insert({ voucher_id: v.id, charge_line_id: r.id, job_id: r.job_id, amount_aed: r2(l.amount), vat_aed: r2(l.vat), created_by: by.id, updated_by: by.id });
    if (lErr) {
      await admin.from("journal_vouchers").update({ status: "void", void_reason: "Its charge could not be attached", updated_by: by.id }).eq("id", v.id);
      return { error: "That charge is already on a voucher. Reload the page." };
    }
    await applyCorrections([r], [l], v.number as string, by);
    if (r.job_id) await admin.from("job_events").insert({ job_id: r.job_id, event_type: "journal_voucher", note: `${v.number}: ${r.description} recorded by ${by.display_name} (AED ${r2(l.amount + l.vat).toFixed(2)}).`, created_by: by.id });
    await tryEnqueueZoho("jv", v.id as string, r.job_id, by.id);
    numbers.push(v.number as string);
  }
  return { numbers };
}

/** "Pay later": the ticked charges of one provider on one invoice = ONE voucher, unpaid until it is paid. */
export async function payLaterVoucher(lines: { chargeLineId: string; amount: number; vat: number }[], bill: { provider: string; trn: string | null; invoiceNumber: string; invoiceDate: string | null }, by: Actor, note: string | null): Promise<{ error?: string; number?: string }> {
  if (!may(by)) return { error: "Only accounts or the owner record journal vouchers." };
  if (!(await jvReady())) return { error: "The Journal Voucher switches on once the database change is applied." };
  const bad = checkPayLater({ ...bill, today: today(), count: lines.length });
  if (bad) return { error: bad };
  const picked = await pickCharges(lines);
  if (picked.error) return { error: picked.error };
  const admin = createAdminClient();
  const amount = r2(lines.reduce((a, l) => a + l.amount, 0));
  const vat = r2(lines.reduce((a, l) => a + l.vat, 0));
  const types = Array.from(new Set(picked.rows.map((r) => jvTypeOfKind(r.kind))));
  const { data: v, error } = await admin
    .from("journal_vouchers")
    .insert({ kind: "charge", status: "unpaid", provider: bill.provider.trim(), provider_trn: bill.trn, provider_invoice_number: bill.invoiceNumber.trim(), provider_invoice_date: bill.invoiceDate, expense_type: types.length === 1 ? types[0] : "other", description: `${bill.provider.trim()} invoice ${bill.invoiceNumber.trim()} (${lines.length} charge${lines.length === 1 ? "" : "s"})`, amount_aed: amount, vat_aed: vat, note, created_by: by.id, updated_by: by.id })
    .select("id, number")
    .single();
  if (error || !v) return { error: "Couldn't save – nothing was recorded." };
  const { error: lErr } = await admin.from("journal_voucher_lines").insert(picked.rows.map((r) => { const l = lines.find((x) => x.chargeLineId === r.id)!; return { voucher_id: v.id, charge_line_id: r.id, job_id: r.job_id, amount_aed: r2(l.amount), vat_aed: r2(l.vat), created_by: by.id, updated_by: by.id }; }));
  if (lErr) {
    await admin.from("journal_vouchers").update({ status: "void", void_reason: "Its charges could not be attached", updated_by: by.id }).eq("id", v.id);
    return { error: "One of the charges is already on a voucher. Reload the page." };
  }
  await applyCorrections(picked.rows, lines, v.number as string, by);
  return { number: v.number as string };
}

/** Pay a "pay later" voucher (who paid, the date, reference, proof): it then posts to Zoho. */
export async function payVoucher(id: string, pay: Pay, by: Actor): Promise<{ error?: string; number?: string }> {
  if (!may(by)) return { error: "Only accounts or the owner record journal vouchers." };
  const bad = checkJvPay({ ...pay, today: today() });
  if (bad) return { error: bad };
  const admin = createAdminClient();
  const { data: v } = await admin.from("journal_vouchers").update({ status: "paid", paid_by: pay.paidBy, staff_id: pay.paidBy === "staff" ? pay.staffId : null, paid_on: pay.paidOn, reference: pay.reference, proof_path: pay.proofPath, updated_by: by.id }).eq("id", id).eq("status", "unpaid").select("id, number").maybeSingle();
  if (!v) return { error: "This voucher is already paid or voided. Reload the page." };
  await tryEnqueueZoho("jv", id, null, by.id);
  return { number: v.number as string };
}

/** A manual voucher: an expense not tied to a car. */
export async function manualVoucher(input: { type: JvType; description: string; provider: string | null; trn: string | null; amount: number; vat: number } & Pay, by: Actor): Promise<{ error?: string; number?: string }> {
  if (!may(by)) return { error: "Only accounts or the owner record journal vouchers." };
  if (!(await jvReady())) return { error: "The Journal Voucher switches on once the database change is applied." };
  if (input.description.trim().length < 3) return { error: "Say what it was for." };
  if (!(input.amount > 0)) return { error: "Type the amount (before VAT)." };
  if (!(input.vat >= 0)) return { error: "VAT must be 0 or more." };
  const bad = checkJvPay({ ...input, today: today() });
  if (bad) return { error: bad };
  const admin = createAdminClient();
  const { data: v, error } = await admin.from("journal_vouchers").insert({ kind: "manual", status: "paid", paid_by: input.paidBy, staff_id: input.paidBy === "staff" ? input.staffId : null, paid_on: input.paidOn, reference: input.reference, proof_path: input.proofPath, provider: input.provider, provider_trn: input.trn, expense_type: input.type, description: input.description.trim(), amount_aed: r2(input.amount), vat_aed: r2(input.vat), created_by: by.id, updated_by: by.id }).select("id, number").single();
  if (error || !v) return { error: "Couldn't save – nothing was recorded." };
  await tryEnqueueZoho("jv", v.id as string, null, by.id);
  return { number: v.number as string };
}

/** Mark a staff member's vouchers reimbursed (how and the reference kept). */
export async function markReimbursed(ids: string[], how: { method: string; reference: string | null; date: string }, by: Actor): Promise<{ error?: string; count?: number }> {
  if (!may(by)) return { error: "Only accounts or the owner reimburse staff." };
  if (!["cash", "transfer"].includes(how.method)) return { error: "Choose how he was paid back: cash or bank transfer." };
  if (!ids.length) return { error: "Nothing to reimburse." };
  const admin = createAdminClient();
  const { data } = await admin.from("journal_vouchers").update({ reimbursed_at: new Date(`${how.date}T12:00:00+04:00`).toISOString(), reimbursed_by: by.id, reimburse_method: how.method, reimburse_reference: how.reference, updated_by: by.id }).in("id", ids).eq("paid_by", "staff").is("reimbursed_at", null).eq("status", "paid").select("id");
  return { count: (data ?? []).length };
}

/** Void a voucher with a reason: its charges go back to TO RECORD; Zoho takes the expense back. */
export async function voidVoucher(id: string, reason: string, by: Actor): Promise<{ error?: string; number?: string }> {
  if (!may(by)) return { error: "Only accounts or the owner void a voucher." };
  if (reason.trim().length < 5) return { error: "Write why (a few words) – it stays in the history." };
  const admin = createAdminClient();
  const { data: v } = await admin.from("journal_vouchers").update({ status: "void", void_reason: reason.trim(), updated_by: by.id }).eq("id", id).neq("status", "void").select("id, number").maybeSingle();
  if (!v) return { error: "This voucher is already voided." };
  await admin.from("journal_voucher_lines").update({ is_active: false, updated_by: by.id }).eq("voucher_id", id);
  await reopenZoho("jv", id);
  return { number: v.number as string };
}
