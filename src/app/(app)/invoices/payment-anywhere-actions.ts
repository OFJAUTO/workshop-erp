"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import type { BankFees } from "@/lib/bank-fees";
import { allocatePayment, paymentChoices, type AllocateResult, type PaymentChoices } from "@/lib/customer-money";
import { customerName } from "@/lib/customer-view";
import { formatPlate } from "@/lib/types";
import { greetingNameOf } from "@/lib/messages";
import { round2 } from "@/lib/money";
import { methodsFor } from "@/lib/money-steps";
import { DEFAULT_UNDO_MINUTES } from "@/lib/money-undo";
import { undoPayment } from "@/lib/payments";
import { paymentFromForm } from "@/lib/payment-form";
import { can, type RoleId } from "@/lib/roles";
import { bankFeesOf, getSettings } from "@/lib/settings";
import { shortFor } from "@/lib/short-links";
import { PRODUCTION_SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/uuid";

/**
 * The Record payment window (1 November 2026): it opens on every car page, customer page, job card, money page, the
 * Invoices and payments page and the search results, and always works - whatever the stage, with or without a job.
 * Only accounts and the owner record money (methodsFor); the answer comes back to the window itself.
 */

type Money = { id: string; display_name: string; role_id: string; viewingAs?: unknown; is_head_accountant?: boolean };
const mayRecord = (s: Money) => !s.viewingAs && can(s.role_id as RoleId, "recordPayments");

export type ChoicesAnswer = { error?: string; choices?: PaymentChoices; methods?: string[]; charges?: BankFees; isOwner?: boolean };

export async function loadPaymentChoices(input: { jobId?: string | null; customerId?: string | null; vehicleId?: string | null }): Promise<ChoicesAnswer> {
  const staff = await requireStaff();
  if (!mayRecord(staff)) return { error: "Payments are recorded by accounts or the owner." };
  for (const v of [input.jobId, input.customerId, input.vehicleId]) if (v && !isUuid(v)) return { error: "Not found." };
  const settings = await getSettings();
  const choices = await paymentChoices(input, settings);
  if (!choices) return { error: "Customer not found." };
  return { choices, methods: methodsFor(staff.role_id), charges: bankFeesOf(settings), isOwner: staff.role_id === "owner" };
}

export type PayerHit = { customerId: string; name: string; phone: string | null; vehicleId: string | null; car: string | null; jobId: string | null; jobNumber: string | null };

/** Find the payer by customer name, mobile, customer number, plate, VIN or job number (owner and accounts). */
export async function searchPayers(q: string): Promise<{ error?: string; hits?: PayerHit[] }> {
  const staff = await requireStaff();
  if (!mayRecord(staff)) return { error: "Payments are recorded by accounts or the owner." };
  const needle = q.trim().replace(/[%,()]/g, " ").trim();
  if (needle.length < 2) return { hits: [] };
  const admin = createAdminClient();
  const digits = needle.replace(/\D/g, "");
  const like = `%${needle}%`;
  const vehicleSelect = "id, customer_id, kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name)";
  const [{ data: custs }, { data: phones }, { data: cars }, { data: jobs }] = await Promise.all([
    admin.from("customers").select("id, full_name, company_name, phone").or(`full_name.ilike.${like},company_name.ilike.${like},customer_number.ilike.${like}`).limit(8),
    digits.length >= 5 ? admin.from("customers").select("id, full_name, company_name, phone").ilike("phone", `%${digits.slice(-9)}%`).limit(8) : Promise.resolve({ data: [] }),
    admin.from("vehicles").select(vehicleSelect).or(`plate_number.ilike.${like},vin.ilike.${like}`).limit(8),
    admin.from("jobs").select(`id, job_number, customer_id, vehicle:vehicles(${vehicleSelect})`).ilike("job_number", like).limit(6),
  ]);
  const people = new Map<string, { full_name: string | null; company_name: string | null; phone: string | null }>();
  for (const c of [...(custs ?? []), ...(phones ?? [])]) people.set(String(c.id), c as { full_name: string | null; company_name: string | null; phone: string | null });
  type V = Parameters<typeof formatPlate>[0] & { id: string; customer_id: string; model_year: number | null; make: { name: string } | null; model: { name: string } | null };
  const carWords = (v: V) => [formatPlate(v), [v.make?.name, v.model?.name, v.model_year].filter(Boolean).join(" ").toUpperCase()].filter(Boolean).join(" · ");
  const extra = new Set<string>([...((cars ?? []) as unknown as V[]).map((v) => v.customer_id), ...((jobs ?? []) as { customer_id: string }[]).map((j) => j.customer_id)].filter((id) => !people.has(id)));
  if (extra.size) {
    const { data: more } = await admin.from("customers").select("id, full_name, company_name, phone").in("id", Array.from(extra));
    for (const c of more ?? []) people.set(String(c.id), c as { full_name: string | null; company_name: string | null; phone: string | null });
  }
  const hits: PayerHit[] = [];
  for (const j of (jobs ?? []) as unknown as { id: string; job_number: string; customer_id: string; vehicle: V | null }[]) {
    const c = people.get(j.customer_id);
    if (c) hits.push({ customerId: j.customer_id, name: customerName(c), phone: c.phone, vehicleId: j.vehicle?.id ?? null, car: j.vehicle ? carWords(j.vehicle) : null, jobId: j.id, jobNumber: j.job_number });
  }
  for (const v of (cars ?? []) as unknown as V[]) {
    const c = people.get(v.customer_id);
    if (c && !hits.some((h) => h.vehicleId === v.id)) hits.push({ customerId: v.customer_id, name: customerName(c), phone: c.phone, vehicleId: v.id, car: carWords(v), jobId: null, jobNumber: null });
  }
  for (const [id, c] of people) if (!hits.some((h) => h.customerId === id)) hits.push({ customerId: id, name: customerName(c), phone: c.phone, vehicleId: null, car: null, jobId: null, jobNumber: null });
  return { hits: hits.slice(0, 12) };
}

export type RecordAnywhereState = {
  error?: string;
  ok?: boolean;
  number?: string;
  paymentId?: string;
  clientKey?: string | null;
  needsOverNote?: { balance: number };
  receiptUrl?: string;
  receiptShort?: string;
  receiptMessage?: string;
  phoneDigits?: string;
  where?: string;
  /** The undo window (1 November 2026, B3): when it was recorded and how long it may be undone. */
  recordedAt?: string;
  undoMinutes?: number;
  at?: number;
} | null;

function refreshMoney(jobId: string | null, customerId: string | null, vehicleId: string | null) {
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  if (jobId) {
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/invoice`);
  }
  if (customerId) revalidatePath(`/customers/${customerId}`);
  if (vehicleId) revalidatePath(`/vehicles/${vehicleId}`);
}

/** Records from the window and answers in the window: the receipt, the message to send it, where the money went. */
export async function recordPaymentAnywhere(_prev: RecordAnywhereState, formData: FormData): Promise<RecordAnywhereState> {
  const staff = await requireStaff();
  if (!mayRecord(staff)) return { error: "Payments are recorded by accounts or the owner.", at: Date.now() };
  const settings = await getSettings();
  const r = await paymentFromForm(staff, formData, settings);
  const clientKey = String(formData.get("client_key") ?? "") || null;
  if (r.error || !r.paymentId) return { error: r.error ?? "Couldn't record it – nothing was saved. Try again.", needsOverNote: r.needsOverNote, at: Date.now() };
  const admin = createAdminClient();
  const { data: p } = await admin.from("payments").select("id, number, amount_aed, token, job_id, invoice_id, customer_id, vehicle_id, deposit_quotation_id").eq("id", r.paymentId).maybeSingle();
  if (!p) return { ok: true, number: r.number, paymentId: r.paymentId, clientKey, recordedAt: new Date().toISOString(), undoMinutes: Number((settings as unknown as Record<string, unknown>).money_undo_minutes) || DEFAULT_UNDO_MINUTES, at: Date.now() };
  const [{ data: cust }, { data: car }, { data: job }, { data: inv }, { data: q }] = await Promise.all([
    admin.from("customers").select("full_name, company_name, phone").eq("id", p.customer_id).maybeSingle(),
    p.vehicle_id ? admin.from("vehicles").select("kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", p.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    p.job_id ? admin.from("jobs").select("job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", p.job_id).maybeSingle() : Promise.resolve({ data: null }),
    p.invoice_id ? admin.from("invoices").select("number, token, kind").eq("id", p.invoice_id).maybeSingle() : Promise.resolve({ data: null }),
    p.deposit_quotation_id ? admin.from("quotations").select("token").eq("id", p.deposit_quotation_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  type V = Parameters<typeof formatPlate>[0] & { model_year: number | null; make: { name: string } | null; model: { name: string } | null };
  const v = ((job as { vehicle?: V | null } | null)?.vehicle ?? (car as V | null)) ?? null;
  // The receipt reaches the customer with a token of its own (the invoice's, the quotation's or the payment's).
  const key = inv?.token ? `t=${inv.token}` : q?.token ? `q=${q.token}` : p.token ? `p=${p.token}` : "";
  const path = `/api/pdf/receipt/${p.id}${key ? `?${key}` : ""}`;
  const receiptShort = await shortFor(`${PRODUCTION_SITE_URL}${path}`).catch(() => `${PRODUCTION_SITE_URL}${path}`);
  const message = String(settings.whatsapp_deposit_receipt_template ?? "")
    .replaceAll("[name]", greetingNameOf(cust as { full_name: string; company_name: string | null } | null))
    .replaceAll("[make model]", v ? [v.make?.name, v.model?.name].filter(Boolean).join(" ") : "car")
    .replaceAll("[plate]", v ? formatPlate(v) : "")
    .replaceAll("[amount]", round2(Number(p.amount_aed)).toLocaleString("en-GB", { minimumFractionDigits: 2 }))
    .replaceAll("[link]", receiptShort);
  const where = inv?.number ? `on ${inv.kind === "proforma" ? "proforma" : "tax invoice"} ${inv.number}${job?.job_number ? ` (${job.job_number})` : ""}` : job?.job_number ? `as an advance on ${job.job_number} – it comes off the invoice by itself` : "on the customer's account (not allocated)";
  refreshMoney((p.job_id as string | null) ?? null, String(p.customer_id), (p.vehicle_id as string | null) ?? null);
  const undo = { recordedAt: new Date().toISOString(), undoMinutes: Number((settings as unknown as Record<string, unknown>).money_undo_minutes) || DEFAULT_UNDO_MINUTES };
  return { ok: true, ...undo, number: String(p.number), paymentId: String(p.id), clientKey, receiptUrl: path, receiptShort, receiptMessage: message, phoneDigits: String(cust?.phone ?? "").replace(/[^\d]/g, ""), where, at: Date.now() };
}

export type AllocateState = (AllocateResult & { at?: number }) | null;

/** An unallocated advance goes to a job or its invoice in one step (owner and accounts). */
export async function allocatePaymentAction(_prev: AllocateState, formData: FormData): Promise<AllocateState> {
  const staff = await requireStaff();
  if (!mayRecord(staff)) return { error: "Payments are allocated by accounts or the owner.", at: Date.now() };
  const paymentId = String(formData.get("payment_id") ?? "");
  const target = String(formData.get("target") ?? "");
  if (!isUuid(paymentId)) return { error: "Payment not found.", at: Date.now() };
  const [kind, id] = target.split(":");
  if (!isUuid(id) || !(kind === "inv" || kind === "job")) return { error: "Choose the job or invoice it goes to.", at: Date.now() };
  const settings = await getSettings();
  const r = await allocatePayment(paymentId, kind === "inv" ? { invoiceId: id } : { jobId: id }, { id: staff.id, display_name: staff.display_name }, String(formData.get("over_note") ?? "") || null, settings);
  const { data: p } = await createAdminClient().from("payments").select("job_id, customer_id, vehicle_id").eq("id", paymentId).maybeSingle();
  refreshMoney((p?.job_id as string | null) ?? null, (p?.customer_id as string | null) ?? null, (p?.vehicle_id as string | null) ?? null);
  return { ...r, at: Date.now() };
}

/** Undo from the window's "recorded" screen inside the undo window (1 November 2026, B3): the receipt is voided as
 * "Undone" and its Zoho row, held back during the window, is dropped before it posts. */
export async function undoPaymentFromWindow(paymentId: string): Promise<{ error?: string; ok?: boolean; message?: string }> {
  const staff = await requireStaff();
  if (!mayRecord(staff)) return { error: "Payments are recorded by accounts or the owner." };
  if (staff.viewingAs) return { error: "Switch off View as to undo." };
  if (!isUuid(paymentId)) return { error: "Payment not found." };
  const r = await undoPayment(paymentId, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id, is_head_accountant: staff.is_head_accountant }, await getSettings());
  const { data: p } = await createAdminClient().from("payments").select("job_id, customer_id, vehicle_id").eq("id", paymentId).maybeSingle();
  refreshMoney((p?.job_id as string | null) ?? null, (p?.customer_id as string | null) ?? null, (p?.vehicle_id as string | null) ?? null);
  return r.error ? { error: r.error } : { ok: true, message: r.message };
}
