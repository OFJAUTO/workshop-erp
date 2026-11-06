"use server";
import { dbWords, dbDetail } from "@/lib/app-errors";

import { isTyreName, tyreSizeIn, type TyreSpec } from "@/lib/tyres";
import { endingOf } from "@/lib/part-endings";
import { jobAdvisorIds as advisorsInCharge } from "@/lib/notifications";
import { syncPartLine } from "@/lib/quote-versions";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { getCurrentStaff, requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { dubaiDate } from "@/lib/jobs";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { holdForSend, reopenPricingFor } from "@/lib/parts-pricing";
import { sendJobPricing } from "@/lib/pricing-send";
import { NO_PART_NUMBER, OUR_STOCK, cleanPartNumber, dateFromDays, daysComplete, isOurStock, isPlaceholderSupplier, partNumberProblem, placeholderSupplierWords, realPartNumber, rowState, type RowValues } from "@/lib/parts-rows";
import { costCheckValues, costChecksFor, forgetBoughtPrices, type PartForCheck } from "@/lib/part-cost-history";
import { isSettledStatus } from "@/lib/part-cost-check";
import { advisorPricePartsReady, costConfirmReady, partUnitsReady } from "@/lib/schema-ready";
import { checkQuantity, cleanUnit, defaultUnitFor, requestUnitOf, type PartUnit } from "@/lib/part-units";
import { askerOfPart, logPartQuantity } from "@/lib/part-quantity";
import { holdPerPartNotices } from "@/lib/pricing-done";
import { compactPartNumber } from "@/lib/price-import";
import { receiveFromShelf, recordStockMovement } from "@/lib/stock";
import { round2 } from "@/lib/money";
import { addPartsToOpenLpo, refreshPendingLpoLine, refusalsReady } from "@/lib/lpo";
import { PARTS_BUCKET, PART_SELECT, toPart } from "@/lib/quote-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { LINE_TEXT_MAX, lineTextOrError, tooLongWords } from "@/lib/text-limits";

function refresh(jobId: string) {
  revalidatePath("/parts");
  revalidatePath(`/parts/${jobId}`);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/my-jobs/${jobId}`);
  revalidatePath("/dashboard");
}

async function jobOf(jobId: string) {
  const { data } = await createAdminClient().from("jobs").select("id, job_number, status, department, assigned_to, gated_in_by, is_open, vehicle_id, parts_pricing_done_at, parts_pricing_reopened_at").eq("id", jobId).maybeSingle();
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
export async function syncLineForPart(jobId: string, partId: string, by: string, opts: { quiet?: boolean; /** Fix 2.5: a parts-desk delete never asks for a revision on an approved quotation. */ partsDelete?: boolean } = {}): Promise<{ keptApproved?: boolean }> {
  const r = await syncPartLine(jobId, partId, by, undefined, { quietRevision: opts.quiet, partsDelete: opts.partsDelete });
  return { keptApproved: r.keptApproved };
}

/*
 * Section 10 (3 November 2026): the advisor is no longer told "Parts priced" after every save of a priced row (J-00016
 * got 94 of them during three imports). He hears it ONCE, when Parts press "Pricing done – send to advisor" (pricingDone
 * below), with what changed folded in. While a send is expected the per-part notices to him wait (holdForSend in
 * src/lib/parts-pricing.ts), and the car stays on the parts desk's list until it is pressed.
 */

const PART_TYPES = ["genuine", "oem", "aftermarket", "used"];

/** One row from the Parts form: part number, description, quantity, type, brand, cost, supplier, availability. */
function readRow(formData: FormData, i: number, prefix = ""): { error?: string; row?: Record<string, unknown> } {
  const g = (k: string) => String(formData.getAll(`${prefix}${k}`)[i] ?? "").trim();
  const d = lineTextOrError(g("description"));
  if (d.error !== null) return { error: d.error };
  const description = d.text;
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
  const pnProblem = partNumberProblem(g("part_number"));
  if (pnProblem) return { error: `${description}: ${pnProblem}` };
  return {
    row: {
      part_number: cleanPartNumber(g("part_number")),
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
    if (upError) return { error: "Diagram upload failed: " + dbDetail(upError, "parts/actions"), values };
    rows[0].diagram_path = path;
  }
  const { data: created, error } = await admin.from("part_items").insert(rows).select("id");
  if (error || !created) return { error: (error ? dbWords(error, "parts/actions") : "Could not save the parts."), values };
  if (requestId) await admin.from("part_requests").update({ status: "done", updated_by: staff.id }).eq("id", requestId);
  for (const c of created) await syncLineForPart(jobId, c.id, staff.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_listed", note: `${rows.length} part${rows.length === 1 ? "" : "s"} priced by ${staff.display_name}${requestId ? "" : " (added without a request)"}`, created_by: staff.id });
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
  if (error) return { error: dbWords(error, "parts/actions"), values };
  await syncLineForPart(p.job_id, partId, staff.id);
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
  if (error || !created) return { error: (error ? dbWords(error, "parts/actions") : "Could not add the option."), values };
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
  if (error) redirect(`/parts/${r.job_id}?error=${encodeURIComponent(dbWords(error, "parts/actions"))}`);
  await admin.from("job_events").insert({ job_id: r.job_id, event_type: "parts_unavailable", note: `${r.label}: not available (${staff.display_name})${note ? `: ${note}` : ""}`, created_by: staff.id });
  const job = await jobOf(r.job_id);
  // Held for the send only while one is expected; the car then stays on the parts desk's list until it is pressed.
  const held = job ? await holdForSend(job, staff.id) : false;
  if (job && !held) {
    const ids = await advisorsInCharge(r.job_id);
    await notifyStaff(ids, { type: "parts_priced", title: `Part not available · ${job.job_number}`, body: `${r.label}: not available${note ? ` (${note})` : ""}. Offer the customer another way or leave it off the quotation.`, jobId: r.job_id, href: `/jobs/${r.job_id}` });
  }
  refresh(r.job_id);
  redirect(`/parts/${r.job_id}?message=${encodeURIComponent(held ? "Marked not available. The advisor hears it with Pricing done – send to advisor." : "Marked not available. The advisor has been told.")}`);
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

export type RowSave = { /** The tyre details when the row is a tyre (brand, model, size, year, marks). */ tyre?: TyreSpec | null; requestId: string | null; partId: string | null; optionOf?: string | null; /** The row's key on the screen: a save that races an earlier one finds the part it made. */ clientKey?: string | null; name?: string | null; part_number?: string; part_type?: string; brand?: string; list_price?: string; discount?: string; cost_aed?: string; supplier?: string; availability?: string; days?: string; quantity?: string | number; /** Section 9: pieces ("pc"), litres ("l") or sets ("set"); the cost is per unit. */ unit?: string; /** A part added by Parts from the picker: its positions ("Front left", "Rear pair"...). */ positions?: string[]; /** "From our stock…" (2 November 2026): the stock item; its average cost is the part's cost. null takes it off. */ stockItemId?: string | null; /** "Yes, real price": the cost each on the screen when it was tapped (stored only when it is the cost saved). */ costConfirmed?: number | null };

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
    const name = raw.trim();
    if (!name || name.length > LINE_TEXT_MAX) continue;
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
  void gatedInBy;
  return advisorsInCharge(jobId);
}

/** A part changed after the quotation went out (price, quantity or name): the quotation is flagged and the advisor told. */
async function flagSentQuotations(jobId: string, job: { id: string; job_number: string; gated_in_by: string | null; status: string; parts_pricing_done_at: string | null; parts_pricing_reopened_at: string | null }, what: string, by: { id: string; display_name: string }) {
  const admin = createAdminClient();
  const { data: sentQs } = await admin.from("quotations").select("id, number").eq("job_id", jobId).eq("is_active", true).in("status", ["sent", "opened", "approved", "urgent_requested", "pending_owner"]);
  if (!(sentQs ?? []).length) return;
  await admin.from("quotations").update({ parts_price_changed_at: new Date().toISOString() }).in("id", (sentQs ?? []).map((q) => q.id));
  // Still pricing (Edit after the send): the flag and the history now, the advisor with "Send updated prices".
  if (!(await holdForSend(job, by.id))) await notifyStaff(await jobAdvisorIds(jobId, job.gated_in_by), { type: "parts_priced", title: `Part changed after the quotation went out · ${job.job_number}`, body: `${what}. Check ${(sentQs ?? []).map((q) => q.number).join(", ")}.`, jobId, href: `/jobs/${jobId}` });
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
export async function autoSavePartRow(jobId: string, row: RowSave): Promise<{ error?: string; partId?: string; complete?: boolean; waitingApproval?: boolean; /** What the server worked out for the row (the cost question, the stock item and its cost): the screen takes it in. */ server?: Partial<RowValues> }> {
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
  let cost = numOrNull(row.cost_aed);
  if (cost !== null && cost < 0) return { error: "The cost must be a number." };
  let list = numOrNull(row.list_price);
  // A discount can never exceed 100%.
  const discountRaw = numOrNull(row.discount);
  let discount = discountRaw === null ? null : Math.min(100, Math.max(0, discountRaw));
  const qty = numOrNull(row.quantity);
  if (qty !== null && qty <= 0) return { error: "The quantity must be above zero." };
  const supplier = (row.supplier ?? "").trim().slice(0, 120) || null;
  const fromStock = isOurStock(supplier);
  // A part from our own shelf is in stock and never on an LPO, whatever the screen sent (2 November 2026).
  let availability = fromStock ? "in_stock" : row.availability === "to_order" ? "to_order" : row.availability === "in_stock" ? "in_stock" : null;
  // Whole days from today in Dubai: "0" is Same day (ordered today, here today), "1" Next day.
  const daysText = fromStock ? "" : String(row.days ?? "").trim();
  const delivery = availability === "to_order" && daysComplete(daysText) ? dateFromDays(daysText, dubaiDate()) : null;
  // 1 November 2026: "1", "13" are line numbers, not part numbers (they went onto the supplier's LPO); "OFJ" is not one
  // either (2 November 2026). A new one is refused with words; "None" is the honest answer when there is no number.
  const pnTyped = (row.part_number ?? "").trim();
  const pnProblem = partNumberProblem(pnTyped);
  if (pnProblem) return { error: pnProblem };
  let partNumber = cleanPartNumber(pnTyped);
  let partId = row.partId;
  const clientKey = row.clientKey ? String(row.clientKey).slice(0, 80) : null;
  if (!partId && clientKey) {
    // The same row saved twice in quick succession: the second save finds the part the first one made.
    const { data: same } = await admin.from("part_items").select("id").eq("job_id", jobId).eq("client_key", clientKey).eq("is_active", true).order("created_at").limit(1).maybeSingle();
    if (same) partId = same.id;
  }
  // "From our stock…" (2.3): the stock item's average cost is the part's cost; a typed cost is never used for it.
  const confirmReady = await costConfirmReady();
  const unitsReady = await partUnitsReady();
  const { data: stored } = partId ? await admin.from("part_items").select(`stock_item_id, option_group, supplier, order_status, disposition, disposition_at, return_status${confirmReady ? ", cost_confirmed_aed" : ""}${unitsReady ? ", unit" : ""}`).eq("id", partId).maybeSingle() : { data: null };
  const storedRow = stored as unknown as { stock_item_id: string | null; option_group: string | null; supplier: string | null; order_status: string | null; disposition: string | null; disposition_at: string | null; return_status: string | null; cost_confirmed_aed?: number | string | null; unit?: string | null } | null;
  // A part given its ending (cancelled with the supplier, returned, kept in stock) is off the job: a save from a screen
  // opened before that never changes it again (3 November 2026).
  if (storedRow && endingOf(storedRow)) return { error: "This part was given its ending (not needed): nothing more to change on it." };
  // Section 9 (3 November 2026): the unit typed on the row (pieces, litres, sets) once the database keeps it, and THE
  // quantity check (above zero; pieces and sets whole) against the unit the part will really have: typed, else the
  // saved part's, else for a new part its request's or its name's (review of 3 November 2026: a supplier import of
  // "ENGINE OIL 0W-20 … 6.5" was refused as pieces before the new part's litres were worked out).
  const storedUnit: PartUnit | null = unitsReady ? (cleanUnit(storedRow?.unit) ?? "pc") : null;
  const unitTyped: PartUnit | null = unitsReady ? cleanUnit(row.unit) : null;
  let unitForCheck: PartUnit = unitTyped ?? storedUnit ?? "l";
  if (unitsReady && !unitTyped && !storedRow) {
    if (row.optionOf) {
      const { data: baseUnit } = await admin.from("part_items").select("unit").eq("id", row.optionOf).maybeSingle();
      unitForCheck = cleanUnit((baseUnit as { unit?: string | null } | null)?.unit) ?? defaultUnitFor(String(row.name ?? ""));
    } else if (row.requestId) {
      const { data: reqUnitRow } = await admin.from("part_requests").select("label, unit").eq("id", row.requestId).maybeSingle();
      unitForCheck = requestUnitOf(String(row.name ?? "").trim() || String(reqUnitRow?.label ?? ""), reqUnitRow?.unit);
    } else unitForCheck = defaultUnitFor(String(row.name ?? ""));
  }
  if (qty !== null) {
    const problem = checkQuantity(qty, unitForCheck);
    if (problem) return { error: problem };
  }
  // A new part (a row saved for the first time, an option, a part Parts add) opens a pricing that was sent, or one past
  // the customer's approval, so the car is back on the list and the advisor hears it with the one send.
  if (!partId) {
    const reopenedAt = await reopenPricingFor(jobId, staff.id);
    if (reopenedAt) job.parts_pricing_reopened_at = reopenedAt;
  }
  // A send is expected: the advisor's per-part notices wait for "Pricing done – send to advisor" (section 10).
  const held = holdPerPartNotices(job);
  let stockItemId: string | null = fromStock ? (row.stockItemId === undefined ? (storedRow?.stock_item_id ?? null) : row.stockItemId) : null;
  // A part priced "Our stock" before the rule (no stock item) keeps saving as it was (never unpriced for it; Prices to
  // fix lists it); anything newly set to Our stock comes from a stock item, so its cost is the stock list's (2.3).
  const oldShelfRow = fromStock && !stockItemId && !!storedRow && isOurStock(storedRow.supplier) && !storedRow.stock_item_id;
  if (fromStock && !stockItemId && !oldShelfRow) return { error: "From our stock: pick the stock item (From our stock…), so the cost is the stock list's." };
  let stockWords = "";
  let stockOnHand: number | null = null;
  if (stockItemId) {
    const { data: item } = await admin.from("stock_items").select("id, name, unit, quantity, unit_cost, part_number, is_active").eq("id", stockItemId).maybeSingle();
    if (!item || !item.is_active) return { error: "That stock item is no longer on the stock list. Pick it again (From our stock…)." };
    const itemCost = Number(item.unit_cost) || 0;
    if (!(itemCost > 0)) return { error: `${String(item.name).toUpperCase()} has no cost on the stock list yet: type its cost each when you pick it.` };
    cost = itemCost;
    list = null;
    discount = null;
    availability = "in_stock";
    if (!partNumber) partNumber = cleanPartNumber(item.part_number) ?? NO_PART_NUMBER;
    stockItemId = item.id as string;
    stockWords = stockItemWords(item as StockLike);
    stockOnHand = Number(item.quantity) || 0;
  }
  const fields = { part_number: partNumber, part_type: type, brand: type && type !== "genuine" ? (row.brand ?? "").trim().slice(0, 80) || null : null, list_price_aed: list, discount_percent: discount === null ? null : Math.min(100, Math.max(0, discount)), cost_aed: cost, supplier, availability, delivery_date: delivery, stock_item_id: stockItemId };
  // "Yes, real price" (2.1): stored for the cost on the screen only; a different cost later is asked again.
  const confirmNow = confirmReady && row.costConfirmed !== null && row.costConfirmed !== undefined && cost !== null && Math.abs(Number(row.costConfirmed) - cost) < 0.005;
  const confirmedCost = confirmNow ? cost : storedRow?.cost_confirmed_aed === null || storedRow?.cost_confirmed_aed === undefined ? null : Number(storedRow.cost_confirmed_aed);
  // THE cost check of this part against what its part number was bought at and the same part on the car.
  const { data: siblings } = await admin.from("part_items").select("id, job_id, description, part_number, part_type, option_group, cost_aed, supplier, is_active, removed_at, confirm_status").eq("job_id", jobId).eq("is_active", true);
  const optionGroup = row.optionOf ? (storedRow?.option_group ?? row.optionOf) : (storedRow?.option_group ?? null);
  const me: PartForCheck = { id: partId ?? "new-row", job_id: jobId, description: (row.name ?? "").trim(), part_number: partNumber, part_type: type, option_group: optionGroup, cost_aed: cost, list_price_aed: list, discount_percent: discount, supplier, stock_item_id: stockItemId, cost_confirmed_aed: confirmedCost };
  const check = (await costChecksFor([me], [me, ...((siblings ?? []) as PartForCheck[]).filter((s) => s.id !== partId)])).get(me.id) ?? null;
  const checkValues = costCheckValues(check, cost);
  // Priced means the same here as on the screen: part number, type, net above 0, a real supplier (and its stock item),
  // availability, and no cost question waiting (src/lib/parts-rows.ts).
  const tyreRow = isTyreName(row.name) || !!row.tyre;
  const complete = rowState({ part_number: partNumber ?? "", part_type: type ?? "", brand: "", list_price: "", discount: "", cost_aed: cost === null ? "" : String(cost), supplier: supplier ?? "", availability: availability ?? "", days: delivery ? daysText : "", qty: "1", ...checkValues, ...(stockItemId ? { stock_item: stockItemId } : {}), ...(isSettledStatus(storedRow?.order_status) ? { settled: "1" } : {}), ...(tyreRow ? { tyre_row: true, tyre_brand: row.tyre?.brand ?? (row.brand ?? ""), tyre_size: row.tyre?.size ?? tyreSizeIn(row.name) } : {}) }) === "priced";
  const now = new Date().toISOString();
  // A supplier discount above the owner's limit waits for his one-tap approval; until then the part is not priced.
  const approvalLimit = Number(settings.supplier_discount_approval_above_percent ?? 70);
  const needsApproval = discount !== null && discount > approvalLimit;
  const { data: prev } = partId ? await admin.from("part_items").select("discount_percent, discount_approval_status").eq("id", partId).maybeSingle() : { data: null };
  const prevDiscount = prev?.discount_percent === null || prev?.discount_percent === undefined ? null : Number(prev.discount_percent);
  let approvalStatus: string | null = (prev?.discount_approval_status as string | null | undefined) ?? null;
  let askOwner = false;
  let ownerAuto = false;
  if (!needsApproval) approvalStatus = null;
  else if (role === "owner") {
    // Section 3 (21 October): the owner never asks himself - his own figure is approved on the spot.
    if (approvalStatus !== "approved" || prevDiscount !== discount) ownerAuto = true;
    approvalStatus = "approved";
  } else if ((approvalStatus === "approved" || approvalStatus === "pending") && prevDiscount === discount) {
    // Already decided, or already asked, for this very discount.
  } else {
    approvalStatus = "pending";
    askOwner = true;
  }
  const approval: Record<string, unknown> = { discount_approval_status: approvalStatus };
  if (ownerAuto) Object.assign(approval, { discount_approval_at: new Date().toISOString(), discount_approval_by: staff.id, discount_approval_note: "Set by the owner (approved at once)" });
  const completeNow = complete && approvalStatus !== "pending";
  let previousCost: number | null = null;
  let description = (row.name ?? "").trim();
  if (description.length > LINE_TEXT_MAX) return { error: tooLongWords(description.length) };
  let requestId = row.requestId;
  const changes: string[] = [];
  let qtyChange: { from: number; to: number; fromUnit: PartUnit | null; toUnit: PartUnit | null } | null = null;
  let askerFor: { part_request_id: string | null; added_by_role?: string | null } = { part_request_id: row.requestId };
  if (partId) {
    const { data: cur } = await admin.from("part_items").select("id, cost_aed, description, original_description, part_request_id, quantity, confirmed_quantity, added_by_role").eq("id", partId).eq("job_id", jobId).maybeSingle();
    if (!cur) return { error: "Part not found." };
    previousCost = cur.cost_aed === null ? null : Number(cur.cost_aed);
    const patch: Record<string, unknown> = { ...fields, ...approval, ...(confirmNow ? { cost_confirmed_aed: cost, cost_confirmed_at: now, cost_confirmed_by: staff.id } : {}), ...(completeNow ? { priced_by: staff.id, priced_at: now } : {}), updated_by: staff.id };
    // The name corrected by Parts: the technician's words stay on the row and are used nowhere else.
    if (description && description !== cur.description) {
      patch.description = description;
      patch.original_description = cur.original_description ?? cur.description;
      changes.push(`${cur.description} renamed to ${description}`);
    } else description = cur.description;
    const curQty = Number(cur.confirmed_quantity ?? cur.quantity) || 1;
    const unitChanged = !!unitTyped && !!storedUnit && unitTyped !== storedUnit;
    if (unitChanged) patch.unit = unitTyped;
    if ((qty !== null && Math.abs(qty - curQty) > 0.001) || unitChanged) {
      const to = qty ?? curQty;
      patch.confirmed_quantity = to;
      patch.quantity_changed_at = now;
      patch.quantity_changed_by = staff.id;
      qtyChange = { from: Number(cur.quantity) || curQty, to, fromUnit: storedUnit, toUnit: unitTyped ?? storedUnit };
      changes.push(`${description}: quantity ${curQty} → ${to}${unitChanged ? ` (${unitTyped === "l" ? "litres" : unitTyped === "set" ? "sets" : "pieces"})` : ""}`);
    }
    requestId = cur.part_request_id ?? requestId;
    askerFor = { part_request_id: cur.part_request_id, added_by_role: cur.added_by_role };
    const { error } = await admin.from("part_items").update(patch).eq("id", partId);
    if (error) return { error: dbWords(error, "parts/actions") };
  } else {
    let quantity = qty ?? 1;
    let positions: string[] = [];
    let newGroup: string | null = null;
    let newUnit: PartUnit = unitTyped ?? defaultUnitFor(description);
    if (row.optionOf) {
      const { data: base } = await admin.from("part_items").select("id, part_request_id, option_group, description, quantity, confirmed_quantity, positions").eq("id", row.optionOf).maybeSingle();
      if (!base) return { error: "Part not found." };
      newGroup = base.option_group ?? base.id;
      if (!base.option_group) await admin.from("part_items").update({ option_group: newGroup, updated_by: staff.id }).eq("id", base.id);
      description = description || base.description;
      quantity = qty ?? (Number(base.confirmed_quantity ?? base.quantity) || 1);
      positions = (base.positions as string[] | null) ?? [];
      requestId = base.part_request_id;
    } else if (requestId) {
      const { data: req } = await admin.from("part_requests").select("label, quantity, positions, unit, catalogue_id").eq("id", requestId).maybeSingle();
      if (!req) return { error: "Request not found." };
      description = description || req.label;
      quantity = qty ?? (Number(req.quantity) || 1);
      positions = (req.positions as string[] | null) ?? [];
      if (req.label && description !== req.label) changes.push(`${req.label} renamed to ${description}`);
      // The unit the request stands for: sets and litres as stored, else read from the name (a stored "pc" is nobody's
      // choice: the inspection's parts list stored it for every fluid too).
      const reqUnit: PartUnit = requestUnitOf(description, req.unit);
      newUnit = unitTyped ?? reqUnit;
      if (Math.abs(quantity - (Number(req.quantity) || 1)) > 0.001 || (unitsReady && newUnit !== reqUnit)) qtyChange = { from: Number(req.quantity) || 1, to: quantity, fromUnit: unitsReady ? reqUnit : null, toUnit: unitsReady ? newUnit : null };
    }
    if (!description) return { error: "Type the part name." };
    // A part added by Parts from the picker brings its positions along.
    if (!row.optionOf && !requestId && Array.isArray(row.positions)) positions = row.positions.map((p) => String(p).slice(0, 40)).filter(Boolean).slice(0, 8);
    const { data: req2 } = requestId ? await admin.from("part_requests").select("label, quantity").eq("id", requestId).maybeSingle() : { data: null };
    const { data: created, error } = await admin
      .from("part_items")
      .insert({ job_id: jobId, client_key: clientKey, part_request_id: requestId, description, original_description: req2?.label && req2.label !== description ? req2.label : null, quantity: req2 ? Number(req2.quantity) || quantity : quantity, confirmed_quantity: quantity, ...(unitsReady ? { unit: newUnit } : {}), positions, option_group: newGroup, ...fields, ...approval, ...(confirmNow ? { cost_confirmed_aed: cost, cost_confirmed_at: now, cost_confirmed_by: staff.id } : {}), ...(qtyChange ? { quantity_changed_at: now, quantity_changed_by: staff.id } : {}), confirm_status: "confirmed", confirmed_by: staff.id, confirmed_at: now, ...(complete ? { priced_by: staff.id, priced_at: now } : {}), added_by_role: role, created_by: staff.id, updated_by: staff.id })
      .select("id")
      .single();
    if (error || !created) return { error: (error ? dbWords(error, "parts/actions") : "Could not save the part.") };
    partId = created.id;
    if (newGroup && row.optionOf) {
      const quotationId = await draftQuotation(jobId);
      if (quotationId) await admin.from("quotation_lines").update({ option_group: newGroup, updated_by: staff.id }).eq("quotation_id", quotationId).eq("part_item_id", row.optionOf);
    }
  }
  if (requestId) await admin.from("part_requests").update({ status: completeNow ? "done" : "listed", updated_by: staff.id }).eq("id", requestId).in("status", ["open", "listed", "done"]);
  if (completeNow && partId) {
    // A replacement for a part the customer approved (another supplier after a refusal, or for a part marked not
    // needed) takes over its approval: To order at once, covered by the line of the part it replaces.
    const replaces = await approvedOriginalOf(partId);
    if (replaces) {
      // From our own shelf: received from the stock at once, like an approved shelf part (never To order: it would
      // never go on an LPO and would stop the job's next one). From a supplier: To order.
      if (availability === "in_stock" || fromStock) await receiveFromShelf(partId, staff, `Replacement for ${job.job_number}, from our stock`);
      else await admin.from("part_items").update({ order_status: "to_order", updated_by: staff.id }).eq("id", partId).eq("order_status", "none");
      await admin.from("part_items").update({ order_status: "none", updated_by: staff.id }).eq("id", replaces).eq("order_status", "to_order").is("po_id", null);
    } else await syncLineForPart(jobId, partId, staff.id, { quiet: held });
  }
  if (partId) {
    // On an LPO still waiting for approval, the line follows; a part to order and on no LPO joins the one that waits.
    await refreshPendingLpoLine(partId, staff);
    if (completeNow) await addPartsToOpenLpo(jobId, staff);
  }
  // The tyre details: stored with the part; a new brand or model is remembered for next time.
  if (row.tyre && partId) {
    await admin.from("part_items").update({ tyre_spec: row.tyre, brand: row.tyre.brand || null, updated_by: staff.id }).eq("id", partId);
    await learnTyre(row.tyre, settings);
  }
  if (previousCost !== null && cost !== null && cost !== previousCost) changes.push(`${description}: price AED ${previousCost} → AED ${cost}`);
  if (qtyChange) {
    // THE wording ("Advisor asked 1, Parts changed to 8 L"), on the job's history; the advisor hears it with the send.
    await logPartQuantity(job, { name: description, asked: qtyChange.from, askedBy: await askerOfPart(askerFor), askedUnit: qtyChange.fromUnit, now: qtyChange.to, unit: qtyChange.toUnit, by: staff, from: "desk" });
  }
  if (changes.length) await flagSentQuotations(jobId, job, changes.join("; "), staff);
  if (askOwner && partId) {
    await notifyRoles(["owner"], { type: "owner_approval_needed", title: `Supplier discount ${discount}% needs your approval · ${job.job_number}`, body: `${description}: list AED ${list ?? "?"}, ${discount}% from ${supplier ?? "no supplier"}, net AED ${cost ?? "?"}. Approve or refuse with one tap.`, jobId, href: "/parts/approvals" });
    await admin.from("job_events").insert({ job_id: jobId, event_type: "discount_approval", note: `${description}: ${discount}% discount from ${supplier ?? "?"} waits for the owner's approval (${staff.display_name})`, created_by: staff.id });
  }
  // "Yes, real price": written on the job's history once per answer (the figure, the part and its number).
  if (confirmNow && partId && cost !== null && !(storedRow?.cost_confirmed_aed !== null && storedRow?.cost_confirmed_aed !== undefined && Math.abs(Number(storedRow.cost_confirmed_aed) - cost) < 0.005)) {
    const pn = realPartNumber(partNumber);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "part_cost_confirmed", note: `${staff.display_name} confirmed AED ${cost.toFixed(2)} is the real price of ${description.toUpperCase()}${pn ? ` (${pn})` : ""}${supplier ? ` from ${supplier}` : ""}`, created_by: staff.id });
  }
  if (stockItemId) forgetBoughtPrices();
  refresh(jobId);
  // The screen takes in what the server decided: the cost question for the cost saved, the stock item and its cost.
  const server: Partial<RowValues> = { ...checkValues, part_number: partNumber ?? "", ...(fromStock ? { stock_item: stockItemId ?? undefined, stock_words: stockWords, stock_on_hand: stockOnHand === null ? undefined : String(stockOnHand), availability: "in_stock", days: "", ...(stockItemId ? { cost_aed: String(cost ?? ""), list_price: "", discount: "" } : {}) } : { stock_item: undefined, stock_words: "", stock_on_hand: undefined }) };
  return { partId: partId ?? undefined, complete: completeNow, waitingApproval: approvalStatus === "pending", server };
}

