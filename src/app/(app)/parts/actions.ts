"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formValues, type FormState } from "@/lib/form-state";
import { getCurrentStaff, requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { notifyManagers, notifyRoles, notifyStaff } from "@/lib/notifications";
import { PARTS_BUCKET, PART_SELECT, minMarkupFor, refreshQuoteTotals, toPart } from "@/lib/quote-data";
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

async function syncLineForPart(jobId: string, partId: string, by: string) {
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
  if (p.confirm_status === "rejected") {
    if (line) await admin.from("quotation_lines").update({ is_active: false, updated_by: by }).eq("id", line.id);
  } else if (line) {
    await admin.from("quotation_lines").update({ title, quantity: p.confirmed_quantity ?? p.quantity, unit_cost: p.cost_aed, updated_by: by }).eq("id", line.id);
  } else {
    const settings = await getSettings();
    const { data: v } = await admin.from("jobs").select("vehicle:vehicles(make:vehicle_makes(name))").eq("id", jobId).maybeSingle();
    const make = ((v?.vehicle as unknown as { make: { name: string } | null } | null)?.make?.name) ?? null;
    const { data: last } = await admin.from("quotation_lines").select("position").eq("quotation_id", quotationId).order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: req } = p.part_request_id ? await admin.from("part_requests").select("label").eq("id", p.part_request_id).maybeSingle() : { data: null };
    await admin.from("quotation_lines").insert({ quotation_id: quotationId, position: (Number(last?.position) || 0) + 1, line_type: "part", title, group_label: req?.label ?? "Parts", source_type: "manual", quantity: p.confirmed_quantity ?? p.quantity, unit_cost: p.cost_aed, markup_percent: minMarkupFor(settings, make), part_item_id: p.id, created_by: by, updated_by: by });
  }
  await refreshQuoteTotals(quotationId, await getSettings(), by);
}

/** When every part on the job is priced and confirmed, the advisor hears about it. */
async function tellAdvisorIfComplete(jobId: string) {
  const admin = createAdminClient();
  const [{ data: parts }, job] = await Promise.all([admin.from("part_items").select("cost_aed, confirm_status").eq("job_id", jobId).eq("is_active", true), jobOf(jobId)]);
  const open = (parts ?? []).filter((p) => p.confirm_status === "pending" || (p.confirm_status === "confirmed" && p.cost_aed === null));
  if (open.length || !job) return;
  const { data: appr } = await admin.from("approval_requests").select("sent_by").eq("job_id", jobId);
  const ids = [job.gated_in_by, ...(appr ?? []).map((a) => a.sent_by)].filter((x): x is string => !!x);
  await notifyStaff(ids, { type: "parts_priced", title: `Parts priced and confirmed · ${job.job_number}`, body: "Every part on the quotation has a price and the technician's confirmation. The quotation can be sent.", jobId, href: `/jobs/${jobId}` });
}

/** Parts (or an advisor) turn a request into exact part lines: part number, description, quantity. One request can become several parts. */
export async function addPartItems(jobId: string, requestId: string | null, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await getCurrentStaff();
  const values = formValues(formData);
  if (!staff || staff.viewingAs) return { error: "Please sign in again.", values };
  const role = staff.role_id as RoleId;
  if (!(can(role, "priceParts") || can(role, "editQuotes"))) return { error: "Not allowed.", values };
  const job = await jobOf(jobId);
  if (!job || !job.is_open) return { error: "This job is closed.", values };
  const numbers = formData.getAll("part_number").map(String);
  const descriptions = formData.getAll("description").map(String);
  const quantities = formData.getAll("quantity").map(String);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < descriptions.length; i++) {
    const description = descriptions[i].trim();
    if (!description) continue;
    const qty = Number(quantities[i] ?? "1") || 1;
    rows.push({ job_id: jobId, part_request_id: requestId, part_number: numbers[i]?.trim() || null, description: description.slice(0, 200), quantity: Math.max(0.01, qty), added_by_role: role, created_by: staff.id, updated_by: staff.id });
  }
  if (!rows.length) return { error: "Enter at least one part with a description.", values };
  const admin = createAdminClient();
  // An optional catalogue diagram goes on the first part of the batch.
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
  if (error || !created) return { error: error?.message ?? "Could not add the parts.", values };
  if (requestId) await admin.from("part_requests").update({ status: "listed", updated_by: staff.id }).eq("id", requestId);
  for (const c of created) await syncLineForPart(jobId, c.id, staff.id);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_listed", note: `${rows.length} part${rows.length === 1 ? "" : "s"} listed by ${staff.display_name}${requestId ? "" : " (added without a request)"}`, created_by: staff.id });
  if (job.assigned_to) {
    await notifyStaff([job.assigned_to], { type: "parts_confirm_needed", title: `Confirm the parts · ${job.job_number}`, body: `${rows.length} part${rows.length === 1 ? "" : "s"} listed by ${staff.display_name}. Confirm what you need, or reject with a note.`, jobId, href: `/my-jobs/${jobId}` });
  }
  await notifyManagers(job.department ?? null, { type: "parts_confirm_needed", title: `Parts listed · ${job.job_number}`, body: `${rows.length} part${rows.length === 1 ? "" : "s"} for ${job.assigned_to ? "the technician" : "the car"} to confirm. You can confirm for an absent technician from the job card.`, jobId, href: `/jobs/${jobId}` });
  refresh(jobId);
  return { success: `${rows.length} part${rows.length === 1 ? "" : "s"} added. The technician has been asked to confirm.` };
}

