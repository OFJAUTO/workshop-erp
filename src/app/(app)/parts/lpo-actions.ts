"use server";

import { warnOwnerIfDepositShort } from "@/lib/deposits";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { receivePartInFull, createMainLpo, orderSupplierLpo, setPartExpected } from "@/lib/lpo";
import { blankToNull } from "@/lib/format";
import { gmailConfigured, sendGmail } from "@/lib/gmail";
import { notifyStaff } from "@/lib/notifications";
import { loadPurchaseOrder } from "@/lib/parts-data";
import { renderPoPdf } from "@/lib/pdf/invoice-pdf";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkSupplierInvoice, dubaiToday } from "@/lib/supplier-invoice";

function refresh(jobId: string | null, poId?: string | null) {
  revalidatePath("/parts");
  revalidatePath("/parts/orders");
  if (poId) revalidatePath(`/parts/orders/${poId}`);
  if (jobId) {
    revalidatePath(`/parts/${jobId}`);
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/my-jobs/${jobId}`);
  }
  revalidatePath("/dashboard");
}

const enc = encodeURIComponent;

/** The job's advisors: who gated the car in and who sent the approval link. */
async function advisorIds(jobId: string) {
  const admin = createAdminClient();
  const [{ data: job }, { data: appr }] = await Promise.all([admin.from("jobs").select("gated_in_by").eq("id", jobId).maybeSingle(), admin.from("approval_requests").select("sent_by").eq("job_id", jobId)]);
  return Array.from(new Set([job?.gated_in_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}

/** Parts: one button after the customer's approval. The main LPO with every supplier goes to the owner or the head accountant. */
export async function sendLpoForApproval(jobId: string) {
  const staff = await requirePermission("managePurchaseOrders");
  const r = await createMainLpo(jobId, staff);
  refresh(jobId, r.poId ?? null);
  if (r.error) redirect(`/parts/${jobId}?error=${enc(r.error)}#lpo`);
  // The deposit has not arrived: the owner hears that the LPO waits on it (override on the LPO page, or wait).
  if (r.poId) await warnOwnerIfDepositShort(jobId, r.poId, r.number ?? "");
  redirect(`/parts/${jobId}?message=${enc(`${r.number} sent for approval. After the one-tap approval, one LPO per supplier appears here with Copy, PDF and Ordered.`)}#lpo`);
}

/** "Ordered" on a supplier LPO: one tap; the arrival dates follow from the availability entered at pricing. */
export async function markSupplierOrdered(poId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const from = String(formData.get("from") ?? "");
  const admin = createAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("id, job_id, supplier_name").eq("id", poId).maybeSingle();
  if (!po) redirect("/parts/orders");
  const back = from === "lpo" ? `/parts/orders/${poId}` : `/parts/${po.job_id}`;
  const r = await orderSupplierLpo(poId, staff);
  refresh(po.job_id, poId);
  if (r.error) redirect(`${back}?error=${enc(r.error)}`);
  const { data: job } = await admin.from("jobs").select("job_number").eq("id", po.job_id).maybeSingle();
  await notifyStaff(await advisorIds(po.job_id), { type: "parts_arrived", title: `Parts ordered · ${job?.job_number ?? ""}`, body: `${r.number} from ${po.supplier_name}${r.latest ? `, expected by ${formatDate(r.latest)}` : ""}.`, jobId: po.job_id, href: `/jobs/${po.job_id}` });
  redirect(`${back}?message=${enc(`${r.number} marked ordered${r.latest ? `; all here by ${formatDate(r.latest)}` : "; set the dates with a tap when the supplier confirms"}.`)}`);
}

/** One part's arrival date changed with a tap. */
export async function setPartExpectedDate(partId: string, formData: FormData) {
  const staff = await requirePermission("managePurchaseOrders");
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("job_id").eq("id", partId).maybeSingle();
  if (!p) redirect("/parts");
  const r = await setPartExpected(partId, String(formData.get("date") ?? "").trim(), staff);
  refresh(p.job_id);
  const from = String(formData.get("from") ?? "");
  const back = from.startsWith("/") ? from : `/parts/${p.job_id}`;
  redirect(`${back}?${r.error ? `error=${enc(r.error)}` : `message=${enc("Date saved.")}`}`);
}

/** One tap on the parts page: this part arrived in full. */
export async function receivePartAction(jobId: string, partId: string) {
  const staff = await requirePermission("managePurchaseOrders");
  const r = await receivePartInFull(partId, { id: staff.id, display_name: staff.display_name });
  revalidatePath(`/parts/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  if (r.error) redirect(`/parts/${jobId}?error=${encodeURIComponent(r.error)}#received`);
  // The part's stickers print the moment it is ticked received; Back returns to the parts page.
  const backTo = `/parts/${jobId}?message=${encodeURIComponent(r.complete ? "Received. Every part is in: hand them over." : "Received.")}#received`;
  redirect(`/parts/labels/${jobId}?part=${partId}&auto=1&back=${encodeURIComponent(backTo)}`);
}

/**
 * "Email to supplier": the supplier copy of the LPO (the PDF, never the customer or our selling prices) goes from the
 * workshop's Google Workspace mailbox to the supplier's email on file. Until the mailbox is connected the button says
 * so; without an email on the supplier it says what to add. The send is written on the LPO and the job.
 */
export async function emailSupplierLpo(poId: string): Promise<{ error?: string; message?: string }> {
  const staff = await requirePermission("managePurchaseOrders");
  const bundle = await loadPurchaseOrder(poId);
  if (!bundle) return { error: "LPO not found." };
  const { po, supplier } = bundle;
  if (po.kind === "main") return { error: "The main LPO is for approval only; email each supplier's LPO." };
  if (po.status === "pending_approval" || po.status === "cancelled") return { error: "This LPO is not approved." };
  if (!gmailConfigured()) return { error: "Email not set up yet: the owner adds the Google Workspace keys in Vercel first. Use Share PDF or Copy meanwhile." };
  const to = (supplier?.email ?? "").trim();
  if (!to) return { error: `Add ${po.supplier_name}'s email under Suppliers first.` };
  const settings = await getSettings();
  const from = String(settings.supplier_lpo_from_email ?? "").trim();
  if (!from) return { error: "Choose the mailbox to send from under Settings > Parts first." };
  const text = String(settings.supplier_lpo_email_text ?? "").replaceAll("[supplier]", po.supplier_name).replaceAll("[number]", po.number);
  let pdf: Buffer;
  try {
    pdf = await renderPoPdf(bundle, settings);
  } catch {
    return { error: "The LPO PDF could not be made." };
  }
  try {
    await sendGmail({ from, fromName: "OFJ Automotive, Parts", to, subject: `Purchase order ${po.number} from OFJ Automotive`, text, attachments: [{ filename: `OFJ ${po.number}.pdf`, content: pdf, contentType: "application/pdf" }] });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The email could not be sent." };
  }
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin.from("purchase_orders").update({ emailed_at: now, emailed_to: to, emailed_by: staff.id, ...(po.sent_at ? {} : { sent_at: now, sent_by: staff.id, sent_method: "email" }), updated_by: staff.id }).eq("id", poId);
  if (po.job_id) await admin.from("job_events").insert({ job_id: po.job_id, event_type: "lpo_sent", note: `${po.number} emailed to ${to} by ${staff.display_name}`, created_by: staff.id });
  refresh(po.job_id, poId);
  return { message: `Sent to ${to}.` };
}

/**
 * "Mark N received" with the stickers and the supplier invoice, all from the parts page: each ticked part is
 * received in full. The supplier invoice goes through the ONE rulebook (src/lib/supplier-invoice.ts): number and
 * date compulsory unless "Invoice to follow"; a nonsense number or a future date is refused; an amount more than
 * 5% off the LPO total must be confirmed (checked when the ticked parts sit on one LPO). The checks run BEFORE
 * anything is received, so a refusal never leaves half the work done.
 */
export async function receiveTicked(jobId: string, formData: FormData): Promise<{ error?: string; ok?: boolean; message?: string }> {
  const staff = await requirePermission("managePurchaseOrders");
  if (staff.viewingAs) return { error: "Viewing only." };
  const ids = formData.getAll("part").map(String).filter(Boolean);
  if (!ids.length) return { error: "Tick at least one part." };
  const admin = createAdminClient();
  const { data: poRows } = await admin.from("part_items").select("po_id").in("id", ids).not("po_id", "is", null);
  const poIds = Array.from(new Set((poRows ?? []).map((r) => r.po_id as string)));
  const toFollow = formData.get("to_follow") === "on";
  const num = blankToNull(formData.get("invoice_number"));
  const date = blankToNull(formData.get("invoice_date"));
  const amount = Number(String(formData.get("invoice_amount") ?? "").replace(/[^\d.]/g, "")) || null;
  const clientKey = blankToNull(formData.get("client_key"));
  const scanPath = blankToNull(formData.get("scan_path"));
  // The invoice rules run first (only when a supplier LPO is involved; stray stock has no invoice to track).
  if (poIds.length) {
    const poTotal = poIds.length === 1 ? Number((await admin.from("purchase_orders").select("total_cost_aed").eq("id", poIds[0]).maybeSingle()).data?.total_cost_aed) || null : null;
    const check = checkSupplierInvoice({ toFollow, number: num, date, amount, poTotal, amountConfirmed: formData.get("amount_confirmed") === "on", today: dubaiToday() });
    if (!check.ok) return { error: check.error };
  }
  for (const id of ids) {
    const r = await receivePartInFull(id, { id: staff.id, display_name: staff.display_name });
    if (r.error) return { error: r.error };
  }
  let invoiceWord = "";
  if (poIds.length) {
    const now = new Date().toISOString();
    if (toFollow) {
      // Marked explicitly: the LPO shows amber "Invoice missing", accounts list it, Parts get a daily reminder.
      for (const poId of poIds) {
        await admin.from("purchase_orders").update({ supplier_invoice_status: "to_follow", supplier_invoice_by: staff.id, updated_by: staff.id }).eq("id", poId).neq("supplier_invoice_status", "received");
      }
      invoiceWord = " Invoice to follow: it sits on the missing list until the number and date are entered.";
    } else {
      for (const poId of poIds) {
        await admin.from("purchase_orders").update({ supplier_invoice_number: num ? num.slice(0, 80) : null, supplier_invoice_date: date, supplier_invoice_amount: amount, ...(scanPath ? { supplier_invoice_path: scanPath } : {}), supplier_invoice_status: "received", supplier_invoice_at: now, supplier_invoice_by: staff.id, updated_by: staff.id }).eq("id", poId);
      }
      // Files uploaded before the save carry recv:<key>; they re-point to the (first) LPO so the scan shows on its page.
      if (clientKey) await admin.from("job_files").update({ ref_id: poIds[0] }).eq("job_id", jobId).eq("kind", "supplier_invoice").eq("ref_id", `recv:${clientKey}`).is("removed_at", null);
      invoiceWord = " Supplier invoice saved.";
    }
  }
  revalidatePath(`/parts/${jobId}`);
  revalidatePath("/parts");
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: `${ids.length} part${ids.length === 1 ? "" : "s"} received.${invoiceWord}` };
}
