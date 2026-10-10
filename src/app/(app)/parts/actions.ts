"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { getCurrentStaff, requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { PARTS_BUCKET, PART_SELECT, minMarkupFor, refreshQuoteTotals, toPart, parentLineFor } from "@/lib/quote-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

function refresh(jobId: string) {
  revalidatePath("/parts");
  revalidatePath(`/parts/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath("/dashboard");
}

async function jobOf(jobId: string) {
  const { data } = await createAdminClient().from("jobs").select("id, job_number, department, assigned_to, gated_in_by, is_open, vehicle_id").eq("id", jobId).maybeSingle();
  return data;
}

/** The job's open quotation (draft), if any, so part lines stay in step with the part items. */
async function draftQuotation(jobId: string) {
  const { data } = await createAdminClient().from("quotations").select("id").eq("job_id", jobId).eq("is_active", true).in("status", ["draft", "pending_owner"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? null;
}

/** The part's line on the open quotation: made when the part is priced, kept in step afterwards. The first option of a group is the chosen one. */
export async function syncLineForPart(jobId: string, partId: string, by: string) {
  const admin = createAdminClient();
  const quotationId = await draftQuotation(jobId);
  if (!quotationId) return;
  const [{ data: pRaw }, { data: line }] = await Promise.all([
    admin.from("part_items").select(PART_SELECT).eq("id", partId).maybeSingle(),
    admin.from("quotation_lines").select("id").eq("quotation_id", quotationId).eq("part_item_id", partId).eq("is_active", true).maybeSingle(),
  ]);
  if (!pRaw) return;
  const p = toPart(pRaw as Record<string, unknown>);
  const title = p.part_number ? `${p.description} (${p.part_number})` : p.description;
  const shared = { title, quantity: p.quantity, unit_cost: p.cost_aed, part_type: p.part_type, brand: p.brand, option_group: p.option_group, updated_by: by };
  if (p.confirm_status === "rejected" || !p.is_active) {
    if (line) await admin.from("quotation_lines").update({ is_active: false, updated_by: by }).eq("id", line.id);
  } else if (line) {
    await admin.from("quotation_lines").update(shared).eq("id", line.id);
    const { data: cur } = await admin.from("quotation_lines").select("parent_line_id").eq("id", line.id).maybeSingle();
    if (cur && !cur.parent_line_id) {
      const { data: req0 } = p.part_request_id ? await admin.from("part_requests").select("source_type, source_key").eq("id", p.part_request_id).maybeSingle() : { data: null };
      const parent = await parentLineFor(quotationId, req0 ? { source_type: req0.source_type, source_key: req0.source_key } : null);
      if (parent) await admin.from("quotation_lines").update({ parent_line_id: parent, updated_by: by }).eq("id", line.id);
    }
  } else {
    const settings = await getSettings();
    const { data: v } = await admin.from("jobs").select("vehicle:vehicles(make:vehicle_makes(name))").eq("id", jobId).maybeSingle();
    const make = ((v?.vehicle as unknown as { make: { name: string } | null } | null)?.make?.name) ?? null;
    const { data: last } = await admin.from("quotation_lines").select("position").eq("quotation_id", quotationId).order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: req } = p.part_request_id ? await admin.from("part_requests").select("label, source_type, source_key").eq("id", p.part_request_id).maybeSingle() : { data: null };
    const parent = await parentLineFor(quotationId, req ? { source_type: req.source_type, source_key: req.source_key } : null);
    let chosen = true;
    if (p.option_group) {
      const { data: siblings } = await admin.from("quotation_lines").select("id").eq("quotation_id", quotationId).eq("option_group", p.option_group).eq("is_active", true).eq("chosen", true).limit(1);
      chosen = !(siblings ?? []).length;
    }
    await admin.from("quotation_lines").insert({ quotation_id: quotationId, position: (Number(last?.position) || 0) + 1, line_type: "part", ...shared, chosen, parent_line_id: parent, group_label: req?.label ?? "Parts", source_type: "manual", markup_percent: minMarkupFor(settings, make), part_item_id: p.id, created_by: by });
  }
  await refreshQuoteTotals(quotationId, await getSettings(), by, { reopen: true });
}

/** When every request on the job is answered and every part has a price, the advisor hears about it. */
async function tellAdvisorIfComplete(jobId: string) {
  const admin = createAdminClient();
  const [{ data: parts }, { data: reqs }, job] = await Promise.all([
    admin.from("part_items").select("cost_aed, confirm_status").eq("job_id", jobId).eq("is_active", true),
    admin.from("part_requests").select("status").eq("job_id", jobId).eq("is_active", true),
    jobOf(jobId),
  ]);
  const open = (parts ?? []).filter((p) => p.confirm_status !== "rejected" && p.cost_aed === null).length + (reqs ?? []).filter((r) => r.status === "open" || r.status === "listed").length;
  if (open || !job) return;
  const { data: appr } = await admin.from("approval_requests").select("sent_by").eq("job_id", jobId);
  const ids = [job.gated_in_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x);
  await notifyStaff(ids, { type: "parts_priced", title: `Parts priced · ${job.job_number}`, body: "Every part on this car has a price. Finish the quotation.", jobId, href: `/jobs/${jobId}` });
}

const PART_TYPES = ["genuine", "oem", "aftermarket", "used"];

/** One row from the Parts form: part number, description, quantity, type, brand, cost, supplier, availability. */
function readRow(formData: FormData, i: number, prefix = ""): { error?: string; row?: Record<string, unknown> } {
  const g = (k: string) => String(formData.getAll(`${prefix}${k}`)[i] ?? "").trim();
  const description = g("description").slice(0, 200);
  if (!description) return {};
  const qty = Math.max(1, Math.round(Number(g("quantity").replace(",", ".")) || 1));
  const type = g("part_type");
  if (!PART_TYPES.includes(type)) return { error: `${description}: tap the part type (Genuine, OEM, Aftermarket or Used).` };
  const costText = g("cost_aed").replace(/[^\d.]/g, "");
  if (costText === "" || !Number.isFinite(Number(costText)) || Number(costText) < 0) return { error: `${description}: enter the cost before VAT.` };
  const supplier = g("supplier").slice(0, 120);
  if (!supplier) return { error: `${description}: enter the supplier.` };
  const availability = g("availability") === "in_stock" ? "in_stock" : "to_order";
  const days = Math.max(0, Math.round(Number(g("days")) || 0));
  if (availability === "to_order" && days < 1) return { error: `${description}: how many days until it arrives?` };
  const delivery = availability === "to_order" ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) : null;
  return {
    row: {
      part_number: g("part_number").slice(0, 80) || null,
      description,
      quantity: Math.max(0.01, qty),
      confirmed_quantity: Math.max(0.01, qty),
      part_type: type,
      brand: type === "genuine" ? null : g("brand").slice(0, 80) || null,
      cost_aed: Number(costText),
      supplier,
      availability,
      delivery_date: delivery,
    },
  };
}

/**
 * Parts answer a request in one go: every row has the part number, description, quantity, type,
 * cost, supplier and availability. The parts are priced and on the quotation at once; nobody has
 * to confirm them. An optional catalogue diagram goes on the first part.
 */
export async function savePartRows(jobId: string, requestId: string | null, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await getCurrentStaff();
  const values = formValues(formData);
  if (!staff || staff.viewingAs) return { error: "Please sign in again.", values };
  const role = staff.role_id as RoleId;
  if (!can(role, "priceParts")) return { error: "Not allowed.", values };
  const job = await jobOf(jobId);
  if (!job || !job.is_open) return { error: "This job is closed.", values };
  const count = formData.getAll("description").length;
  const rows: Record<string, unknown>[] = [];
  const now = new Date().toISOString();
  for (let i = 0; i < count; i++) {
    const r = readRow(formData, i);
    if (r.error) return { error: r.error, values };
    if (r.row) rows.push({ job_id: jobId, part_request_id: requestId, ...r.row, confirm_status: "confirmed", confirmed_by: staff.id, confirmed_at: now, priced_by: staff.id, priced_at: now, added_by_role: role, created_by: staff.id, updated_by: staff.id });
  }
  if (!rows.length) return { error: "Enter at least one part with a description.", values };
  const admin = createAdminClient();
  const file = formData.get("diagram");
  if (file instanceof File && file.size > 0) {
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) return { error: "The diagram must be a JPG, PNG, WebP or PDF.", values };
    if (file.size > 20 * 1024 * 1024) return { error: "The diagram must be under 20 MB.", values };
    const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${jobId}/${Date.now()}-${randomBytes(3).toString("hex")}.${ext}`;
    const { error: upError } = await admin.storage.from(PARTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upError) return { error: "Diagram upload failed: " + upError.message, values };
    rows[0].diagram_path = path;
  }
  const { data: created, error } = await admin.from("part_items").insert(rows).select("id");
  if (error || !created) return { error: error?.message ?? "Could not save the parts.", values };
  if (requestId) await admin.from("part_requests").update({ status: "done", updated_by: staff.id }).eq("id", requestId);
  for (const c of created) await syncLineForPart(jobId, c.id, staff.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_listed", note: `${rows.length} part${rows.length === 1 ? "" : "s"} priced by ${staff.display_name}${requestId ? "" : " (added without a request)"}`, created_by: staff.id });
  await tellAdvisorIfComplete(jobId);
  refresh(jobId);
  return { success: `${rows.length} part${rows.length === 1 ? "" : "s"} saved and on the quotation.` };
}

/** Change one part: the same fields as the row. */
export async function updatePart(partId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("priceParts");
  const values = formValues(formData);
  const r = readRow(formData, 0);
  if (r.error) return { error: r.error, values };
  if (!r.row) return { error: "Enter the description.", values };
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id").eq("id", partId).maybeSingle();
  if (!p) return { error: "Part not found.", values };
  const { error } = await admin.from("part_items").update({ ...r.row, priced_by: staff.id, priced_at: new Date().toISOString(), updated_by: staff.id }).eq("id", partId);
  if (error) return { error: error.message, values };
  await syncLineForPart(p.job_id, partId, staff.id);
  await tellAdvisorIfComplete(p.job_id);
  refresh(p.job_id);
  return { success: "Saved." };
}

/** Another option for the same part (for example Genuine beside Aftermarket). The advisor picks one on the quotation. */
export async function addOption(partId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("priceParts");
  const values = formValues(formData);
  const admin = createAdminClient();
  const { data: base } = await admin.from("part_items").select("id, job_id, part_request_id, option_group, description").eq("id", partId).maybeSingle();
  if (!base) return { error: "Part not found.", values };
  const r = readRow(formData, 0);
  if (r.error) return { error: r.error, values };
  if (!r.row) return { error: "Enter the description of the option.", values };
  const group = base.option_group ?? base.id;
  if (!base.option_group) await admin.from("part_items").update({ option_group: group, updated_by: staff.id }).eq("id", base.id);
  const now = new Date().toISOString();
  const { data: created, error } = await admin.from("part_items").insert({ job_id: base.job_id, part_request_id: base.part_request_id, option_group: group, ...r.row, confirm_status: "confirmed", confirmed_by: staff.id, confirmed_at: now, priced_by: staff.id, priced_at: now, added_by_role: "parts", created_by: staff.id, updated_by: staff.id }).select("id").single();
  if (error || !created) return { error: error?.message ?? "Could not add the option.", values };
  // The first part of the group keeps its line as the chosen one; the option joins as a choice.
  const quotationId = await draftQuotation(base.job_id);
  if (quotationId) await admin.from("quotation_lines").update({ option_group: group, updated_by: staff.id }).eq("quotation_id", quotationId).eq("part_item_id", base.id);
  await syncLineForPart(base.job_id, created.id, staff.id);
  refresh(base.job_id);
  return { success: `Option added beside ${base.description}. The advisor picks one.` };
}

/** Parts ask the workshop manager about a part (with the catalogue diagram); he answers with one tap. It never blocks anything. */
export async function askManager(partId: string, formData: FormData) {
  const staff = await requirePermission("priceParts");
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, description").eq("id", partId).maybeSingle();
  if (!p) redirect("/parts");
  const question = blankToNull(formData.get("question")) ?? "Is this the right part?";
  await admin.from("part_items").update({ question_text: question.slice(0, 300), question_at: new Date().toISOString(), question_by: staff.id, answer_text: null, answered_at: null, answered_by: null, updated_by: staff.id }).eq("id", partId);
  const job = await jobOf(p.job_id);
  await notifyManagers(job?.department ?? null, { type: "parts_question", title: `Parts ask about a part · ${job?.job_number ?? ""}`, body: `${p.description}: ${question}`, jobId: p.job_id, href: `/parts/question/${partId}` });
  refresh(p.job_id);
  redirect(`/parts/${p.job_id}?message=${encodeURIComponent("Sent to the workshop manager. Carry on; his answer will show here.")}`);
}

/** The workshop manager's one-tap answer. */
export async function answerQuestion(partId: string, formData: FormData) {
  const staff = await requirePermission("manageWork");
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, description, question_by").eq("id", partId).maybeSingle();
  if (!p) redirect("/home");
  const answer = String(formData.get("answer") ?? "");
  const note = blankToNull(formData.get("note"));
  if (answer !== "yes" && answer !== "no") redirect(`/parts/question/${partId}?error=${encodeURIComponent("Tap Yes or No.")}`);
  const text = `${answer === "yes" ? "Yes" : "No"}${note ? `: ${note}` : ""}`;
  await admin.from("part_items").update({ answer_text: text.slice(0, 300), answered_at: new Date().toISOString(), answered_by: staff.id, updated_by: staff.id }).eq("id", partId);
  const job = await jobOf(p.job_id);
  await notifyStaff(p.question_by ? [p.question_by] : [], { type: "parts_answer", title: `${staff.display_name} answered · ${job?.job_number ?? ""}`, body: `${p.description}: ${text}`, jobId: p.job_id, href: `/parts/${p.job_id}` });
  if (!p.question_by) await notifyRoles(["parts"], { type: "parts_answer", title: `${staff.display_name} answered · ${job?.job_number ?? ""}`, body: `${p.description}: ${text}`, jobId: p.job_id, href: `/parts/${p.job_id}` });
  refresh(p.job_id);
  redirect(`/parts/question/${partId}?message=${encodeURIComponent("Answer sent to Parts.")}`);
}

/** One tap: this request is already covered by another one (the same part asked under two items). */
export async function coverRequest(requestId: string) {
  const staff = await requirePermission("priceParts");
  const admin = createAdminClient();
  const { data: r } = await admin.from("part_requests").select("id, job_id, label").eq("id", requestId).maybeSingle();
  if (!r) redirect("/parts");
  await admin.from("part_requests").update({ status: "rejected", closed_reason: "Already covered in another request", updated_by: staff.id }).eq("id", requestId);
  await admin.from("job_events").insert({ job_id: r.job_id, event_type: "parts_request_closed", note: `${r.label}: already covered in another request (${staff.display_name})`, created_by: staff.id });
  await tellAdvisorIfComplete(r.job_id);
  refresh(r.job_id);
  redirect(`/parts/${r.job_id}?message=${encodeURIComponent(`${r.label}: marked as covered elsewhere.`)}`);
}

/** Parts close a request they cannot source, with a note. */
export async function closePartRequest(requestId: string, formData: FormData) {
  const staff = await requirePermission("priceParts");
  const note = blankToNull(formData.get("note"));
  const admin = createAdminClient();
  const { data: r } = await admin.from("part_requests").select("id, job_id, label").eq("id", requestId).maybeSingle();
  if (!r) redirect("/parts");
  if (!note || note.length < 3) redirect(`/parts/${r.job_id}?error=${encodeURIComponent("Say why the request is closed.")}`);
  await admin.from("part_requests").update({ status: "rejected", closed_reason: note, updated_by: staff.id }).eq("id", requestId);
  await admin.from("job_events").insert({ job_id: r.job_id, event_type: "parts_request_closed", note: `${r.label}: closed by ${staff.display_name}: ${note}`, created_by: staff.id });
  await tellAdvisorIfComplete(r.job_id);
  refresh(r.job_id);
  redirect(`/parts/${r.job_id}?message=${encodeURIComponent("Request closed.")}`);
}

/**
 * "Not available": Parts cannot get this part at all. The request closes with the note, the advisor
 * is told at once, and the quotation shows it in amber so the customer can be offered something else.
 */
export async function markRequestUnavailable(requestId: string, formData: FormData) {
  const staff = await requirePermission("priceParts");
  const note = blankToNull(formData.get("note"));
  const admin = createAdminClient();
  const { data: r } = await admin.from("part_requests").select("id, job_id, label").eq("id", requestId).maybeSingle();
  if (!r) redirect("/parts");
  const { error } = await admin.from("part_requests").update({ status: "unavailable", closed_reason: note ?? "Not available", updated_by: staff.id }).eq("id", requestId);
  if (error) redirect(`/parts/${r.job_id}?error=${encodeURIComponent(error.message)}`);
  await admin.from("job_events").insert({ job_id: r.job_id, event_type: "parts_unavailable", note: `${r.label}: not available (${staff.display_name})${note ? `: ${note}` : ""}`, created_by: staff.id });
  const job = await jobOf(r.job_id);
  if (job) {
    const { data: appr } = await admin.from("approval_requests").select("sent_by").eq("job_id", r.job_id);
    const ids = Array.from(new Set([job.gated_in_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
    await notifyStaff(ids, { type: "parts_priced", title: `Part not available · ${job.job_number}`, body: `${r.label}: not available${note ? ` (${note})` : ""}. Offer the customer another way or leave it off the quotation.`, jobId: r.job_id, href: `/jobs/${r.job_id}` });
  }
  await tellAdvisorIfComplete(r.job_id);
  refresh(r.job_id);
  redirect(`/parts/${r.job_id}?message=${encodeURIComponent("Marked not available. The advisor has been told.")}`);
}

/** Take a part off the job (wrong listing). Its quotation line goes with it. */
export async function removePart(partId: string) {
  const staff = await requirePermission("priceParts");
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, description, order_status").eq("id", partId).maybeSingle();
  if (!p) redirect("/parts");
  if (p.order_status !== "none") redirect(`/parts/${p.job_id}?error=${encodeURIComponent("This part is already approved by the customer; it cannot be removed here.")}`);
  await admin.from("part_items").update({ is_active: false, updated_by: staff.id }).eq("id", partId);
  await syncLineForPart(p.job_id, partId, staff.id);
  await admin.from("job_events").insert({ job_id: p.job_id, event_type: "parts_listed", note: `${p.description} removed by ${staff.display_name}`, created_by: staff.id });
  refresh(p.job_id);
  redirect(`/parts/${p.job_id}?message=${encodeURIComponent(`${p.description} removed.`)}`);
}
