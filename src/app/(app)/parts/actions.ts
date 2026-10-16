"use server";

import { isTyreName, tyreSizeIn, type TyreSpec } from "@/lib/tyres";
import { syncPartLine } from "@/lib/quote-versions";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { getCurrentStaff, requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { dubaiDate } from "@/lib/jobs";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { loadPricingRows } from "@/lib/parts-pricing";
import { dateFromDays, daysComplete, rowMissing, rowState } from "@/lib/parts-rows";
import { PARTS_BUCKET, PART_SELECT, toPart } from "@/lib/quote-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

function refresh(jobId: string) {
  revalidatePath("/parts");
  revalidatePath(`/parts/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath("/dashboard");
}

async function jobOf(jobId: string) {
  const { data } = await createAdminClient().from("jobs").select("id, job_number, department, assigned_to, gated_in_by, is_open, vehicle_id, parts_pricing_done_at, parts_pricing_reopened_at").eq("id", jobId).maybeSingle();
  return data;
}

/** The job's open quotation (draft), if any: callers that only want to know whether one exists. */
async function draftQuotation(jobId: string) {
  const { data } = await createAdminClient().from("quotations").select("id").eq("job_id", jobId).eq("is_active", true).in("status", ["draft", "pending_owner"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? null;
}

/**
 * The part's line on the quotation (src/lib/quote-versions.ts): the open draft, or the next version when the latest one
 * was already sent or approved, with the advisor told to send it. Parts never think about versions.
 */
export async function syncLineForPart(jobId: string, partId: string, by: string) {
  await syncPartLine(jobId, partId, by);
}

/** When every request on the job is answered and every part has a price, the advisor hears about it. */
/** Every row Priced or Not available (the one state function in src/lib/parts-rows.ts): the advisor is told with the breakdown. */
async function tellAdvisorIfComplete(jobId: string) {
  const admin = createAdminClient();
  const [{ summary }, job] = await Promise.all([loadPricingRows(jobId), jobOf(jobId)]);
  if (summary.open || !summary.total || !job) return;
  const { data: appr } = await admin.from("approval_requests").select("sent_by").eq("job_id", jobId);
  const ids = [job.gated_in_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x);
  await notifyStaff(ids, { type: "parts_priced", title: `Parts priced · ${job.job_number}`, body: `Every part on this car is priced or marked not available (${summary.text}). Finish the quotation.`, jobId, href: `/jobs/${jobId}` });
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
  if (requestId) {
    const { data: req } = await admin.from("part_requests").select("positions").eq("id", requestId).maybeSingle();
    if (req?.positions?.length) for (const r of rows) r.positions = req.positions;
  }
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


/* ---------------------------------------------------------------------------
   Evening of 11 October 2026: the Parts table saves itself row by row.
   --------------------------------------------------------------------------- */

export type RowSave = { /** The tyre details when the row is a tyre (brand, model, size, year, marks). */ tyre?: TyreSpec | null; requestId: string | null; partId: string | null; optionOf?: string | null; /** The row's key on the screen: a save that races an earlier one finds the part it made. */ clientKey?: string | null; name?: string | null; part_number?: string; part_type?: string; brand?: string; list_price?: string; discount?: string; cost_aed?: string; supplier?: string; availability?: string; days?: string; quantity?: string | number; /** A part added by Parts from the picker: its positions ("Front left", "Rear pair"...). */ positions?: string[] };

/**
 * A custom part name typed by Parts (not in the owner's pool) is counted, so names used more than once are
 * offered to the owner in Settings > Parts list, exactly like the technician's custom parts.
 */
export async function noteCustomPartNames(names: string[]): Promise<void> {
  const staff = await getCurrentStaff();
  if (!staff || !names.length) return;
  const settings = await getSettings();
  const pool = { ...((settings.part_pool_custom ?? {}) as Record<string, number>) };
  for (const raw of names) {
    const name = raw.trim().slice(0, 120);
    if (!name) continue;
    pool[name] = (Number(pool[name]) || 0) + 1;
  }
  await createAdminClient().from("settings").upsert({ key: "part_pool_custom", value: pool, label: "Custom parts used", description: "Custom part names typed by staff, with counts, offered to the owner to add to the pool." }, { onConflict: "key" });
}

const numOrNull = (v: string | number | undefined | null) => {
  if (v === undefined || v === null) return null;
  const t = String(v).replace(",", ".").replace(/[^\d.]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** The job's advisors: the one who gated the car in and anyone who sent an approval for it. */
async function jobAdvisorIds(jobId: string, gatedInBy: string | null) {
  const { data: appr } = await createAdminClient().from("approval_requests").select("sent_by").eq("job_id", jobId);
  return Array.from(new Set([gatedInBy, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
}

/** A part changed after the quotation went out (price, quantity or name): the quotation is flagged and the advisor told. */
async function flagSentQuotations(jobId: string, job: { job_number: string; gated_in_by: string | null }, what: string, by: { id: string; display_name: string }) {
  const admin = createAdminClient();
  const { data: sentQs } = await admin.from("quotations").select("id, number").eq("job_id", jobId).eq("is_active", true).in("status", ["sent", "opened", "approved", "urgent_requested", "pending_owner"]);
  if (!(sentQs ?? []).length) return;
  await admin.from("quotations").update({ parts_price_changed_at: new Date().toISOString() }).in("id", (sentQs ?? []).map((q) => q.id));
  await notifyStaff(await jobAdvisorIds(jobId, job.gated_in_by), { type: "parts_priced", title: `Part changed after the quotation went out · ${job.job_number}`, body: `${what}. Check ${(sentQs ?? []).map((q) => q.number).join(", ")}.`, jobId, href: `/jobs/${jobId}` });
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_price_changed", note: `${what} by ${by.display_name} after the quotation was sent`, created_by: by.id });
}

/**
 * One row of the Parts table as it is filled in: the first save of a request's row makes its part item, every
 * later save updates it. Parts enter the list price; the supplier's discount gives the net cost (the cost used
 * for markup, quotations and profit). A row is complete with a type, a net cost, a supplier and the availability
 * (days when to order); a complete row goes on the quotation and the request closes. Parts can correct the name
 * (the technician's words stay on the row) and the quantity (noted, the advisor and the manager told); any change
 * after the quotation went out flags it and tells the advisor.
 */
export async function autoSavePartRow(jobId: string, row: RowSave): Promise<{ error?: string; partId?: string; complete?: boolean; waitingApproval?: boolean }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "Please sign in again." };
  const role = staff.role_id as RoleId;
  if (!can(role, "priceParts")) return { error: "Not allowed." };
  const job = await jobOf(jobId);
  if (!job || !job.is_open) return { error: "This job is closed." };
  const admin = createAdminClient();
  const settings = await getSettings();
  const allowed = ((settings.part_types ?? []) as string[]).map((t) => t.toLowerCase());
  const typeRaw = (row.part_type ?? "").toLowerCase();
  const type = typeRaw && (allowed.includes(typeRaw) || PART_TYPES.includes(typeRaw)) ? typeRaw : null;
  const cost = numOrNull(row.cost_aed);
  if (cost !== null && cost < 0) return { error: "The cost must be a number." };
  const list = numOrNull(row.list_price);
  // A discount can never exceed 100%.
  const discountRaw = numOrNull(row.discount);
  const discount = discountRaw === null ? null : Math.min(100, Math.max(0, discountRaw));
  const qty = numOrNull(row.quantity);
  if (qty !== null && qty <= 0) return { error: "The quantity must be above zero." };
  const supplier = (row.supplier ?? "").trim().slice(0, 120) || null;
  const availability = row.availability === "to_order" ? "to_order" : row.availability === "in_stock" ? "in_stock" : null;
  // Whole days from today in Dubai: "0" is Same day (ordered today, here today), "1" Next day.
  const daysText = String(row.days ?? "").trim();
  const delivery = availability === "to_order" && daysComplete(daysText) ? dateFromDays(daysText, dubaiDate()) : null;
  const fields = { part_number: (row.part_number ?? "").trim().slice(0, 80) || null, part_type: type, brand: type && type !== "genuine" ? (row.brand ?? "").trim().slice(0, 80) || null : null, list_price_aed: list, discount_percent: discount === null ? null : Math.min(100, Math.max(0, discount)), cost_aed: cost, supplier, availability, delivery_date: delivery };
  // Priced means the same here as on the screen: part number, type, net above 0, supplier, availability (src/lib/parts-rows.ts).
  const tyreRow = isTyreName(row.name) || !!row.tyre;
  const complete = rowState({ part_number: (row.part_number ?? "").trim(), part_type: type ?? "", brand: "", list_price: "", discount: "", cost_aed: cost === null ? "" : String(cost), supplier: supplier ?? "", availability: availability ?? "", days: delivery ? daysText : "", qty: "1", ...(tyreRow ? { tyre_row: true, tyre_brand: row.tyre?.brand ?? (row.brand ?? ""), tyre_size: row.tyre?.size ?? tyreSizeIn(row.name) } : {}) }) === "priced";
  const now = new Date().toISOString();
  let partId = row.partId;
  const clientKey = row.clientKey ? String(row.clientKey).slice(0, 80) : null;
  if (!partId && clientKey) {
    // The same row saved twice in quick succession: the second save finds the part the first one made.
    const { data: same } = await admin.from("part_items").select("id").eq("job_id", jobId).eq("client_key", clientKey).eq("is_active", true).order("created_at").limit(1).maybeSingle();
    if (same) partId = same.id;
  }
  // A supplier discount above the owner's limit waits for his one-tap approval; until then the part is not priced.
  const approvalLimit = Number(settings.supplier_discount_approval_above_percent ?? 70);
  const needsApproval = discount !== null && discount > approvalLimit;
  const { data: prev } = partId ? await admin.from("part_items").select("discount_percent, discount_approval_status").eq("id", partId).maybeSingle() : { data: null };
  const prevDiscount = prev?.discount_percent === null || prev?.discount_percent === undefined ? null : Number(prev.discount_percent);
  let approvalStatus: string | null = (prev?.discount_approval_status as string | null | undefined) ?? null;
  let askOwner = false;
  if (!needsApproval) approvalStatus = null;
  else if ((approvalStatus === "approved" || approvalStatus === "pending") && prevDiscount === discount) {
    // Already decided, or already asked, for this very discount.
  } else {
    approvalStatus = "pending";
    askOwner = true;
  }
  const approval = { discount_approval_status: approvalStatus };
  const completeNow = complete && approvalStatus !== "pending";
  let previousCost: number | null = null;
  let description = (row.name ?? "").trim().slice(0, 200);
  let requestId = row.requestId;
  const changes: string[] = [];
  let qtyChange: { from: number; to: number } | null = null;
  if (partId) {
    const { data: cur } = await admin.from("part_items").select("id, cost_aed, description, original_description, part_request_id, quantity, confirmed_quantity").eq("id", partId).eq("job_id", jobId).maybeSingle();
    if (!cur) return { error: "Part not found." };
    previousCost = cur.cost_aed === null ? null : Number(cur.cost_aed);
    const patch: Record<string, unknown> = { ...fields, ...approval, ...(completeNow ? { priced_by: staff.id, priced_at: now } : {}), updated_by: staff.id };
    // The name corrected by Parts: the technician's words stay on the row and are used nowhere else.
    if (description && description !== cur.description) {
      patch.description = description;
      patch.original_description = cur.original_description ?? cur.description;
      changes.push(`${cur.description} renamed to ${description}`);
    } else description = cur.description;
    const curQty = Number(cur.confirmed_quantity ?? cur.quantity) || 1;
    if (qty !== null && Math.abs(qty - curQty) > 0.001) {
      patch.confirmed_quantity = qty;
      patch.quantity_changed_at = now;
      patch.quantity_changed_by = staff.id;
      qtyChange = { from: Number(cur.quantity) || curQty, to: qty };
      changes.push(`${description}: quantity ${curQty} → ${qty}`);
    }
    requestId = cur.part_request_id ?? requestId;
    const { error } = await admin.from("part_items").update(patch).eq("id", partId);
    if (error) return { error: error.message };
  } else {
    let quantity = qty ?? 1;
    let positions: string[] = [];
    let optionGroup: string | null = null;
    if (row.optionOf) {
      const { data: base } = await admin.from("part_items").select("id, part_request_id, option_group, description, quantity, confirmed_quantity, positions").eq("id", row.optionOf).maybeSingle();
      if (!base) return { error: "Part not found." };
      optionGroup = base.option_group ?? base.id;
      if (!base.option_group) await admin.from("part_items").update({ option_group: optionGroup, updated_by: staff.id }).eq("id", base.id);
      description = description || base.description;
      quantity = qty ?? (Number(base.confirmed_quantity ?? base.quantity) || 1);
      positions = (base.positions as string[] | null) ?? [];
      requestId = base.part_request_id;
    } else if (requestId) {
      const { data: req } = await admin.from("part_requests").select("label, quantity, positions").eq("id", requestId).maybeSingle();
      if (!req) return { error: "Request not found." };
      description = description || req.label;
      quantity = qty ?? (Number(req.quantity) || 1);
      positions = (req.positions as string[] | null) ?? [];
      if (req.label && description !== req.label) changes.push(`${req.label} renamed to ${description}`);
      if (Math.abs(quantity - (Number(req.quantity) || 1)) > 0.001) qtyChange = { from: Number(req.quantity) || 1, to: quantity };
    }
    if (!description) return { error: "Type the part name." };
    // A part added by Parts from the picker brings its positions along.
    if (!row.optionOf && !requestId && Array.isArray(row.positions)) positions = row.positions.map((p) => String(p).slice(0, 40)).filter(Boolean).slice(0, 8);
    const { data: req2 } = requestId ? await admin.from("part_requests").select("label, quantity").eq("id", requestId).maybeSingle() : { data: null };
    const { data: created, error } = await admin
      .from("part_items")
      .insert({ job_id: jobId, client_key: clientKey, part_request_id: requestId, description, original_description: req2?.label && req2.label !== description ? req2.label : null, quantity: req2 ? Number(req2.quantity) || quantity : quantity, confirmed_quantity: quantity, positions, option_group: optionGroup, ...fields, ...approval, ...(qtyChange ? { quantity_changed_at: now, quantity_changed_by: staff.id } : {}), confirm_status: "confirmed", confirmed_by: staff.id, confirmed_at: now, ...(complete ? { priced_by: staff.id, priced_at: now } : {}), added_by_role: role, created_by: staff.id, updated_by: staff.id })
      .select("id")
      .single();
    if (error || !created) return { error: error?.message ?? "Could not save the part." };
    partId = created.id;
    if (optionGroup && row.optionOf) {
      const quotationId = await draftQuotation(jobId);
      if (quotationId) await admin.from("quotation_lines").update({ option_group: optionGroup, updated_by: staff.id }).eq("quotation_id", quotationId).eq("part_item_id", row.optionOf);
    }
  }
  if (requestId) await admin.from("part_requests").update({ status: completeNow ? "done" : "listed", updated_by: staff.id }).eq("id", requestId).in("status", ["open", "listed", "done"]);
  if (completeNow && partId) {
    await syncLineForPart(jobId, partId, staff.id);
    await tellAdvisorIfComplete(jobId);
  }
  // The tyre details: stored with the part; a new brand or model is remembered for next time.
  if (row.tyre && partId) {
    await admin.from("part_items").update({ tyre_spec: row.tyre, brand: row.tyre.brand || null, updated_by: staff.id }).eq("id", partId);
    await learnTyre(row.tyre, settings);
  }
  if (previousCost !== null && cost !== null && cost !== previousCost) changes.push(`${description}: price AED ${previousCost} → AED ${cost}`);
  if (qtyChange) {
    const n = { type: "parts_priced", title: `Parts changed a quantity · ${job.job_number}`, body: `${description}: the technician asked for ${qtyChange.from}, Parts changed it to ${qtyChange.to}.`, jobId, href: `/parts/${jobId}` };
    await notifyStaff(await jobAdvisorIds(jobId, job.gated_in_by), { ...n, href: `/jobs/${jobId}` });
    await notifyManagers(job.department ?? null, n);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_quantity", note: `${description}: quantity changed from ${qtyChange.from} to ${qtyChange.to} by ${staff.display_name}`, created_by: staff.id });
  }
  if (changes.length) await flagSentQuotations(jobId, job, changes.join("; "), staff);
  if (askOwner && partId) {
    await notifyRoles(["owner"], { type: "owner_approval_needed", title: `Supplier discount ${discount}% needs your approval · ${job.job_number}`, body: `${description}: list AED ${list ?? "?"}, ${discount}% from ${supplier ?? "no supplier"}, net AED ${cost ?? "?"}. Approve or refuse with one tap.`, jobId, href: "/parts/approvals" });
    await admin.from("job_events").insert({ job_id: jobId, event_type: "discount_approval", note: `${description}: ${discount}% discount from ${supplier ?? "?"} waits for the owner's approval (${staff.display_name})`, created_by: staff.id });
  }
  refresh(jobId);
  return { partId: partId ?? undefined, complete: completeNow, waitingApproval: approvalStatus === "pending" };
}

/**
 * "Split into separate parts": one bundled row ("Radiator + pipes + hoses × 1") becomes several, each with its
 * own name and quantity, priced on its own. The first keeps the row; the others are new rows on the same request.
 */
export async function splitPart(jobId: string, partId: string, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const staff = await requirePermission("priceParts");
  const admin = createAdminClient();
  const job = await jobOf(jobId);
  if (!job || !job.is_open) return { error: "This job is closed." };
  let lines: { name: string; qty: number }[] = [];
  try {
    lines = (JSON.parse(String(formData.get("lines") ?? "[]")) as { name?: unknown; qty?: unknown }[]).map((l) => ({ name: String(l.name ?? "").trim().slice(0, 200), qty: Math.max(0.01, Number(l.qty) || 1) })).filter((l) => l.name);
  } catch {
    return { error: "Could not read the lines." };
  }
  if (lines.length < 2) return { error: "Give at least two parts to split into." };
  const { data: raw } = await admin.from("part_items").select(PART_SELECT).eq("id", partId).eq("job_id", jobId).eq("is_active", true).maybeSingle();
  if (!raw) return { error: "Part not found." };
  const p = toPart(raw as Record<string, unknown>);
  if (p.order_status !== "none") return { error: "This part is already on order; it cannot be split now." };
  const now = new Date().toISOString();
  const [first, ...rest] = lines;
  const original = p.original_description ?? p.description;
  await admin.from("part_items").update({ description: first.name, original_description: first.name !== original ? original : p.original_description ?? null, confirmed_quantity: first.qty, ...(Math.abs(first.qty - (Number(p.confirmed_quantity ?? p.quantity) || 1)) > 0.001 ? { quantity_changed_at: now, quantity_changed_by: staff.id } : {}), updated_by: staff.id }).eq("id", partId);
  for (const r of rest) {
    await admin.from("part_items").insert({ job_id: jobId, part_request_id: p.part_request_id, description: r.name, original_description: original, quantity: r.qty, confirmed_quantity: r.qty, positions: p.positions ?? null, part_type: p.part_type, brand: p.brand, supplier: p.supplier, confirm_status: "confirmed", confirmed_by: staff.id, confirmed_at: now, added_by_role: staff.role_id, created_by: staff.id, updated_by: staff.id });
  }
  if (p.part_request_id) await admin.from("part_requests").update({ status: "listed", updated_by: staff.id }).eq("id", p.part_request_id).in("status", ["open", "listed", "done"]);
  if (p.cost_aed !== null) await syncLineForPart(jobId, partId, staff.id);
  const what = `${original} split into ${lines.map((l) => `${l.name} × ${l.qty}`).join(", ")}`;
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_split", note: `${what} (${staff.display_name})`, created_by: staff.id });
  const n = { type: "parts_priced", title: `Parts split a bundled part · ${job.job_number}`, body: `${what}. The new parts are priced on their own.`, jobId, href: `/parts/${jobId}` };
  await notifyStaff(await jobAdvisorIds(jobId, job.gated_in_by), { ...n, href: `/jobs/${jobId}` });
  await notifyManagers(job.department ?? null, n);
  await flagSentQuotations(jobId, job, what, staff);
  refresh(jobId);
  return { ok: true };
}

/** "+ Add a supplier" at the bottom of the supplier list on a row: the name only; the owner or accounts set its discount. */
export async function addSupplierQuick(name: string): Promise<{ error?: string; supplier?: { id: string; name: string; discount: number; byType: Record<string, number> } }> {
  const staff = await requirePermission("priceParts");
  const clean = name.trim().slice(0, 120);
  if (clean.length < 2) return { error: "Type the supplier's name." };
  const admin = createAdminClient();
  const { data: same } = await admin.from("suppliers").select("id, name, is_active, default_discount_percent, discount_by_type").ilike("name", clean).maybeSingle();
  if (same) {
    if (!same.is_active) await admin.from("suppliers").update({ is_active: true, updated_by: staff.id }).eq("id", same.id);
    return { supplier: { id: same.id, name: same.name, discount: Number(same.default_discount_percent) || 0, byType: (same.discount_by_type as Record<string, number> | null) ?? {} } };
  }
  const { data: created, error } = await admin.from("suppliers").insert({ name: clean, created_by: staff.id, updated_by: staff.id }).select("id, name").single();
  if (error || !created) return { error: error?.message ?? "Could not add the supplier." };
  revalidatePath("/parts/suppliers");
  return { supplier: { id: created.id, name: created.name, discount: 0, byType: {} } };
}

/** "Pricing done": the advisor is told and the next step is his, even if some parts have no price yet (he was asked first). */
export async function pricingDone(jobId: string, formData: FormData) {
  const staff = await requirePermission("priceParts");
  const admin = createAdminClient();
  const job = await jobOf(jobId);
  if (!job || !job.is_open) redirect(`/parts/${jobId}?error=${encodeURIComponent("This job is closed.")}`);
  // The same rows and the same state function as the table on the screen (src/lib/parts-pricing.ts): Priced, Not
  // available and Removed never hold anything; only Not finished and Waiting for owner approval do.
  const { rows, summary } = await loadPricingRows(jobId);
  const open = summary.open;
  const first = rows.find((r) => r.state === "not_finished");
  const firstText = first ? `${first.name}: ${rowMissing(first.values).map((m) => m.long).join(", ") || "not finished"}` : null;
  if (open && String(formData.get("force") ?? "") !== "1") redirect(`/parts/${jobId}?error=${encodeURIComponent(`${open} part${open === 1 ? " is" : "s are"} not finished${firstText ? ` (${firstText})` : ""}. Finish them, or choose Send what you have.`)}`);
  const now = new Date().toISOString();
  // "Send updated prices": Edit was pressed after Pricing done; the advisor hears that the prices changed on this car.
  const reopened = !!job.parts_pricing_reopened_at;
  await admin.from("jobs").update({ parts_pricing_done_at: now, parts_pricing_done_by: staff.id, parts_pricing_reopened_at: null, parts_pricing_reopened_by: null, updated_by: staff.id }).eq("id", jobId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_pricing_done", note: `${reopened ? "Updated prices sent" : "Pricing done"} by ${staff.display_name} (${summary.text})`, created_by: staff.id });
  const { data: appr } = await admin.from("approval_requests").select("sent_by").eq("job_id", jobId);
  const ids = Array.from(new Set([job.gated_in_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x)));
  if (reopened) {
    const { data: jv } = await admin.from("jobs").select("vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, make:vehicle_makes(name), model:vehicle_models(name))").eq("id", jobId).maybeSingle();
    const veh = (jv?.vehicle as unknown as (Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null }) | null) ?? null;
    const car = veh ? `${formatPlate(veh)} ${[veh.make?.name, veh.model?.name].filter(Boolean).join(" ")}`.trim() : job.job_number;
    const { data: sentQs } = await admin.from("quotations").select("number").eq("job_id", jobId).eq("is_active", true).in("status", ["sent", "opened", "approved", "urgent_requested", "pending_owner"]);
    const sent = (sentQs ?? []).map((q) => q.number);
    await notifyStaff(ids, { type: "parts_priced", title: `Prices changed on ${car}`, body: `${staff.display_name} sent updated prices (${summary.text}).${sent.length ? ` ${sent.join(", ")} was already sent to the customer: check it and send a revised version if needed.` : " Check the quotation."}`, jobId, href: `/jobs/${jobId}` });
  } else {
    await notifyStaff(ids, { type: "parts_priced", title: `Parts pricing done · ${job.job_number}`, body: open ? `${staff.display_name} sent what Parts have: ${summary.text}. The quotation is yours.` : `Every part is priced or marked not available (${summary.text}). Finish the quotation.`, jobId, href: `/jobs/${jobId}` });
  }
  refresh(jobId);
  revalidatePath(`/jobs/${jobId}/quote`, "layout");
  redirect(`/parts/${jobId}?message=${encodeURIComponent(reopened ? "Updated prices sent to the advisor." : "Sent to the advisor.")}`);
}

/** "Edit" after Pricing done: the rows open again; the bar then offers "Send updated prices". A quotation already sent is pointed out. */
export async function reopenPricing(jobId: string) {
  const staff = await requirePermission("priceParts");
  const admin = createAdminClient();
  const job = await jobOf(jobId);
  if (!job || !job.is_open) redirect(`/parts/${jobId}?error=${encodeURIComponent("This job is closed.")}`);
  await admin.from("jobs").update({ parts_pricing_reopened_at: new Date().toISOString(), parts_pricing_reopened_by: staff.id, updated_by: staff.id }).eq("id", jobId);
  const { data: sentQs } = await admin.from("quotations").select("number").eq("job_id", jobId).eq("is_active", true).in("status", ["sent", "opened", "approved", "urgent_requested", "pending_owner"]);
  const sent = (sentQs ?? []).map((q) => q.number);
  refresh(jobId);
  redirect(`/parts/${jobId}?message=${encodeURIComponent(sent.length ? `Editing. ${sent.join(", ")} was already sent to the customer: every change flags it and the advisor is told. Press Send updated prices when done.` : "Editing. Press Send updated prices when done.")}`);
}

/** A catalogue diagram on a priced part, from the row's menu. */
export async function attachDiagram(partId: string, formData: FormData) {
  const staff = await requirePermission("priceParts");
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id").eq("id", partId).maybeSingle();
  if (!p) redirect("/parts");
  const file = formData.get("diagram");
  if (!(file instanceof File) || file.size === 0) redirect(`/parts/${p.job_id}?error=${encodeURIComponent("Choose a file.")}`);
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) redirect(`/parts/${p.job_id}?error=${encodeURIComponent("The diagram must be a JPG, PNG, WebP or PDF.")}`);
  if (file.size > 20 * 1024 * 1024) redirect(`/parts/${p.job_id}?error=${encodeURIComponent("The diagram must be under 20 MB.")}`);
  const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${p.job_id}/${Date.now()}-${randomBytes(3).toString("hex")}.${ext}`;
  const { error: upError } = await admin.storage.from(PARTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upError) redirect(`/parts/${p.job_id}?error=${encodeURIComponent("Diagram upload failed: " + upError.message)}`);
  await admin.from("part_items").update({ diagram_path: path, updated_by: staff.id }).eq("id", partId);
  refresh(p.job_id);
  redirect(`/parts/${p.job_id}?message=${encodeURIComponent("Diagram attached.")}`);
}

/** A tyre brand or model typed in the tyre details window joins the Settings lists (tyre_brand_custom, tyre_models). */
async function learnTyre(t: TyreSpec, settings: Awaited<ReturnType<typeof getSettings>>) {
  const admin = createAdminClient();
  const brand = t.brand.trim();
  const model = t.model.trim();
  if (!brand) return;
  const brands = ((settings.tyre_brands ?? []) as string[]).map((b) => b.toLowerCase());
  if (!brands.includes(brand.toLowerCase())) {
    const custom = { ...((settings.tyre_brand_custom ?? {}) as Record<string, number>) };
    custom[brand] = (Number(custom[brand]) || 0) + 1;
    await admin.from("settings").upsert({ key: "tyre_brand_custom", value: custom, label: "Tyre brands typed", description: "Tyre brands typed by hand, counted; offered on the Inspection checklist page." }, { onConflict: "key" });
  }
  if (model) {
    const models = { ...((settings.tyre_models ?? {}) as Record<string, string[]>) };
    const key = Object.keys(models).find((k) => k.toLowerCase() === brand.toLowerCase()) ?? brand;
    const list = models[key] ?? [];
    if (!list.some((m) => m.toLowerCase() === model.toLowerCase())) models[key] = [...list, model].slice(0, 60);
    await admin.from("settings").upsert({ key: "tyre_models", value: models, label: "Tyre models", description: "Tyre models per brand, offered as one-tap choices in the tyre details window; a model typed there is added by itself." }, { onConflict: "key" });
  }
}