type StockLike = { name: string; unit: string | null; quantity: number | string | null; unit_cost: number | string | null };
/** "ENGINE OIL 0W20 · 12 L on hand · AED 49.00 average": one stock item in words, for the row's status line. */
function stockItemWords(i: StockLike): string {
  const qty = Number(i.quantity) || 0;
  return `${String(i.name).toUpperCase()} · ${qty.toLocaleString("en-GB")} ${i.unit || "pc"} on hand · AED ${(Number(i.unit_cost) || 0).toFixed(2)} average`;
}

/**
 * "From our stock…" (2.3): the stock list for the picker on the Parts table and the parts desk - name, part number,
 * on hand and the average cost each. Parts and the owner only.
 */
export async function stockItemsForPicker(): Promise<{ error?: string; items?: { id: string; name: string; partNumber: string | null; unit: string; onHand: number; unitCost: number; words: string }[] }> {
  const staff = await getCurrentStaff();
  if (!staff || !can(staff.role_id as RoleId, "priceParts")) return { error: "Not allowed." };
  const { data } = await createAdminClient().from("stock_items").select("id, name, unit, quantity, unit_cost, part_number, item_type").eq("is_active", true).order("name");
  return { items: ((data ?? []) as (StockLike & { id: string; part_number: string | null; item_type: string | null })[]).filter((i) => i.item_type !== "consumable").map((i) => ({ id: i.id, name: i.name, partNumber: realPartNumber(i.part_number), unit: i.unit || "pc", onHand: Number(i.quantity) || 0, unitCost: Number(i.unit_cost) || 0, words: stockItemWords(i) })) };
}

