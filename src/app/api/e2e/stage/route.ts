import { NextResponse, type NextRequest } from "next/server";
import { ensureInspection } from "@/lib/inspection-data";
import { newToken } from "@/lib/media";
import { refreshQuoteTotals } from "@/lib/quote-data";
import { applyCustomerResponse } from "@/lib/quote-respond";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProforma } from "@/lib/invoice-flow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Seeds one car at a chosen stage for the browser tests, with fixed ids (22222222-...e3xx) that the
 * clean-up SQL removes. Stages: inspection (assigned, report open for the technician), quote (report
 * approved, draft quotation with a part request), ready (approved quotation, car Ready: the proforma
 * is prepared by itself). Never in production.
 */
const ID = (n: string) => `22222222-0000-4000-8000-00000000e3${n}`;
const CUST = ID("01"), VEH = ID("02"), JOB = ID("03"), GI = ID("04"), Q1 = ID("05"), PA = ID("06"), REQ1 = ID("07"), REQ2 = ID("08"), PR1 = ID("09");

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || !process.env.E2E_SECRET || request.headers.get("x-e2e-secret") !== process.env.E2E_SECRET) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { stage?: string };
  const stage = body.stage ?? "inspection";
  const admin = createAdminClient();
  const settings = await getSettings();
  const { data: staff } = await admin.from("staff").select("id, display_name, role_id").eq("is_active", true);
  const by = (role: string, n = 0) => (staff ?? []).filter((s) => s.role_id === role)[n];
  const owner = by("owner"), advisor = by("service_advisor") ?? by("owner"), manager = by("workshop_manager") ?? by("owner"), tech1 = by("technician", 0), tech2 = by("technician", 1) ?? by("technician", 0);
  if (!owner || !tech1) return NextResponse.json({ error: "Need an owner and a technician." }, { status: 400 });
  const { data: make } = await admin.from("vehicle_makes").select("id").limit(1).maybeSingle();
  const now = new Date().toISOString();
  await admin.from("customers").upsert({ id: CUST, customer_type: "individual", full_name: "stage test customer", phone: "+971500000003", created_by: owner.id, updated_by: owner.id });
  await admin.from("vehicles").upsert({ id: VEH, customer_id: CUST, plate_country: "UAE", plate_emirate: "Dubai", plate_code: "S", plate_number: "30303", has_plate: true, make_id: make?.id, vin: "wba1234567stage01", model_year: 2021, created_by: owner.id, updated_by: owner.id });
  const status = stage === "ready" ? "ready" : stage === "approved" ? "waiting_parts" : stage === "quote" ? "pending_quote" : "pending_inspection";
  const stageOf = stage === "ready" ? "ready" : stage === "approved" ? "parts" : stage === "quote" ? "quote" : "inspection";
  await admin.from("jobs").upsert({ id: JOB, vehicle_id: VEH, customer_id: CUST, stage: stageOf, status, priority: "normal", department: "mechanical", gated_in_by: advisor.id, first_approval_at: now, assigned_to: stage === "assign" ? null : tech1.id, assigned_at: stage === "assign" ? null : now, stage_entered_at: now, is_open: true, created_by: owner.id, updated_by: owner.id });
  await admin.from("gate_ins").upsert({ id: GI, job_id: JOB, arrived_by: "customer_drove", condition: "runs_drives", fuel_level: "half", cleanliness: "clean", mileage: 42000, keys_count: 1, wheels_required: false, major_damage: false, keys_keychain: false, old_parts_return: false, customer_requests: "brake noise", created_by: owner.id, updated_by: owner.id });
  // Gate-in media complete, so the car can be assigned.
  const { data: gm } = await admin.from("gate_in_media").select("id").eq("job_id", JOB).limit(1);
  if (!(gm ?? []).length) await admin.from("gate_in_media").insert(["car_picture", "video", "dashboard_photo", "keys_photo"].map((kind) => ({ job_id: JOB, kind, storage_path: `test/${JOB}/${kind}.jpg`, uploaded_by: owner.id, created_by: owner.id, updated_by: owner.id })));
  await admin.from("job_requests").upsert([{ id: REQ1, job_id: JOB, position: 1, text: "BRAKE NOISE WHEN STOPPING" }, { id: REQ2, job_id: JOB, position: 2, text: "a/c not cooling" }]);
  if (stage === "assign") return NextResponse.json({ jobId: JOB, technicians: (staff ?? []).filter((s) => s.role_id === "technician").map((t) => ({ id: t.id, name: t.display_name })) });
  await admin.from("job_technicians").upsert({ job_id: JOB, staff_id: tech1.id, added_by: manager.id, created_by: manager.id, updated_by: manager.id }, { onConflict: "job_id,staff_id", ignoreDuplicates: true });
  await admin.from("road_tests").upsert({ job_id: JOB, status: "not_started", items: {}, decision: "not_needed", decided_by: manager.id, decided_at: now, created_by: manager.id, updated_by: manager.id }, { onConflict: "job_id" });
  const inspectionId = await ensureInspection(JOB, tech1.id, settings.inspection_checklist, Number(settings.inspection_target_minutes) || 90, manager.id);
  if (stage === "inspection") {
    await admin.from("inspections").update({ status: "in_progress", started_at: now, updated_by: tech1.id }).eq("id", inspectionId);
    await admin.from("jobs").update({ status: "in_inspection" }).eq("id", JOB);
    return NextResponse.json({ jobId: JOB, inspectionId, technicianId: tech1.id, technician: tech1.display_name, technician2: tech2.display_name });
  }
  // The report: approved, two BAD items with remarks.
  const { data: items } = await admin.from("inspection_items").select("id, item_key, item_label").eq("inspection_id", inspectionId).order("position").limit(3);
  const its = items ?? [];
  if (its[0]) await admin.from("inspection_items").update({ status: "bad", remarks: "worn out, replace", updated_by: tech1.id }).eq("id", its[0].id);
  if (its[1]) await admin.from("inspection_items").update({ status: "average", remarks: "slight play", updated_by: tech1.id }).eq("id", its[1].id);
  if (its[2]) await admin.from("inspection_items").update({ status: "good", updated_by: tech1.id }).eq("id", its[2].id);
  await admin.from("inspection_findings").upsert([{ inspection_id: inspectionId, job_request_id: REQ1, status: "bad", found: "front pads at metal", needs: "pads and discs", created_by: tech1.id, updated_by: tech1.id }, { inspection_id: inspectionId, job_request_id: REQ2, status: "good", found: "cooling fine", needs: "", created_by: tech1.id, updated_by: tech1.id }], { onConflict: "inspection_id,job_request_id" });
  await admin.from("inspections").update({ status: "approved", started_at: now, submitted_at: now, approved_at: now, approved_by: manager.id, estimated_hours: 3, estimated_hours_manager: 3, updated_by: manager.id }).eq("id", inspectionId);
  await admin.from("part_items").upsert({ id: PA, job_id: JOB, description: "front brake pads", part_number: "pad-stage-1", quantity: 1, cost_aed: 200, availability: "to_order", delivery_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), confirm_status: "confirmed", confirmed_quantity: 1, part_type: "genuine", priced_by: owner.id, priced_at: now, created_by: owner.id, updated_by: owner.id });
  await admin.from("part_requests").upsert({ id: PR1, job_id: JOB, inspection_id: inspectionId, source_type: "request", source_key: REQ1, label: "rear brake discs", requested_text: "set of two", status: "open", quantity: 2, unit: "pcs", created_by: tech1.id, updated_by: tech1.id });
  const token = newToken();
  await admin.from("quotations").upsert({ id: Q1, kind: "quotation", number: "Q-STAGE-1", version: 1, job_id: JOB, customer_id: CUST, vehicle_id: VEH, status: stage === "ready" ? "approved" : "draft", token, created_by: advisor.id, updated_by: advisor.id, ...(stage === "ready" ? { sent_at: now, sent_by: advisor.id } : {}) });
  const { data: existingLines } = await admin.from("quotation_lines").select("id").eq("quotation_id", Q1);
  if (!(existingLines ?? []).length) {
    await admin.from("quotation_lines").insert([
      { quotation_id: Q1, position: 0, line_type: "labour", title: "REPLACE FRONT BRAKE PADS", source_type: "request", source_key: REQ1, quantity: 1, hours: 2, labour_rate: 300, urgency: "urgent", created_by: advisor.id, updated_by: advisor.id },
      { quotation_id: Q1, position: 1, line_type: "part", title: "Front brake pads (PAD-STAGE-1)", source_type: "manual", quantity: 1, unit_cost: 200, markup_percent: 50, unit_price: 300, part_item_id: PA, part_type: "genuine", created_by: advisor.id, updated_by: advisor.id },
    ]);
  }
  await refreshQuoteTotals(Q1, settings, advisor.id);
  if (stage === "quote") return NextResponse.json({ jobId: JOB, inspectionId, quotationId: Q1, token, advisor: advisor.display_name });
  // Approved by the customer: planning (approved stage) or straight to Ready, where the proforma prepares itself.
  const r = await applyCustomerResponse(Q1, { approve: true, name: "Stage Customer", via: "customer" });
  if (stage === "approved") return NextResponse.json({ jobId: JOB, quotationId: Q1, approval: r });
  await admin.from("jobs").update({ status: "ready", stage: "ready", stage_entered_at: now }).eq("id", JOB);
  const inv = await ensureProforma(JOB, { id: advisor.id, display_name: advisor.display_name }, settings);
  return NextResponse.json({ jobId: JOB, quotationId: Q1, approval: r, invoice: inv ? { id: inv.id, number: inv.number, kind: inv.kind, token: inv.token, total: inv.total_aed } : null });
}
