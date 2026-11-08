"use server";
import { dbWords } from "@/lib/app-errors";

import { warnOwnerIfDepositShort } from "@/lib/deposits";
import { jobAdvisorIds as advisorsInCharge } from "@/lib/notifications";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission, requireStaff } from "@/lib/auth";
import { loadPartsChanges } from "@/lib/parts-changes-data";
import { formatDate } from "@/lib/format";
import { addPartsToOpenLpo, loadJobLpos, receivePartInFull, createMainLpo, lpoProblemWords, lpoProblemsFor, orderSupplierLpo, resendMainLpo, setPartExpected } from "@/lib/lpo";
import { lpoSelectRows } from "@/lib/lpo-select-data";
import { selectionProblem } from "@/lib/lpo-select";
import { gmailConfigured, sendGmail } from "@/lib/gmail";
import { notifyJobAdvisors, notifyRoles, notifyStaff } from "@/lib/notifications";
import { loadPurchaseOrder } from "@/lib/parts-data";
import { renderPoPdf } from "@/lib/pdf/invoice-pdf";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

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
  return advisorsInCharge(jobId);
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

/**
 * SEND LPO FOR SELECTED (8 November 2026, Peter): only the parts the desk ticked go for approval; the rest stay
 * "Approved – to order" for a later LPO. The ticks are checked again here with THE rule (lpoSelectRows): a repeated
 * part number, an unfinished line or a cost under AED 5 never goes on an LPO. With an LPO already waiting for
 * approval, the ticked parts join it (one request at a time).
 */
export async function sendSelectedLpo(jobId: string, partIds: string[]): Promise<{ error?: string; message?: string; number?: string }> {
  const staff = await requirePermission("managePurchaseOrders");
  if (staff.viewingAs) return { error: "View as is read-only." };
  const ids = Array.from(new Set((partIds ?? []).filter((x) => typeof x === "string" && x.length > 10)));
  const { rows } = await lpoSelectRows(jobId);
  const problem = selectionProblem(rows, ids);
  if (problem) return { error: problem };
  const { main } = await loadJobLpos(jobId);
  let number: string | undefined;
  let poId: string | null = null;
  if (main && main.status === "pending_approval") {
    const r = await addPartsToOpenLpo(jobId, staff, { partIds: ids });
    if (!r.added) return { error: `Could not add the parts to ${main.number}. Reload and try again.` };
    number = main.number;
    poId = main.id;
  } else {
    const r = await createMainLpo(jobId, staff, { partIds: ids });
    if (r.error) return { error: r.error };
    number = r.number;
    poId = r.poId ?? null;
    if (r.poId) await warnOwnerIfDepositShort(jobId, r.poId, r.number ?? "");
  }
  refresh(jobId, poId);
  const left = rows.length - ids.length;
  return { number, message: `${ids.length} part${ids.length === 1 ? "" : "s"} sent for approval on ${number}.${left > 0 ? ` ${left} stay${left === 1 ? "s" : ""} Approved – to order for a later LPO.` : ""}` };
}

/**
 * RESEND FOR APPROVAL (5 November 2026, J-00985): parts added after the customer's approval go to whoever approves
 * LPOs - only the changes - on a main LPO whose page shows old vs new. The new parts become "to order" for it (a
 * refusal puts them back under To order, as for any LPO); planning reopens; the advisors are told the difference.
 * The customer's approved quotation is never touched: revising it stays the advisor's choice.
 */