/**
 * "+ Add to the stock list" in the picker, or the cost each of an item that has none yet: the item with its cost each
 * (and the quantity on the shelf, written as an opening "in" movement). The same item is found again by its part
 * number or its name, never made twice. Its cost is only set here while it has none (later costs come from deliveries).
 */
export async function stockItemQuick(input: { id?: string | null; name?: string; partNumber?: string; unit?: string; unitCost: number | string; onShelf?: number | string }): Promise<{ error?: string; /** The typed cost was not used: the item already has its cost on the stock list. */ note?: string; item?: { id: string; name: string; partNumber: string | null; unit: string; onHand: number; unitCost: number; words: string } }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "Please sign in again." };
  if (!can(staff.role_id as RoleId, "manageStock")) return { error: "Not allowed." };
  const cost = numOrNull(input.unitCost);
  if (cost === null || cost <= 0) return { error: "Type the cost of one, before VAT." };
  const shelf = numOrNull(input.onShelf ?? "") ?? 0;
  const admin = createAdminClient();
  let id = input.id ?? null;
  let note: string | undefined;
  if (id) {
    const { data: cur } = await admin.from("stock_items").select("id, unit_cost").eq("id", id).eq("is_active", true).maybeSingle();
    if (!cur) return { error: "That stock item is no longer on the list." };
    if (Number(cur.unit_cost) > 0) return { error: "This item already has its cost on the stock list." };
    await admin.from("stock_items").update({ unit_cost: cost, updated_by: staff.id }).eq("id", id);
  } else {
    const name = (input.name ?? "").trim();
    if (name.length < 2) return { error: "Type the item's name." };
    if (name.length > 120) return { error: "The name is too long (120 characters at most)." };
    const pnProblem = partNumberProblem(input.partNumber);
    if (pnProblem) return { error: pnProblem };
    const pn = realPartNumber(input.partNumber);
    const compact = compactPartNumber(pn);
    const { data: same } = await admin.from("stock_items").select("id, name, part_number, unit_cost").eq("is_active", true);
    const hit = ((same ?? []) as { id: string; name: string; part_number: string | null; unit_cost: number | string | null }[]).find((s) => (compact.length >= 4 && compactPartNumber(s.part_number) === compact) || s.name.trim().toLowerCase() === name.toLowerCase());
    if (hit) {
      // Already on the list: an item with no cost yet takes the cost just typed; one with a cost keeps it (later costs
      // come from deliveries), and the person is told the typed figure was not used.
      id = hit.id;
      if (!(Number(hit.unit_cost) > 0)) await admin.from("stock_items").update({ unit_cost: cost, updated_by: staff.id }).eq("id", hit.id);
      else if (Math.abs(Number(hit.unit_cost) - cost) >= 0.005) note = `${hit.name.toUpperCase()} is already on the stock list at AED ${Number(hit.unit_cost).toFixed(2)} each: that cost is used.`;
    } else {
      const { data: made, error } = await admin.from("stock_items").insert({ item_type: "part", name, unit: (input.unit ?? "pc").trim().slice(0, 20) || "pc", part_number: pn, quantity: 0, minimum_level: 0, unit_cost: cost, created_by: staff.id, updated_by: staff.id }).select("id").single();
      if (error || !made) return { error: (error ? dbWords(error, "parts/actions") : "Could not add the stock item.") };
      id = made.id as string;
    }
  }
  if (shelf > 0 && id) await recordStockMovement(id, { kind: "in", quantity: shelf, unitCost: cost, note: `On the shelf, added from the Parts table by ${staff.display_name}` }, staff);
  const { data: item } = await admin.from("stock_items").select("id, name, unit, quantity, unit_cost, part_number").eq("id", id!).maybeSingle();
  if (!item) return { error: "Could not read the stock item." };
  revalidatePath("/parts/stock");
  forgetBoughtPrices();
  return { ...(note ? { note } : {}), item: { id: item.id as string, name: item.name as string, partNumber: realPartNumber(item.part_number as string | null), unit: (item.unit as string) || "pc", onHand: Number(item.quantity) || 0, unitCost: Number(item.unit_cost) || 0, words: stockItemWords(item as StockLike) } };
}

