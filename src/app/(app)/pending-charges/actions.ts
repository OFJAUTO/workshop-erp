"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import type { ChargeInput } from "@/lib/charge-rules";
import { cancelChargeEntry, chargesReady, convertEntryIfPaid, createChargeEntry } from "@/lib/charges";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

const MAY_ADD = ["owner", "service_advisor", "accounts"];

function go(path: string, words: { message?: string; error?: string }): never {
  revalidatePath("/pending-charges");
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${words.error ? `error=${encodeURIComponent(words.error)}` : `message=${encodeURIComponent(words.message ?? "")}`}`);
}

/**
 * A PENDING CHARGE (1 November 2026): charges for a car that is not in the workshop (a recovery-only trip, a car that
 * never came in, or one that came and left with a bill still open). No gate-in, no job card, no approval: the
 * customer (picked or quickly added), the car (picked, quickly added, or none), the job it came from (optional), the
 * service date and the lines. Saving makes its own PROFORMA.
 */
export async function createEntryAction(formData: FormData) {
  const staff = await requireStaff();
  if (!MAY_ADD.includes(staff.role_id) || staff.viewingAs) return go("/pending-charges", { error: "Only the owner, an advisor or accounts add pending charges." });
  if (!(await chargesReady())) return go("/pending-charges", { error: "Pending charges need the database update first (waiting for apply)." });
  const admin = createAdminClient();
  let customerId = String(formData.get("customer_id") ?? "");
  const back = `/pending-charges?new=1${customerId ? `&customer=${customerId}` : ""}`;
  if (!customerId) {
    const name = String(formData.get("new_name") ?? "").trim();
    const phone = String(formData.get("new_phone") ?? "").replace(/[^\d+]/g, "");
    if (name.length < 2 || phone.length < 7) return go("/pending-charges?new=1", { error: "Pick the customer, or type a name and a mobile number." });
    const { data: c, error } = await admin.from("customers").insert({ full_name: name.toUpperCase(), phone, customer_type: formData.get("new_company") === "on" ? "company" : "individual", ...(formData.get("new_company") === "on" ? { company_name: name.toUpperCase() } : {}), created_by: staff.id, updated_by: staff.id }).select("id").single();
    if (error || !c) return go("/pending-charges?new=1", { error: "Couldn't add the customer. Try again." });
    customerId = c.id as string;
  }
  let vehicleId: string | null = String(formData.get("vehicle_id") ?? "") || null;
  if (vehicleId === "none") vehicleId = null;
  else if (vehicleId === "new") {
    const plate = String(formData.get("new_plate") ?? "").trim().toUpperCase();
    const makeId = String(formData.get("new_make") ?? "");
    if (!plate || !makeId) return go(back, { error: "A new car needs its plate number and make, or choose No car on record." });
    const code = String(formData.get("new_code") ?? "").trim().toUpperCase() || null;
    const { data: v, error } = await admin.from("vehicles").insert({ customer_id: customerId, make_id: makeId, has_plate: true, plate_country: "UAE", plate_emirate: String(formData.get("new_emirate") ?? "Dubai") || "Dubai", plate_code: code, plate_number: plate, created_by: staff.id, updated_by: staff.id }).select("id").single();
    if (error || !v) return go(back, { error: "Couldn't add the car. Try again." });
    vehicleId = v.id as string;
  }
  const jobId = String(formData.get("job_id") ?? "") || null;
  const serviceDate = String(formData.get("service_date") ?? "") || new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  let lines: ChargeInput[] = [];
  try {
    lines = (JSON.parse(String(formData.get("lines") ?? "[]")) as ChargeInput[]).map((l) => ({ ...l, description: String(l.description ?? "") }));
  } catch {
    return go(back, { error: "Couldn't read the charges. Try again." });
  }
  const r = await createChargeEntry({ customerId, vehicleId, jobId, serviceDate, note: String(formData.get("note") ?? "").trim() || null, lines }, staff, await getSettings());
  if (r.error || !r.id) return go(back, { error: r.error ?? "Couldn't save the pending charge." });
  return go(`/pending-charges?open=${r.id}`, { message: `Pending charge saved ✓ — ${r.proforma ? `PROFORMA ${r.proforma.number} is ready: send the link to the customer` : "the proforma could not be made, try again"}.` });
}

/** Accounts (or the owner) issue the tax invoice before full payment, with a reason (logged). */
export async function issueEntryTaxInvoiceAction(entryId: string, formData: FormData) {
  const staff = await requireStaff();
  if (!["owner", "accounts"].includes(staff.role_id) || staff.viewingAs) return go(`/pending-charges?open=${entryId}`, { error: "Only accounts or the owner issue the tax invoice." });
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5) return go(`/pending-charges?open=${entryId}`, { error: "Write why the tax invoice is issued before it is paid." });
  const tax = await convertEntryIfPaid(entryId, staff, await getSettings(), { reason });
  if (!tax) return go(`/pending-charges?open=${entryId}`, { error: "Couldn't issue the tax invoice (already issued, or cancelled)." });
  return go(`/pending-charges?open=${entryId}`, { message: `Tax invoice ${tax.number} issued ✓ (logged with your reason).` });
}

/** Cancelled only with a reason (logged), never once a tax invoice exists or money was paid. */
export async function cancelEntryAction(entryId: string, formData: FormData) {
  const staff = await requireStaff();
  if (!MAY_ADD.includes(staff.role_id) || staff.viewingAs) return go(`/pending-charges?open=${entryId}`, { error: "Not allowed." });
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5) return go(`/pending-charges?open=${entryId}`, { error: "Write why it is cancelled." });
  const r = await cancelChargeEntry(entryId, reason, staff);
  if (r.error) return go(`/pending-charges?open=${entryId}`, { error: r.error });
  return go("/pending-charges", { message: "Pending charge cancelled (logged with your reason)." });
}