export async function resendForApproval(jobId: string) {
  const staff = await requireStaff();
  // The answer shows inside the Changes card, next to the button (the standing rule), never at the top of the page.
  const back = (kind: "error" | "message", words: string): never => redirect(`/parts/${jobId}?${kind === "error" ? "resend_error" : "resent"}=${enc(words)}#changes`);
  if (staff.viewingAs || !["owner", "parts", "service_advisor"].includes(staff.role_id)) back("error", "The parts desk, the advisor or the owner resends parts for approval.");
  const changes = await loadPartsChanges(jobId);
  if (!changes || !changes.needsApproval.length) back("error", "Nothing new to approve: every live part is approved already.");
  const c = changes!;
  const unpriced = c.added.filter((a) => !a.priced);
  if (unpriced.length) back("error", `Price ${unpriced.map((a) => a.description.toUpperCase()).join(", ")} first: a part with no cost cannot go for approval.`);
  const problems = await lpoProblemsFor(jobId, c.needsApproval);
  if (problems.size) back("error", lpoProblemWords(problems));
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("job_number, is_open").eq("id", jobId).maybeSingle();
  if (!job?.is_open) back("error", "This job is closed.");
  // The new parts go "to order" for this LPO (the approval of the LPO is their approval).
  const { error: upErr } = await admin.from("part_items").update({ order_status: "to_order", updated_by: staff.id }).in("id", c.needsApproval).eq("order_status", "none");
  if (upErr) back("error", "Couldn't send - nothing was changed. Try again or tell the owner.");
  const r = await createMainLpo(jobId, staff, { note: c.words ?? undefined });
  if (r.error) {
    // Nothing went for approval: the parts are put back exactly as they were.
    await admin.from("part_items").update({ order_status: "none", updated_by: staff.id }).in("id", c.needsApproval).eq("order_status", "to_order").is("po_id", null);
    back("error", r.error);
  }
  // Planning reopens: the car is not "every part here" any more.
  await admin.from("jobs").update({ plan_parts_done_at: null, plan_parts_ready_date: null, updated_by: staff.id }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_resent", note: `${staff.display_name} resent the parts for approval on ${r.number}: ${c.words}`, created_by: staff.id });
  const { data: q } = await admin.from("quotations").select("id, number").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true).in("status", ["approved", "urgent_requested"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  await notifyJobAdvisors(jobId, {
    type: "parts_changed_after_approval",
    title: `Parts changed after approval · ${job!.job_number}`,
    body: `${c.words} (sent for LPO approval by ${staff.display_name}). The customer's approved quotation${q ? ` ${q.number}` : ""} is unchanged - revise it if the price should change.`,
    href: q ? `/jobs/${jobId}/quote/${q.id}?revise=parts` : `/jobs/${jobId}`,
  }, { except: staff.id });
  if (r.poId) await warnOwnerIfDepositShort(jobId, r.poId, r.number ?? "");
  refresh(jobId, r.poId ?? null);
  back("message", `Sent for approval on ${r.number}: ${c.words}. The owner or the head accountant approves it; then the new LPO for the supplier appears here.`);
}

/** Fix 2.2 (4 November 2026): after a refusal, "Send for approval again" raises the new version from the CURRENT list. */
export async function resendRefusedLpo(jobId: string, refusedPoId: string) {
  const staff = await requirePermission("managePurchaseOrders");
  const r = await resendMainLpo(refusedPoId, staff);
  refresh(jobId, r.poId ?? null);
  if (r.error) redirect(`/parts/${jobId}?error=${enc(r.error)}#lpo`);
  if (r.poId) await warnOwnerIfDepositShort(jobId, r.poId, r.number ?? "");
  redirect(`/parts/${jobId}?message=${enc(`${r.number} sent for approval again with the current list. The owner sees what changed against the refused one.`)}#lpo`);
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
    return { error: e instanceof Error ? dbWords(e, "parts/lpo-actions") : "The email could not be sent." };
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
  for (const id of ids) {
    const r = await receivePartInFull(id, { id: staff.id, display_name: staff.display_name });
    if (r.error) return { error: r.error };
  }
  /*
   * 4 November 2026: receiving no longer asks for the invoice. The parts desk's angled photos misread amounts,
   * so the supplier's paper stays with Parts and ACCOUNTS collect, scan and enter it (owner + accounts only).
   * Every LPO received without its invoice goes on the "Waiting for invoice" list and accounts hear at once.
   */
  let invoiceWord = "";
  if (poIds.length) {
    const { data: pos } = await admin.from("purchase_orders").select("id, number, supplier_name, supplier_invoice_status").in("id", poIds);
    const open = ((pos ?? []) as { id: string; number: string; supplier_name: string; supplier_invoice_status: string }[]).filter((p) => p.supplier_invoice_status !== "received");
    if (open.length) {
      for (const po of open) {
        await admin.from("purchase_orders").update({ supplier_invoice_status: "to_follow", supplier_invoice_by: staff.id, updated_by: staff.id }).eq("id", po.id).neq("supplier_invoice_status", "received");
      }
      const { data: job } = await admin.from("jobs").select("job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin)").eq("id", jobId).maybeSingle();
      const plate = job?.vehicle ? formatPlate(job.vehicle as unknown as Parameters<typeof formatPlate>[0]) : "";
      const suppliers = Array.from(new Set(open.map((p) => p.supplier_name))).join(", ");
      await notifyRoles(["accounts"], {
        type: "supplier_invoice_missing",
        title: `Collect the supplier's invoice · ${job?.job_number ?? ""}`,
        body: `Parts received from ${suppliers} for ${job?.job_number ?? ""}${plate ? ` · ${plate}` : ""} – collect the supplier's invoice from Parts and scan it (${open.map((p) => p.number).join(", ")}).`,
        jobId,
        href: `/supplier-invoices?open=${encodeURIComponent(`follow:${open[0].id}`)}`,
      });
      invoiceWord = " The invoice goes to accounts: they collect the supplier's paper and scan it.";
    }
  }
  revalidatePath(`/parts/${jobId}`);
  revalidatePath("/parts");
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, message: `${ids.length} part${ids.length === 1 ? "" : "s"} received.${invoiceWord}` };
}