/**
 * "Yes, real price" on a part the customer already approved and that is not ordered yet (2 November 2026): the row is
 * locked, so the answer alone is stored for the cost already on it (nothing else changes), and the part can go on an
 * LPO. Parts and the owner; only while the database keeps answers (migration 20261203100000).
 */
export async function confirmPartCost(jobId: string, partId: string, costEach: number): Promise<{ error?: string; ok?: boolean; added?: number }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "Please sign in again." };
  if (!can(staff.role_id as RoleId, "priceParts")) return { error: "Not allowed." };
  const job = await jobOf(jobId);
  if (!job || !job.is_open) return { error: "This job is closed." };
  if (!(await costConfirmReady())) return { error: "The answer can be kept once the owner applies the database change." };
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, description, part_number, supplier, cost_aed, order_status, is_active").eq("id", partId).eq("job_id", jobId).maybeSingle();
  if (!p || !p.is_active) return { error: "Part not found." };
  if (!["none", "to_order"].includes(String(p.order_status))) return { error: "Already ordered: use Correct the cost… instead." };
  const cost = p.cost_aed === null ? null : Number(p.cost_aed);
  if (cost === null || !(cost > 0) || Math.abs(cost - Number(costEach)) >= 0.005) return { error: "The price changed on the screen: check it again." };
  if (isPlaceholderSupplier(p.supplier)) return { error: `${placeholderSupplierWords(p.supplier)} (Remove: not needed, then Replace with the real supplier).` };
  const now = new Date().toISOString();
  const { error } = await admin.from("part_items").update({ cost_confirmed_aed: cost, cost_confirmed_at: now, cost_confirmed_by: staff.id, updated_by: staff.id }).eq("id", partId);
  if (error) return { error: dbWords(error, "parts/actions") };
  const pn = realPartNumber(p.part_number as string | null);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "part_cost_confirmed", note: `${staff.display_name} confirmed AED ${cost.toFixed(2)} is the real price of ${String(p.description).toUpperCase()}${pn ? ` (${pn})` : ""}${p.supplier ? ` from ${p.supplier}` : ""} (already approved by the customer)`, created_by: staff.id });
  // Approved and on no LPO: it joins the LPO that waits (or a new one after an approved main LPO).
  const r = p.order_status === "to_order" ? await addPartsToOpenLpo(jobId, staff) : { added: 0 };
  refresh(jobId);
  return { ok: true, added: r.added };
}