/** Parts price one part: supplier, cost before VAT, available now or to order, expected delivery. */
export async function pricePart(partId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const staff = await requirePermission("priceParts");
  const values = formValues(formData);
  const supplier = blankToNull(formData.get("supplier"));
  const cost = Number(String(formData.get("cost_aed") ?? "").replace(/[^\d.]/g, ""));
  const availability = String(formData.get("availability") ?? "");
  const delivery = String(formData.get("delivery_date") ?? "").trim();
  if (!Number.isFinite(cost) || cost < 0 || String(formData.get("cost_aed") ?? "").trim() === "") return { error: "Enter the cost before VAT.", values };
  if (availability !== "in_stock" && availability !== "to_order") return { error: "Choose Available now or To order.", values };
  if (availability === "to_order" && !/^\d{4}-\d{2}-\d{2}$/.test(delivery)) return { error: "Enter the expected delivery date.", values };
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id").eq("id", partId).maybeSingle();
  if (!p) return { error: "Part not found.", values };
  const { error } = await admin.from("part_items").update({ supplier, cost_aed: cost, availability, delivery_date: availability === "to_order" ? delivery : null, priced_by: staff.id, priced_at: new Date().toISOString(), updated_by: staff.id }).eq("id", partId);
  if (error) return { error: error.message, values };
  await syncLineForPart(p.job_id, partId, staff.id);
  await tellAdvisorIfComplete(p.job_id);
  refresh(p.job_id);
  return { success: "Price saved." };
}

/** The technician confirms a part and the quantity, or rejects it with a note. The workshop manager or owner can do it for an absent technician. */
export async function confirmPart(partId: string, formData: FormData) {
  const staff = await requirePermission("confirmParts");
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, quantity, description").eq("id", partId).maybeSingle();
  if (!p) redirect("/my-jobs");
  const job = await jobOf(p.job_id);
  const role = staff.role_id as RoleId;
  const backTo = role === "technician" ? `/my-jobs/${p.job_id}` : `/jobs/${p.job_id}`;
  if (!job || !job.is_open) redirect(backTo);
  if (role === "technician" && job.assigned_to !== staff.id) redirect(`/my-jobs?error=${encodeURIComponent("This car is assigned to someone else.")}`);
  const decision = String(formData.get("decision") ?? "");
  const note = blankToNull(formData.get("note"));
  const qty = Number(String(formData.get("quantity") ?? "").trim() || p.quantity) || Number(p.quantity);
  if (decision !== "confirm" && decision !== "reject") redirect(backTo);
  if (decision === "reject" && (!note || note.length < 3)) redirect(`${backTo}?error=${encodeURIComponent("Say why the part is rejected.")}`);
  await admin.from("part_items").update({ confirm_status: decision === "confirm" ? "confirmed" : "rejected", confirmed_quantity: decision === "confirm" ? Math.max(0.01, qty) : null, confirmed_by: staff.id, confirmed_at: new Date().toISOString(), reject_note: decision === "reject" ? note : null, updated_by: staff.id }).eq("id", partId);
  await syncLineForPart(p.job_id, partId, staff.id);
  // A request is done once every one of its parts has an answer.
  const { data: pr } = await admin.from("part_items").select("part_request_id, confirm_status").eq("job_id", p.job_id).eq("is_active", true);
  const byReq = new Map<string, string[]>();
  for (const x of pr ?? []) if (x.part_request_id) byReq.set(x.part_request_id, [...(byReq.get(x.part_request_id) ?? []), x.confirm_status]);
  for (const [reqId, statuses] of byReq) if (!statuses.includes("pending")) await admin.from("part_requests").update({ status: statuses.every((s) => s === "rejected") ? "rejected" : "done", updated_by: staff.id }).eq("id", reqId);
  await admin.from("job_events").insert({ job_id: p.job_id, event_type: "part_confirmed", note: `${p.description}: ${decision === "confirm" ? `confirmed by ${staff.display_name}, quantity ${Math.max(0.01, qty)}` : `rejected by ${staff.display_name}: ${note}`}`, created_by: staff.id });
  await notifyRoles(["parts"], { type: "parts_confirmed", title: `${decision === "confirm" ? "Part confirmed" : "Part rejected"} · ${job.job_number}`, body: `${p.description}${decision === "reject" ? `: ${note}` : ` × ${Math.max(0.01, qty)}`} (${staff.display_name})`, jobId: p.job_id, href: `/parts/${p.job_id}` });
  await tellAdvisorIfComplete(p.job_id);
  refresh(p.job_id);
  redirect(`${backTo}?message=${encodeURIComponent(decision === "confirm" ? "Part confirmed." : "Part rejected.")}`);
}

