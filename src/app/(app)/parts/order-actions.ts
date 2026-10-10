"use server";

import { approvedQuotations } from "@/lib/quote-data";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentStaff, requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { PAYMENT_SELECT, toPayment } from "@/lib/invoice-data";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { JOB_BRIEF_SELECT, PART_FULL_SELECT, PO_LINE_SELECT, PO_SELECT, newLabelCode, toPartFull, toPo, toPoLine, type JobBrief } from "@/lib/parts-data";
import { verifyPin } from "@/lib/pin";
import { round2 } from "@/lib/money";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureWorkLines } from "@/lib/work-data";

function refresh(jobId: string | null, poId?: string) {
  revalidatePath("/parts");
  revalidatePath("/parts/orders");
  if (poId) revalidatePath(`/parts/orders/${poId}`);
  if (jobId) {
    revalidatePath(`/parts/${jobId}`);
    revalidatePath(`/parts/issue/${jobId}`);
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/my-jobs/${jobId}`);
  }
  revalidatePath("/dashboard");
}

async function jobBrief(jobId: string): Promise<JobBrief | null> {
  const { data } = await createAdminClient().from("jobs").select(JOB_BRIEF_SELECT).eq("id", jobId).maybeSingle();
  return (data as unknown as JobBrief) ?? null;
}

/** The job's advisor(s): who gated the car in and who sent the approval link. */
async function advisorIds(jobId: string, job: JobBrief | null) {
  const { data: appr } = await createAdminClient().from("approval_requests").select("sent_by").eq("job_id", jobId);
  return Array.from(new Set([job?.gated_in_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}

/** Parts raise an LPO for the ticked parts of one job with one supplier. It waits for the owner or the head accountant. */
export async function createPurchaseOrder(jobId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const supplierId = blankToNull(formData.get("supplier_id"));
  const ids = formData.getAll("part").map(String).filter(Boolean);
  const notes = blankToNull(formData.get("notes"));
  const back = `/parts?error=`;
  const admin = createAdminClient();
  const { data: picked } = supplierId ? await admin.from("suppliers").select("id, name").eq("id", supplierId).maybeSingle() : { data: null };
  const supplier = (picked?.name ?? blankToNull(formData.get("supplier")) ?? "").slice(0, 120);
  if (!supplier) redirect(back + encodeURIComponent("Choose the supplier, or type the name of a new one."));
  if (!ids.length) redirect(back + encodeURIComponent("Tick at least one part."));
  const { data: rows } = await admin.from("part_items").select(PART_FULL_SELECT).in("id", ids).eq("job_id", jobId).eq("is_active", true);
  const parts = ((rows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull).filter((p) => p.order_status === "to_order" && !p.po_id);
  if (!parts.length) redirect(back + encodeURIComponent("Those parts are already on an LPO."));
  const lines = parts.map((p, i) => ({ part_item_id: p.id, position: i + 1, description: p.description, part_number: p.part_number, quantity: p.confirmed_quantity ?? p.quantity, unit_cost: p.cost_aed ?? 0 }));
  const total = round2(lines.reduce((a, l) => a + l.quantity * l.unit_cost, 0));
  const { data: sup } = picked ? { data: picked } : await admin.from("suppliers").select("id").ilike("name", supplier).maybeSingle();
  let supplierRef = sup?.id ?? null;
  if (!supplierRef) {
    const { data: created } = await admin.from("suppliers").insert({ name: supplier, created_by: staff.id, updated_by: staff.id }).select("id").single();
    supplierRef = created?.id ?? null;
  }
  const { data: po, error } = await admin.from("purchase_orders").insert({ job_id: jobId, supplier_id: supplierRef, supplier_name: supplier, notes, total_cost_aed: total, created_by: staff.id, updated_by: staff.id }).select("id, number").single();
  if (error || !po) redirect(back + encodeURIComponent(error?.message ?? "Could not raise the LPO."));
  const { data: createdLines } = await admin.from("purchase_order_lines").insert(lines.map((l) => ({ ...l, po_id: po.id, created_by: staff.id, updated_by: staff.id }))).select("id, part_item_id");
  for (const l of createdLines ?? []) await admin.from("part_items").update({ po_id: po.id, po_line_id: l.id, updated_by: staff.id }).eq("id", l.part_item_id);
  const job = await jobBrief(jobId);
  await admin.from("jobs").update({ parts_state: "ordering" }).eq("id", jobId).eq("parts_state", "none");
  await admin.from("job_events").insert({ job_id: jobId, event_type: "po_raised", note: `${po.number} raised by ${staff.display_name} for ${supplier}: ${lines.length} part${lines.length === 1 ? "" : "s"}, AED ${total.toLocaleString("en-GB")}`, created_by: staff.id });
  // Owner and head accountant hear the approval sound.
  const { data: heads } = await admin.from("staff").select("id").eq("role_id", "accounts").eq("is_head_accountant", true).eq("is_active", true);
  await notifyRoles(["owner"], { type: "po_approval", title: `LPO to approve · ${po.number}`, body: `${supplier} · ${job?.job_number ?? ""} · AED ${total.toLocaleString("en-GB")} · raised by ${staff.display_name}`, jobId, href: `/parts/orders/${po.id}` });
  await notifyStaff((heads ?? []).map((h) => h.id), { type: "po_approval", title: `LPO to approve · ${po.number}`, body: `${supplier} · ${job?.job_number ?? ""} · AED ${total.toLocaleString("en-GB")} · raised by ${staff.display_name}`, jobId, href: `/parts/orders/${po.id}` });
  refresh(jobId, po.id);
  redirect(`/parts/orders/${po.id}?message=${encodeURIComponent(`${po.number} raised. It waits for approval before it can be sent.`)}`);
}

/** The deposit on the job's approved quotation, and what has been received against it. */
async function depositState(jobId: string) {
  const admin = createAdminClient();
  const [{ data: q }, { data: pays }] = await Promise.all([
    approvedQuotations(jobId).then((qs) => ({ data: qs.length ? { deposit_aed: qs.reduce((a, q) => a + q.deposit_aed, 0) } : null })),
    admin.from("payments").select(PAYMENT_SELECT).eq("job_id", jobId).eq("is_active", true),
  ]);
  const required = Number(q?.deposit_aed) || 0;
  const received = ((pays ?? []) as Record<string, unknown>[]).map(toPayment).filter((p) => p.status === "recorded" && (p.method !== "cheque" || p.cheque_status === "cleared")).reduce((a, p) => a + p.amount_aed, 0);
  return { required, received: round2(received), short: required > 0 && received + 0.005 < required };
}

/** The owner or the head accountant approves or refuses an LPO. A required deposit must be recorded first, unless the owner overrides. */
export async function decidePurchaseOrder(poId: string, formData: FormData) {
  const staff = await requirePermission("approvePurchaseOrders");
  const role = staff.role_id as RoleId;
  const back = `/parts/orders/${poId}`;
  if (role === "accounts" && !staff.is_head_accountant) redirect(`${back}?error=${encodeURIComponent("Only the owner or the head accountant can approve an LPO.")}`);
  const admin = createAdminClient();
  const { data: raw } = await admin.from("purchase_orders").select(PO_SELECT).eq("id", poId).maybeSingle();
  if (!raw) redirect("/parts/orders");
  const po = toPo(raw as Record<string, unknown>);
  if (po.status !== "pending_approval") redirect(back);
  const decision = String(formData.get("decision") ?? "");
  const note = blankToNull(formData.get("note"));
  const job = await jobBrief(po.job_id);
  if (decision === "refuse") {
    await admin.from("purchase_orders").update({ status: "cancelled", notes: [po.notes, note ? `Refused: ${note}` : "Refused"].filter(Boolean).join("\n"), updated_by: staff.id }).eq("id", poId);
    await admin.from("part_items").update({ po_id: null, po_line_id: null, updated_by: staff.id }).eq("po_id", poId);
    await admin.from("job_events").insert({ job_id: po.job_id, event_type: "po_refused", note: `${po.number} refused by ${staff.display_name}${note ? `: ${note}` : ""}`, created_by: staff.id });
    if (po.created_by) await notifyStaff([po.created_by], { type: "po_decided", title: `${po.number} refused`, body: note ?? "", jobId: po.job_id, href: back });
    refresh(po.job_id, poId);
    redirect(`${back}?message=${encodeURIComponent("LPO refused.")}`);
  }
  const deposit = await depositState(po.job_id);
  let override: { by: string; reason: string } | null = null;
  if (deposit.short) {
    const reason = blankToNull(formData.get("override_reason"));
    if (role !== "owner") redirect(`${back}?error=${encodeURIComponent(`The quotation needs a deposit of AED ${deposit.required.toLocaleString("en-GB")} and AED ${deposit.received.toLocaleString("en-GB")} has been received. Record the deposit first; only the owner can override.`)}`);
    if (!reason || reason.length < 3) redirect(`${back}?error=${encodeURIComponent("The deposit has not been recorded. Write the reason to override.")}`);
    override = { by: staff.id, reason };
  }
  await admin.from("purchase_orders").update({ status: "approved", approved_by: staff.id, approved_at: new Date().toISOString(), deposit_override_by: override?.by ?? null, deposit_override_reason: override?.reason ?? null, updated_by: staff.id }).eq("id", poId);
  await admin.from("job_events").insert({ job_id: po.job_id, event_type: "po_approved", note: `${po.number} approved by ${staff.display_name}${override ? ` (deposit override: ${override.reason})` : ""}`, created_by: staff.id });
  await notifyRoles(["parts"], { type: "po_decided", title: `${po.number} approved: send it to ${po.supplier_name}`, body: `${job?.job_number ?? ""} · approved by ${staff.display_name}`, jobId: po.job_id, href: back });
  refresh(po.job_id, poId);
  redirect(`${back}?message=${encodeURIComponent("Approved. Download the PDF, send it to the supplier, then mark it ordered with the expected dates.")}`);
}

/** After sending the PDF, Parts mark the order placed with an expected date per line. */
export async function markOrdered(poId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const back = `/parts/orders/${poId}`;
  const admin = createAdminClient();
  const [{ data: raw }, { data: lineRows }] = await Promise.all([admin.from("purchase_orders").select(PO_SELECT).eq("id", poId).maybeSingle(), admin.from("purchase_order_lines").select(PO_LINE_SELECT).eq("po_id", poId).eq("is_active", true)]);
  if (!raw) redirect("/parts/orders");
  const po = toPo(raw as Record<string, unknown>);
  if (po.status !== "approved") redirect(`${back}?error=${encodeURIComponent(po.status === "pending_approval" ? "Not approved yet. It cannot be sent before approval." : "This order was already placed.")}`);
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toPoLine);
  for (const l of lines) {
    const d = String(formData.get(`expected__${l.id}`) ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) redirect(`${back}?error=${encodeURIComponent(`Enter the expected date for ${l.description}.`)}`);
    await admin.from("purchase_order_lines").update({ expected_date: d, updated_by: staff.id }).eq("id", l.id);
    await admin.from("part_items").update({ order_status: "ordered", expected_date: d, delivery_date: d, updated_by: staff.id }).eq("id", l.part_item_id);
  }
  await admin.from("purchase_orders").update({ status: "ordered", ordered_at: new Date().toISOString(), ordered_by: staff.id, updated_by: staff.id }).eq("id", poId);
  await admin.from("jobs").update({ parts_state: "ordered" }).eq("id", po.job_id).in("parts_state", ["none", "ordering"]);
  const job = await jobBrief(po.job_id);
  const latest = lines.map((l) => String(formData.get(`expected__${l.id}`))).sort().at(-1);
  await admin.from("job_events").insert({ job_id: po.job_id, event_type: "po_ordered", note: `${po.number} ordered from ${po.supplier_name} by ${staff.display_name}; expected by ${latest}`, created_by: staff.id });
  const ids = await advisorIds(po.job_id, job);
  await notifyStaff(ids, { type: "parts_arrived", title: `Parts ordered · ${job?.job_number ?? ""}`, body: `${po.number} from ${po.supplier_name}, expected by ${latest}.`, jobId: po.job_id, href: `/jobs/${po.job_id}` });
  refresh(po.job_id, poId);
  redirect(`${back}?message=${encodeURIComponent("Marked ordered. The job shows Waiting for parts with the dates.")}`);
}

/** Receiving: tick each line with the quantity received; partial deliveries allowed; wrong or damaged parts flagged for return. */
export async function receivePurchaseOrder(poId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const back = `/parts/orders/${poId}`;
  const admin = createAdminClient();
  const [{ data: raw }, { data: lineRows }] = await Promise.all([admin.from("purchase_orders").select(PO_SELECT).eq("id", poId).maybeSingle(), admin.from("purchase_order_lines").select(PO_LINE_SELECT).eq("po_id", poId).eq("is_active", true).order("position")]);
  if (!raw) redirect("/parts/orders");
  const po = toPo(raw as Record<string, unknown>);
  if (!["ordered", "partly_received"].includes(po.status)) redirect(`${back}?error=${encodeURIComponent("This order is not out for delivery.")}`);
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toPoLine);
  let received = 0;
  const now = new Date().toISOString();
  for (const l of lines) {
    const qty = Number(String(formData.get(`received__${l.id}`) ?? "").replace(",", "."));
    const flag = String(formData.get(`flag__${l.id}`) ?? "");
    const flagNote = blankToNull(formData.get(`flag_note__${l.id}`));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const total = round2(Math.min(l.quantity, l.received_qty + qty));
    const complete = total + 0.005 >= l.quantity;
    await admin.from("purchase_order_lines").update({ received_qty: total, received_at: now, flag: flag === "wrong" || flag === "damaged" ? flag : null, flag_note: flag ? flagNote : null, updated_by: staff.id }).eq("id", l.id);
    const { data: p } = await admin.from("part_items").select("label_code").eq("id", l.part_item_id).maybeSingle();
    await admin.from("part_items").update({ received_qty: total, order_status: complete ? "received" : "partly_received", label_code: p?.label_code ?? newLabelCode(), return_status: flag === "wrong" || flag === "damaged" ? "to_return" : "none", return_note: flag ? (flagNote ?? (flag === "wrong" ? "Wrong part" : "Damaged")) : null, updated_by: staff.id }).eq("id", l.part_item_id);
    received++;
  }
  if (!received) redirect(`${back}?error=${encodeURIComponent("Enter the quantity received on at least one line.")}`);
  const { data: after } = await admin.from("purchase_order_lines").select("quantity, received_qty").eq("po_id", poId).eq("is_active", true);
  const allIn = (after ?? []).every((l) => Number(l.received_qty) + 0.005 >= Number(l.quantity));
  await admin.from("purchase_orders").update({ status: allIn ? "received" : "partly_received", received_at: allIn ? now : null, updated_by: staff.id }).eq("id", poId);
  const job = await jobBrief(po.job_id);
  const { data: open } = await admin.from("part_items").select("id").eq("job_id", po.job_id).eq("is_active", true).in("order_status", ["to_order", "ordered", "partly_received"]);
  if ((open ?? []).length === 0) await admin.from("jobs").update({ parts_state: "received" }).eq("id", po.job_id);
  await admin.from("job_events").insert({ job_id: po.job_id, event_type: "parts_received", note: `${po.number}: ${received} line${received === 1 ? "" : "s"} received by ${staff.display_name}${allIn ? " (complete)" : " (partial)"}`, created_by: staff.id });
  const ids = await advisorIds(po.job_id, job);
  const n = { type: "parts_arrived", title: `Parts arrived · ${job?.job_number ?? ""}`, body: `${po.number} from ${po.supplier_name}${allIn ? ", complete" : ", partial delivery"}. ${(open ?? []).length === 0 ? "Every part is in: print the labels and issue them." : ""}`, jobId: po.job_id, href: `/jobs/${po.job_id}` };
  await notifyStaff(ids, n);
  await notifyManagers(job?.department ?? null, n);
  refresh(po.job_id, poId);
  redirect(`${back}?message=${encodeURIComponent(allIn ? "Received in full. Enter the supplier invoice, print the labels and issue the parts." : "Partial delivery recorded.")}`);
}

/** The supplier invoice: number and scan (compulsory), or "invoice to follow". A different price corrects the job cost. */
export async function supplierInvoice(poId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const back = `/parts/orders/${poId}`;
  const admin = createAdminClient();
  const [{ data: raw }, { data: lineRows }] = await Promise.all([admin.from("purchase_orders").select(PO_SELECT).eq("id", poId).maybeSingle(), admin.from("purchase_order_lines").select(PO_LINE_SELECT).eq("po_id", poId).eq("is_active", true)]);
  if (!raw) redirect("/parts/orders");
  const po = toPo(raw as Record<string, unknown>);
  const toFollow = formData.get("to_follow") === "on";
  const number = blankToNull(formData.get("invoice_number"));
  const path = blankToNull(formData.get("scan_path"));
  const amount = Number(String(formData.get("amount") ?? "").replace(/[^\d.]/g, ""));
  if (toFollow) {
    await admin.from("purchase_orders").update({ supplier_invoice_status: "to_follow", supplier_invoice_by: staff.id, updated_by: staff.id }).eq("id", poId);
    await admin.from("job_events").insert({ job_id: po.job_id, event_type: "supplier_invoice", note: `${po.number}: supplier invoice to follow (${staff.display_name})`, created_by: staff.id });
    refresh(po.job_id, poId);
    redirect(`${back}?message=${encodeURIComponent("Noted: invoice to follow. It sits in the pending list and the job's profit stays provisional.")}`);
  }
  if (!number) redirect(`${back}?error=${encodeURIComponent("Enter the supplier invoice number, or tick Invoice to follow.")}`);
  if (!path) redirect(`${back}?error=${encodeURIComponent("Attach the scan of the supplier invoice (phone camera or PC upload).")}`);
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toPoLine);
  const diffs: string[] = [];
  for (const l of lines) {
    const text = String(formData.get(`price__${l.id}`) ?? "").trim();
    if (!text) continue;
    const price = Number(text.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(price) || price < 0) continue;
    await admin.from("purchase_order_lines").update({ invoice_unit_cost: price, updated_by: staff.id }).eq("id", l.id);
    if (Math.abs(price - l.unit_cost) > 0.005) {
      diffs.push(`${l.description}: PO ${l.unit_cost.toFixed(2)}, invoice ${price.toFixed(2)}`);
      await admin.from("part_items").update({ final_cost_aed: price, updated_by: staff.id }).eq("id", l.part_item_id);
    }
  }
  await admin.from("purchase_orders").update({ supplier_invoice_status: "received", supplier_invoice_number: number.slice(0, 80), supplier_invoice_path: path, supplier_invoice_amount: Number.isFinite(amount) && amount > 0 ? amount : null, supplier_invoice_at: new Date().toISOString(), supplier_invoice_by: staff.id, updated_by: staff.id }).eq("id", poId);
  await admin.from("job_events").insert({ job_id: po.job_id, event_type: "supplier_invoice", note: `${po.number}: supplier invoice ${number} entered by ${staff.display_name}${diffs.length ? `. Price differences, job cost corrected: ${diffs.join("; ")}` : ""}`, created_by: staff.id });
  if (diffs.length) await notifyRoles(["owner", "accounts"], { type: "supplier_invoice_pending", title: `Supplier price differs from the PO · ${po.number}`, body: diffs.join("; "), jobId: po.job_id, href: back });
  refresh(po.job_id, poId);
  redirect(`${back}?message=${encodeURIComponent(diffs.length ? `Supplier invoice saved. ${diffs.length} price difference${diffs.length === 1 ? "" : "s"} flagged and the job cost corrected.` : "Supplier invoice saved.")}`);
}

/**
 * Issue: Parts scan each label, the technician ticks each part and enters his PIN. No "confirm all".
 * Only parts received on an approved LPO can be issued.
 */
export async function issueParts(jobId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const back = `/parts/issue/${jobId}`;
  const admin = createAdminClient();
  const ids = formData.getAll("part").map(String).filter(Boolean);
  const technicianId = String(formData.get("technician") ?? "");
  const pin = String(formData.get("pin") ?? "").trim();
  if (!ids.length) redirect(`${back}?error=${encodeURIComponent("Scan or tick at least one part.")}`);
  const [{ data: tech }, { data: priv }] = await Promise.all([admin.from("staff").select("id, display_name, role_id, is_active").eq("id", technicianId).maybeSingle(), admin.from("staff_private").select("pin_hash").eq("staff_id", technicianId).maybeSingle()]);
  if (!tech || !tech.is_active || tech.role_id !== "technician") redirect(`${back}?error=${encodeURIComponent("Choose the technician who takes the parts.")}`);
  if (!verifyPin(pin, priv?.pin_hash)) redirect(`${back}?error=${encodeURIComponent("The technician's PIN is wrong.")}`);
  const { data: rows } = await admin.from("part_items").select(PART_FULL_SELECT).in("id", ids).eq("job_id", jobId).eq("is_active", true);
  const parts = ((rows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull);
  const { data: pos } = parts.length ? await admin.from("purchase_orders").select("id, status").in("id", parts.map((p) => p.po_id).filter((x): x is string => !!x)) : { data: [] };
  const approvedPo = new Set((pos ?? []).filter((p) => !["pending_approval", "cancelled"].includes(p.status)).map((p) => p.id));
  const now = new Date().toISOString();
  let issued = 0;
  for (const p of parts) {
    const fromStock = p.availability === "in_stock";
    if (!(fromStock || (p.po_id && approvedPo.has(p.po_id))) || p.received_qty <= 0) redirect(`${back}?error=${encodeURIComponent(`${p.description} did not come in on an approved LPO or from stock and cannot be issued.`)}`);
    if (p.return_status !== "none") redirect(`${back}?error=${encodeURIComponent(`${p.description} is marked for return.`)}`);
    if (p.issue_status === "confirmed") continue;
    await admin.from("part_items").update({ issue_status: "confirmed", issued_qty: p.received_qty, issued_at: now, issued_by: staff.id, issue_confirmed_at: now, issue_confirmed_by: tech.id, updated_by: staff.id }).eq("id", p.id);
    issued++;
  }
  const job = await jobBrief(jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_issued", note: `${issued} part${issued === 1 ? "" : "s"} issued by ${staff.display_name} and confirmed by ${tech.display_name} with his PIN`, created_by: staff.id });
  await notifyStaff([tech.id], { type: "parts_issued", title: `Parts issued to you · ${job?.job_number ?? ""}`, body: `${issued} part${issued === 1 ? "" : "s"} confirmed with your PIN.`, jobId, href: `/my-jobs/${jobId}` });
  refresh(jobId);
  redirect(`/parts/handover/${jobId}?message=${encodeURIComponent(`${issued} part${issued === 1 ? "" : "s"} handed to ${tech.display_name}.`)}`);
}

/** A job moves to Work when its quotation is approved and its parts are issued, or it needs none. */
export async function moveToWorkIfReady(jobId: string, by: string | null, byName: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, status, department, assigned_to, is_open").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open || !["approved", "waiting_parts"].includes(job.status)) return false;
  const { data: parts } = await admin.from("part_items").select("id, order_status, issue_status, return_status").eq("job_id", jobId).eq("is_active", true).neq("order_status", "none");
  const needed = (parts ?? []).filter((p) => p.return_status !== "returned");
  if (needed.some((p) => p.issue_status !== "confirmed")) return false;
  await admin.from("jobs").update({ status: "in_work", stage: "work", parts_state: needed.length ? "issued" : "none", work_started_at: new Date().toISOString() }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "status_change", from_status: job.status, to_status: "in_work", note: needed.length ? "Every approved part issued" : "No parts needed", created_by: by });
  const made = await ensureWorkLines(jobId, by);
  await notifyManagers(job.department ?? null, { type: "work_ready", title: `Work order ready · ${job.job_number}`, body: `${made || "The"} approved line${made === 1 ? "" : "s"} to assign to a technician.${needed.length ? " Parts are issued." : ""}`, jobId, href: `/jobs/${jobId}/work` });
  if (job.assigned_to) await notifyStaff([job.assigned_to], { type: "work_assigned", title: `Work can start · ${job.job_number}`, body: `${byName} issued the parts. Open the work order on the tablet.`, jobId, href: `/my-jobs/${jobId}` });
  return true;
}

/** A part scanned back: marked for return to the supplier, its cost comes off the job. */
export async function returnPart(partId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const admin = createAdminClient();
  const { data: raw } = await admin.from("part_items").select(PART_FULL_SELECT).eq("id", partId).maybeSingle();
  if (!raw) redirect("/parts");
  const p = toPartFull(raw as unknown as Record<string, unknown>);
  const back = `/parts/issue/${p.job_id}`;
  const note = blankToNull(formData.get("note"));
  const stage = String(formData.get("stage") ?? "to_return");
  if (stage === "returned") {
    await admin.from("part_items").update({ return_status: "returned", returned_qty: p.received_qty || p.quantity, final_cost_aed: 0, issue_status: "none", issued_qty: 0, updated_by: staff.id }).eq("id", partId);
    await admin.from("job_events").insert({ job_id: p.job_id, event_type: "part_returned", note: `${p.description} returned to the supplier by ${staff.display_name}; cost taken off the job`, created_by: staff.id });
  } else {
    if (!note || note.length < 3) redirect(`${back}?error=${encodeURIComponent("Say why the part goes back.")}`);
    await admin.from("part_items").update({ return_status: "to_return", return_note: note, issue_status: "none", issued_qty: 0, updated_by: staff.id }).eq("id", partId);
    await admin.from("job_events").insert({ job_id: p.job_id, event_type: "part_return", note: `${p.description} scanned back by ${staff.display_name}: ${note}`, created_by: staff.id });
  }
  refresh(p.job_id);
  redirect(`${back}?message=${encodeURIComponent(stage === "returned" ? "Returned to the supplier." : "Marked for return.")}`);
}

/** Consumables: add or edit a stock item. */
export async function saveStockItem(formData: FormData) {
  const staff = await requirePermission("manageStock");
  const id = blankToNull(formData.get("id"));
  const name = blankToNull(formData.get("name"));
  if (!name) redirect(`/parts/stock?error=${encodeURIComponent("Type the item name.")}`);
  const row = { name: name.slice(0, 120), unit: (blankToNull(formData.get("unit")) ?? "pc").slice(0, 20), quantity: Number(String(formData.get("quantity") ?? "0").replace(",", ".")) || 0, minimum_level: Number(String(formData.get("minimum_level") ?? "0").replace(",", ".")) || 0, unit_cost: Number(String(formData.get("unit_cost") ?? "0").replace(/[^\d.]/g, "")) || 0, updated_by: staff.id };
  const admin = createAdminClient();
  const { error } = id ? await admin.from("stock_items").update(row).eq("id", id) : await admin.from("stock_items").insert({ ...row, created_by: staff.id });
  revalidatePath("/parts/stock");
  redirect(`/parts/stock?${error ? `error=${encodeURIComponent(error.message)}` : `message=${encodeURIComponent("Saved.")}`}`);
}

/** Consumables issued to a job by quantity, confirmed by the technician's PIN like a part. */
export async function issueStock(formData: FormData) {
  const staff = await requirePermission("manageStock");
  const itemId = String(formData.get("stock_item") ?? "");
  const jobId = String(formData.get("job") ?? "");
  const qty = Number(String(formData.get("quantity") ?? "").replace(",", "."));
  const technicianId = String(formData.get("technician") ?? "");
  const pin = String(formData.get("pin") ?? "").trim();
  const back = "/parts/stock";
  if (!itemId || !jobId || !Number.isFinite(qty) || qty <= 0) redirect(`${back}?error=${encodeURIComponent("Choose the item, the job and the quantity.")}`);
  const admin = createAdminClient();
  const [{ data: item }, { data: tech }, { data: priv }] = await Promise.all([admin.from("stock_items").select("id, name, quantity, unit_cost").eq("id", itemId).maybeSingle(), admin.from("staff").select("id, display_name, role_id").eq("id", technicianId).maybeSingle(), admin.from("staff_private").select("pin_hash").eq("staff_id", technicianId).maybeSingle()]);
  if (!item) redirect(`${back}?error=${encodeURIComponent("Item not found.")}`);
  if (!tech || tech.role_id !== "technician") redirect(`${back}?error=${encodeURIComponent("Choose the technician.")}`);
  // Small consumables need no PIN; above the threshold from Settings the technician confirms with his PIN.
  const threshold = Number((await getSettings()).pin_needed_above_aed) || 0;
  const value = qty * (Number(item.unit_cost) || 0);
  if (value > threshold && !verifyPin(pin, priv?.pin_hash)) redirect(`${back}?error=${encodeURIComponent(`Above AED ${threshold}: the technician's PIN is needed, and it was wrong or missing.`)}`);
  const now = new Date().toISOString();
  await admin.from("stock_issues").insert({ stock_item_id: itemId, job_id: jobId, quantity: qty, unit_cost: Number(item.unit_cost) || 0, issued_by: staff.id, confirmed_by: tech.id, confirmed_at: now, created_by: staff.id, updated_by: staff.id });
  await admin.from("stock_items").update({ quantity: Math.max(0, Number(item.quantity) - qty), updated_by: staff.id }).eq("id", itemId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "stock_issued", note: `${qty} × ${item.name} issued by ${staff.display_name}, confirmed by ${tech.display_name}`, created_by: staff.id });
  revalidatePath("/parts/stock");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`${back}?message=${encodeURIComponent(`${qty} × ${item.name} issued to ${tech.display_name}.`)}`);
}

/** Who may see LPOs: the owner, Parts, accounts and advisors. */
export async function canSeeOrders() {
  const staff = await getCurrentStaff();
  return !!staff && can(staff.role_id as RoleId, "viewPurchaseOrders");
}