/** "Price is right ✓" on a JOB part the advisor priced himself (5 November 2026): the desk's later look, never a hold. */
export async function checkPartPrice(jobId: string, partId: string): Promise<{ error?: string; ok?: boolean }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "Please sign in again." };
  if (!can(staff.role_id as RoleId, "priceParts")) return { error: "Only the parts desk or the owner checks prices." };
  if (!(await advisorPricePartsReady())) return { error: "This waits for the owner's \"apply\" (one database change on the list)." };
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, description, cost_aed, supplier, priced_by_advisor, price_checked_at, is_active").eq("id", partId).eq("job_id", jobId).maybeSingle();
  if (!p || !p.is_active) return { error: "Part not found." };
  if (!p.priced_by_advisor || p.price_checked_at) return { ok: true };
  const { error } = await admin.from("part_items").update({ price_checked_at: new Date().toISOString(), price_checked_by: staff.id, updated_by: staff.id }).eq("id", p.id);
  if (error) return { error: dbWords(error, "parts/actions") };
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts", note: `${staff.display_name} checked the advisor's price on ${p.description}: AED ${Number(p.cost_aed ?? 0).toLocaleString("en-GB")} each${p.supplier ? ` from ${p.supplier}` : ""} is right`, created_by: staff.id });
  refresh(jobId);
  return { ok: true };
}