/** Parts close a request they cannot source, with a note. */
export async function closePartRequest(requestId: string, formData: FormData) {
  const staff = await requirePermission("priceParts");
  const note = blankToNull(formData.get("note"));
  const admin = createAdminClient();
  const { data: r } = await admin.from("part_requests").select("id, job_id, label").eq("id", requestId).maybeSingle();
  if (!r) redirect("/parts");
  if (!note || note.length < 3) redirect(`/parts/${r.job_id}?error=${encodeURIComponent("Say why the request is closed.")}`);
  await admin.from("part_requests").update({ status: "rejected", requested_text: note, updated_by: staff.id }).eq("id", requestId);
  await admin.from("job_events").insert({ job_id: r.job_id, event_type: "parts_request_closed", note: `${r.label}: closed by ${staff.display_name}: ${note}`, created_by: staff.id });
  refresh(r.job_id);
  redirect(`/parts/${r.job_id}?message=${encodeURIComponent("Request closed.")}`);
}

/** Parts mark an approved part as ordered or received (purchase orders come in the next phase). */
export async function setOrderStatus(partId: string, status: "ordered" | "received") {
  const staff = await requirePermission("priceParts");
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, description").eq("id", partId).maybeSingle();
  if (!p) redirect("/parts");
  await admin.from("part_items").update({ order_status: status, updated_by: staff.id }).eq("id", partId);
  await admin.from("job_events").insert({ job_id: p.job_id, event_type: "part_order", note: `${p.description}: ${status} (${staff.display_name})`, created_by: staff.id });
  // Every approved part on the shelf: the car moves from Parts to Work.
  if (status === "received") {
    const [{ data: open }, job] = await Promise.all([admin.from("part_items").select("id").eq("job_id", p.job_id).eq("is_active", true).in("order_status", ["to_order", "ordered"]), jobOf(p.job_id)]);
    if (job && job.is_open && (open ?? []).length === 0) {
      const { data: j } = await admin.from("jobs").select("status").eq("id", p.job_id).maybeSingle();
      if (j?.status === "waiting_parts") {
        await admin.from("jobs").update({ status: "in_work", stage: "work" }).eq("id", p.job_id);
        await admin.from("job_events").insert({ job_id: p.job_id, event_type: "status_change", from_status: "waiting_parts", to_status: "in_work", note: "All approved parts received", created_by: staff.id });
        await notifyManagers(job.department ?? null, { type: "parts_to_order", title: `Parts received, work can start · ${job.job_number}`, body: "Every approved part is on the shelf.", jobId: p.job_id, href: `/jobs/${p.job_id}` });
        if (job.assigned_to) await notifyStaff([job.assigned_to], { type: "parts_to_order", title: `Parts received · ${job.job_number}`, body: "Every approved part is on the shelf. Work can start.", jobId: p.job_id, href: `/my-jobs/${p.job_id}` });
      }
    }
  }
  refresh(p.job_id);
  redirect(`/parts?message=${encodeURIComponent(`${p.description}: ${status}.`)}`);
}