/**
 * "Correct the cost…" (2 November 2026: J-00017's drain plug and J-00609's engine flush were received from "OFJ
 * Additional" at AED 1.00, J-00969's moulding was ordered on LPO-00037-1 to "OFJ Additional"): a part already ordered
 * or received gets the cost that really stands, before its invoice is made. Logged on the job, never seen by the
 * customer.
 *   - From our stock: the stock item is linked, the shelf goes down (once), the cost is the stock average, the
 *     supplier "Our stock". Never for a part on an LPO (that one was bought from a supplier).
 *   - Bought from a supplier: the real supplier and its cost each. An LPO addressed to a stand-in supplier, with no
 *     supplier invoice entered and not paid, is addressed to the real one (every line on it); its approved line price
 *     stays, and the supplier invoice brings the real price through the usual price-change rule.
 * A cost already on a TAX invoice is not changed here (tell the owner); a proforma's line follows (internal cost).
 */
export async function correctSettledCost(jobId: string, partId: string, input: { kind: "stock"; stockItemId: string } | { kind: "supplier"; supplier: string; cost: number | string; confirmCost?: number | null }): Promise<{ error?: string; ok?: boolean; message?: string; ask?: string }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "Please sign in again." };
  if (!can(staff.role_id as RoleId, "priceParts")) return { error: "Not allowed." };
  const job = await jobOf(jobId);
  if (!job || !job.is_open) return { error: "This job is closed." };
  const admin = createAdminClient();
  const { data: raw } = await admin.from("part_items").select("id, job_id, description, part_number, supplier, cost_aed, final_cost_aed, order_status, quantity, confirmed_quantity, received_qty, po_id, stock_item_id, is_active").eq("id", partId).eq("job_id", jobId).maybeSingle();
  const p = raw as { id: string; job_id: string; description: string; part_number: string | null; supplier: string | null; cost_aed: number | string | null; final_cost_aed: number | string | null; order_status: string; quantity: number | string; confirmed_quantity: number | string | null; received_qty: number | string | null; po_id: string | null; stock_item_id: string | null; is_active: boolean } | null;
  if (!p || !p.is_active) return { error: "Part not found." };
  if (!isSettledStatus(p.order_status)) return { error: "Not ordered yet: change the price in the row itself." };
  const name = String(p.description).toUpperCase();
  // A tax invoice already carries this part's cost: it is not changed from here.
  const { data: invLines } = await admin.from("invoice_lines").select("id, quantity, invoice:invoices!invoice_lines_invoice_id_fkey(id, number, kind, status)").eq("part_item_id", partId).eq("is_active", true);
  const lines = ((invLines ?? []) as unknown as { id: string; quantity: number | string; invoice: { id: string; number: string; kind: string; status: string } | null }[]).filter((l) => l.invoice && l.invoice.status !== "cancelled");
  const taxed = lines.find((l) => l.invoice?.kind !== "proforma");
  if (taxed) return { error: `${name} is already on ${taxed.invoice?.kind === "tax_invoice" ? "tax invoice" : "invoice"} ${taxed.invoice?.number}: its cost stays as invoiced. Tell the owner.` };
  const before = numOrNull(p.final_cost_aed) ?? numOrNull(p.cost_aed);
  const qty = Number(p.received_qty) || Number(p.confirmed_quantity ?? p.quantity) || 1;
  let newCost: number;
  let newSupplier: string;
  let extra = "";
  const patch: Record<string, unknown> = { updated_by: staff.id };
  if (input.kind === "stock") {
    if (p.po_id) return { error: `${name} was ordered on an LPO: it came from a supplier, not our shelf. Choose Bought from a supplier.` };
    const { data: item } = await admin.from("stock_items").select("id, name, unit_cost, is_active").eq("id", input.stockItemId).maybeSingle();
    if (!item || !item.is_active) return { error: "That stock item is no longer on the stock list. Pick it again." };
    newCost = Number(item.unit_cost) || 0;
    if (!(newCost > 0)) return { error: `${String(item.name).toUpperCase()} has no cost on the stock list yet: type its cost each when you pick it.` };
    newSupplier = OUR_STOCK;
    Object.assign(patch, { supplier: OUR_STOCK, stock_item_id: item.id, availability: "in_stock", final_cost_aed: newCost });
    // The shelf goes down once for this part (never twice, whoever corrects it again).
    const { data: moved } = await admin.from("stock_movements").select("id").eq("part_item_id", partId).eq("kind", "out").limit(1);
    if (!moved?.length) await recordStockMovement(item.id as string, { kind: "out", quantity: qty, jobId, partItemId: partId, note: `${name}: taken from the shelf (cost corrected by ${staff.display_name})` }, staff);
    extra = ` (${String(item.name).toUpperCase()})`;
  } else {
    newSupplier = String(input.supplier ?? "").trim().slice(0, 120);
    if (!newSupplier) return { error: "Pick the real supplier." };
    if (isPlaceholderSupplier(newSupplier)) return { error: `${placeholderSupplierWords(newSupplier)}.` };
    if (isOurStock(newSupplier)) return { error: "From our shelf: choose From our stock… instead." };
    newCost = Number(String(input.cost ?? "").replace(/,/g, ""));
    if (!Number.isFinite(newCost) || !(newCost > 0)) return { error: "Type the real cost of one, before VAT." };
    newCost = round2(newCost);
    // A cost this low (or far under what the part was bought at) is asked once here too, like any typed cost.
    const confirmed = input.confirmCost !== null && input.confirmCost !== undefined && Math.abs(Number(input.confirmCost) - newCost) < 0.005;
    const me: PartForCheck = { id: partId, job_id: jobId, description: p.description, part_number: p.part_number, cost_aed: newCost, supplier: newSupplier, cost_confirmed_aed: confirmed ? newCost : null };
    const { data: siblings } = await admin.from("part_items").select("id, job_id, description, part_number, part_type, option_group, cost_aed, supplier, is_active, removed_at, confirm_status").eq("job_id", jobId).eq("is_active", true);
    const check = (await costChecksFor([me], [me, ...((siblings ?? []) as PartForCheck[]).filter((x) => x.id !== partId)])).get(partId);
    if (!confirmed && (check?.ask || newCost <= 1)) return { ask: check?.ask?.words ?? `AED ${newCost.toFixed(2)} – is this the real price?` };
    Object.assign(patch, { supplier: newSupplier, final_cost_aed: newCost });
    if (p.po_id) {
      const { data: po } = await admin.from("purchase_orders").select("id, number, supplier_name, supplier_invoice_status, supplier_paid_at, zoho_bill_id").eq("id", p.po_id).maybeSingle();
      const standIn = !!po && (isPlaceholderSupplier(po.supplier_name) || /^supplier to confirm$/i.test(String(po.supplier_name ?? "").trim()));
      if (po && standIn) {
        if (po.supplier_invoice_status === "received" || po.supplier_paid_at || po.zoho_bill_id) return { error: `${po.number} is addressed to "${po.supplier_name}" and its supplier invoice is already entered: tell the owner and accounts.` };
        const { data: sup } = await admin.from("suppliers").select("id, name").ilike("name", newSupplier).eq("is_active", true).maybeSingle();
        const real = (sup?.name as string | undefined) ?? newSupplier;
        await admin.from("purchase_orders").update({ supplier_name: real, supplier_id: sup?.id ?? null, updated_by: staff.id }).eq("id", po.id);
        await admin.from("part_items").update({ supplier: real, updated_by: staff.id }).eq("po_id", po.id).neq("id", partId).eq("is_active", true);
        extra = `; ${po.number} is now addressed to ${real} (it was "${po.supplier_name}")`;
      }
    }
  }
  const { error } = await admin.from("part_items").update(patch).eq("id", partId);
  if (error) return { error: dbWords(error, "parts/actions") };
  // A proforma already made for the job carries the part's cost on its line (internal only): it follows.
  for (const l of lines) await admin.from("invoice_lines").update({ cost_aed: round2(newCost * (Number(l.quantity) || qty)), updated_by: staff.id }).eq("id", l.id);
  const beforeWords = before === null ? "no cost" : `AED ${before.toFixed(2)}`;
  await admin.from("job_events").insert({ job_id: jobId, event_type: "part_cost_corrected", note: `${name}: cost corrected from ${beforeWords}${p.supplier ? ` (${p.supplier})` : ""} to AED ${newCost.toFixed(2)} each from ${newSupplier}${extra}, by ${staff.display_name}`, created_by: staff.id });
  forgetBoughtPrices();
  refresh(jobId);
  return { ok: true, message: `Cost corrected: AED ${newCost.toFixed(2)} each from ${newSupplier}${extra}.` };
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
    lines = (JSON.parse(String(formData.get("lines") ?? "[]")) as { name?: unknown; qty?: unknown }[]).map((l) => ({ name: String(l.name ?? "").trim(), qty: Math.max(0.01, Number(l.qty) || 1) })).filter((l) => l.name);
  } catch {
    return { error: "Could not read the lines." };
  }
  if (lines.length < 2) return { error: "Give at least two parts to split into." };
  const tooLong = lines.find((l) => l.name.length > LINE_TEXT_MAX);
  if (tooLong) return { error: tooLongWords(tooLong.name.length) };
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
  const held = await holdForSend(job, staff.id);
  if (p.cost_aed !== null) await syncLineForPart(jobId, partId, staff.id, { quiet: held });
  const what = `${original} split into ${lines.map((l) => `${l.name} × ${l.qty}`).join(", ")}`;
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_split", note: `${what} (${staff.display_name})`, created_by: staff.id });
  const n = { type: "parts_priced", title: `Parts split a bundled part · ${job.job_number}`, body: `${what}. The new parts are priced on their own.`, jobId, href: `/parts/${jobId}` };
  if (!held) await notifyStaff(await jobAdvisorIds(jobId, job.gated_in_by), { ...n, href: `/jobs/${jobId}` });
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
  if (error || !created) return { error: (error ? dbWords(error, "parts/actions") : "Could not add the supplier.") };
  revalidatePath("/parts/suppliers");
  return { supplier: { id: created.id, name: created.name, discount: 0, byType: {} } };
}

/**
 * "Pricing done – send to advisor" (section 10, 3 November 2026): the advisor in charge gets ONE notification ("All parts
 * priced on J-00970", or "Prices updated on …" after Edit) with what changed while pricing folded in, and the car leaves
 * the parts desk's to-do list. With a part not priced yet nothing is sent unless Parts chose "Send what you have" (force):
 * the screen lists those lines first, and the server says the same in words. Answered in the bar (no page jump). THE
 * send itself is src/lib/pricing-send.ts (the customer's approval releases what was held through it too).
 */
export async function pricingDone(jobId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "Please sign in again." };
  if (!can(staff.role_id as RoleId, "priceParts")) return { error: "Only Parts or the owner send the prices." };
  const r = await sendJobPricing(jobId, { by: { id: staff.id, display_name: staff.display_name }, force: String(formData.get("force") ?? "") === "1" });
  if (r.success) {
    refresh(jobId);
    revalidatePath(`/jobs/${jobId}/quote`, "layout");
  }
  return r;
}

/**
 * "Edit" after the send: the rows open again; the bar then offers "Send updated prices" and says what is already with
 * the customer. Answered in the bar (no page jump).
 */
export async function reopenPricing(jobId: string, _formData?: FormData): Promise<void> {
  void _formData;
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || !can(staff.role_id as RoleId, "priceParts")) return;
  const job = await jobOf(jobId);
  if (!job || !job.is_open) return;
  await createAdminClient().from("jobs").update({ parts_pricing_reopened_at: new Date().toISOString(), parts_pricing_reopened_by: staff.id, updated_by: staff.id }).eq("id", jobId);
  refresh(jobId);
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
  if (upError) redirect(`/parts/${p.job_id}?error=${encodeURIComponent("Diagram upload failed: " + dbDetail(upError, "parts/actions"))}`);
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

/** The part a replacement takes over, when the customer had approved it (refused on an LPO, or to order and marked not needed). */
async function approvedOriginalOf(partId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("replaced_part_id").eq("id", partId).maybeSingle();
  if (!p?.replaced_part_id) return null;
  const refusedCol = (await refusalsReady()) ? ", refused_at" : "";
  const { data: o } = await admin.from("part_items").select(`id, order_status, not_needed_at${refusedCol}`).eq("id", p.replaced_part_id).maybeSingle();
  const orig = o as unknown as { id: string; order_status: string; not_needed_at: string | null; refused_at?: string | null } | null;
  if (!orig) return null;
  return orig.refused_at || orig.order_status !== "none" ? orig.id : null;
}

/**
 * "Replace": a refused line (or one marked not needed) gets a new row with the same name, quantity and positions, to
 * be priced with another supplier. Once priced it is To order by itself and joins the LPO waiting for approval; the
 * row says "Replaces the refused line (<old supplier>)".
 */
export async function replaceRefusedPart(jobId: string, partId: string): Promise<{ error?: string; newId?: string }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return { error: "Please sign in again." };
  if (!can(staff.role_id as RoleId, "priceParts")) return { error: "Not allowed." };
  const job = await jobOf(jobId);
  if (!job || !job.is_open) return { error: "This job is closed." };
  const admin = createAdminClient();
  const refusedCol = (await refusalsReady()) ? ", refused_at" : "";
  const { data: raw } = await admin.from("part_items").select(`id, part_request_id, description, quantity, confirmed_quantity, positions, part_type, brand, supplier, replacement_part_id, not_needed_at, disposition, disposition_at, return_status${refusedCol}`).eq("id", partId).eq("job_id", jobId).maybeSingle();
  const p = raw as unknown as { id: string; part_request_id: string | null; description: string; quantity: number; confirmed_quantity: number | null; positions: string[] | null; part_type: string | null; brand: string | null; supplier: string | null; replacement_part_id: string | null; not_needed_at: string | null; disposition: string | null; disposition_at: string | null; return_status: string | null; refused_at?: string | null } | null;
  if (!p) return { error: "Part not found." };
  // An ordered part given its ending is not needed on this car: nothing to replace (3 November 2026).
  if (endingOf(p)) return { error: "This part was given its ending (not needed): add a new part if the car needs one after all." };
  if (!p.refused_at && !p.not_needed_at) return { error: "Only a refused part, or one marked not needed, can be replaced." };
  if (p.replacement_part_id) {
    const { data: r } = await admin.from("part_items").select("id").eq("id", p.replacement_part_id).eq("is_active", true).maybeSingle();
    if (r) return { error: "This part already has a replacement on the list." };
  }
  const now = new Date().toISOString();
  const { data: made, error } = await admin
    .from("part_items")
    .insert({ job_id: jobId, client_key: `replace:${p.id}`, part_request_id: p.part_request_id, description: p.description, quantity: p.quantity, confirmed_quantity: p.confirmed_quantity ?? p.quantity, positions: p.positions ?? [], part_type: p.part_type, brand: p.brand, confirm_status: "confirmed", confirmed_by: staff.id, confirmed_at: now, replaced_part_id: p.id, added_by_role: staff.role_id, created_by: staff.id, updated_by: staff.id })
    .select("id")
    .single();
  if (error || !made) return { error: (error ? dbWords(error, "parts/actions") : "Could not add the replacement.") };
  await admin.from("part_items").update({ replacement_part_id: made.id, updated_by: staff.id }).eq("id", p.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "part_replacement", note: `${p.description.toUpperCase()}: replacement row added by ${staff.display_name} (replaces the ${p.refused_at ? "refused" : "not needed"} line${p.supplier ? `, ${p.supplier}` : ""})`, created_by: staff.id });
  refresh(jobId);
  return { newId: made.id };
}
