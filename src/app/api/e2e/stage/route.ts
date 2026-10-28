import { NextResponse, type NextRequest } from "next/server";
import { ensureInspection } from "@/lib/inspection-data";
import { newToken } from "@/lib/media";
import { refreshQuoteTotals } from "@/lib/quote-data";
import { applyCustomerResponse } from "@/lib/quote-respond";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureProforma } from "@/lib/invoice-flow";
import { hashPin } from "@/lib/pin";
import { ensureWorkLines } from "@/lib/work-data";
import { openQcRound } from "@/lib/work-flow";
import { ensureLooseMake } from "@/lib/loose-items";
import { ensureQrLink } from "@/lib/stickers";
import { randomBytes } from "node:crypto";
import { assignPerson, clockIn, startBodyshopWork } from "@/lib/bodyshop";
import { addDaysIso } from "@/lib/bodyshop-kinds";
import { dubaiDate } from "@/lib/jobs";

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
const LVEH = ID("20"), LJOB = ID("21"), LIT1 = ID("22"), LIT2 = ID("23"), LREQ = ID("24");
const BVEH = ID("30"), BJOB = ID("31"), BQ = ID("32"), BGI = ID("33"), BAPPT = ID("34");

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || !process.env.E2E_SECRET || request.headers.get("x-e2e-secret") !== process.env.E2E_SECRET) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { stage?: string; id?: string; pin?: string; /** A deposit in AED set on the draft before the customer approves. */ deposit?: number; /** A name for the labour line, given while the quotation is still a draft. */ labourTitle?: string; /** How the customer is expected to pay (set on the draft, before approval locks it). */ method?: string };
  const stage = body.stage ?? "inspection";
  const admin = createAdminClient();
  // Two side doors for the tests: the work order lines of a job, and an open QC round with its items.
  if (stage === "worklines" && body.id) {
    const { data: o } = await admin.from("staff").select("id").eq("role_id", "owner").limit(1).maybeSingle();
    await ensureWorkLines(body.id, o?.id ?? null);
    const { data: lines } = await admin.from("work_lines").select("title, hours_quoted, quotation_line_id").eq("job_id", body.id).eq("is_active", true);
    return NextResponse.json({ lines });
  }
  if (stage === "qc-open" && body.id) {
    const { data: o } = await admin.from("staff").select("id").eq("role_id", "owner").limit(1).maybeSingle();
    await openQcRound(body.id, o?.id ?? "", await getSettings());
    const { data: qc } = await admin.from("qc_checks").select("id, items").eq("job_id", body.id).eq("status", "open").order("round", { ascending: false }).limit(1).maybeSingle();
    return NextResponse.json({ qc });
  }
  // A known PIN for one person, so the tests can sign for parts and finish jobs.
  if (stage === "pin" && body.id && body.pin) {
    await admin.from("staff_private").upsert({ staff_id: body.id, pin_hash: hashPin(body.pin) }, { onConflict: "staff_id" });
    return NextResponse.json({ ok: true });
  }
  const settings = await getSettings();
  const { data: staff } = await admin.from("staff").select("id, display_name, role_id").eq("is_active", true);
  const by = (role: string, n = 0) => (staff ?? []).filter((s) => s.role_id === role)[n];
  const owner = by("owner"), advisor = by("service_advisor") ?? by("owner"), manager = by("workshop_manager") ?? by("owner"), tech1 = by("technician", 0), tech2 = by("technician", 1) ?? by("technician", 0);
  if (!owner || !tech1) return NextResponse.json({ error: "Need an owner and a technician." }, { status: 400 });
  const { data: make } = await admin.from("vehicle_makes").select("id").limit(1).maybeSingle();
  const now = new Date().toISOString();
  await admin.from("customers").upsert({ id: CUST, customer_type: "individual", full_name: "Stage Test Customer", phone: "+971500000003", created_by: owner.id, updated_by: owner.id });
  if (stage === "bodyshop-plan") {
    // A car here and waiting in Planning with an approved bodyshop PACKAGE (no service behind it, like J-00493), no
    // parts, Parts done. "mixed": a "both" car with a mechanical labour line as well. Each call starts it over.
    const mixed = !!(body as { mixed?: boolean }).mixed;
    const PVEH = ID("50"), PJOB = ID("51"), PQ = ID("52"), PGI = ID("53");
    await admin.from("vehicles").upsert({ id: PVEH, customer_id: CUST, plate_country: "UAE", plate_emirate: "Dubai", plate_code: "F", plate_number: "63001", has_plate: true, make_id: make?.id, vin: "WDC1234567E2E0002", model_year: 2025, colour: "Polar white", created_by: owner.id, updated_by: owner.id });
    const { data: haveJob } = await admin.from("jobs").select("gated_in_at, gated_in_by").eq("id", PJOB).maybeSingle();
    const { error: jErr } = await admin.from("jobs").upsert({ id: PJOB, vehicle_id: PVEH, customer_id: CUST, status: "waiting_parts", stage: "parts", is_open: true, department: mixed ? "both" : "bodyshop", priority: "normal", gated_in_by: haveJob?.gated_in_by ?? advisor.id, gated_in_at: haveJob?.gated_in_at ?? now, first_approval_at: now, stage_entered_at: now, plan_parts_done_at: now, plan_parts_by: null, plan_released_at: null, plan_released_by: null, plan_start_date: null, plan_bodyshop_released_at: null, plan_bodyshop_released_by: null, plan_bodyshop_start_date: null, plan_date_confirmed_at: null, plan_date_confirmed_by: null, bodyshop_started_at: null, work_started_at: null, assigned_to: null, promised_at: null, created_by: advisor.id, updated_by: advisor.id });
    if (jErr) return NextResponse.json({ error: "jobs: " + jErr.message }, { status: 500 });
    await admin.from("bodyshop_stages").update({ is_active: false }).eq("job_id", PJOB);
    await admin.from("bodyshop_assignments").update({ removed_at: now }).eq("job_id", PJOB).is("removed_at", null);
    await admin.from("job_technicians").update({ is_active: false }).eq("job_id", PJOB);
    await admin.from("work_lines").update({ is_active: false }).eq("job_id", PJOB);
    await admin.from("gate_ins").upsert({ id: PGI, job_id: PJOB, arrived_by: "customer_drove", condition: "runs_drives", fuel_level: "half", cleanliness: "clean", mileage: 900, keys_count: 1, wheels_required: false, major_damage: false, keys_keychain: false, old_parts_return: false, customer_requests: "1. PPF", is_complete: true, created_by: advisor.id, updated_by: advisor.id });
    const { data: haveQ } = await admin.from("quotations").select("id, status").eq("id", PQ).maybeSingle();
    if (!haveQ) await admin.from("quotations").insert({ id: PQ, kind: "quotation", number: "Q-STAGE-P", version: 1, job_id: PJOB, customer_id: CUST, vehicle_id: PVEH, status: "sent", token: newToken(), sent_at: now, sent_by: advisor.id, sent_to_name: "Stage Customer", created_by: advisor.id, updated_by: advisor.id });
    const { count: lineCount } = await admin.from("quotation_lines").select("id", { count: "exact", head: true }).eq("quotation_id", PQ);
    // Lines change only while the quotation is open (an approved one locks them); then it is approved again.
    await admin.from("quotations").update({ status: "sent", updated_by: advisor.id }).eq("id", PQ);
    if (!lineCount) {
      const snapshot = { key: "e2e_full", name: "E2E Full Protection", time_in_workshop: "3 days", pickup_dropoff: false, aftercare_check: false, items: [{ label: "Full body paint protection film", warranty: "10-year warranty" }, { label: "OFJ ceramic heat rejection tint – side & rear windows", warranty: "5-year warranty" }, { label: "PPF specific ceramic coating", warranty: "1-year warranty" }] };
      await admin.from("quotation_lines").insert([
        { quotation_id: PQ, position: 0, line_type: "package", title: "E2E Full Protection", service_id: null, package_key: "e2e_full", package_items: snapshot, price_per: "job", quantity: 1, unit_price: 24000, hours: null, source_type: "manual", urgency: "recommended", is_active: true, created_by: advisor.id, updated_by: advisor.id },
        { quotation_id: PQ, position: 1, line_type: "labour", title: "Brake pads replace", service_id: null, package_key: null, package_items: null, price_per: "job", hours: 2, unit_price: 350, quantity: 2, source_type: "manual", urgency: "urgent", is_active: mixed, created_by: advisor.id, updated_by: advisor.id },
      ]);
    } else await admin.from("quotation_lines").update({ is_active: mixed }).eq("quotation_id", PQ).eq("line_type", "labour");
    await admin.from("quotations").update({ status: "approved", responded_at: now, approver_name: "Stage Customer", updated_by: advisor.id }).eq("id", PQ);
    await refreshQuoteTotals(PQ, settings, advisor.id);
    return NextResponse.json({ jobId: PJOB, quotationId: PQ, mixed });
  }
  if (stage === "bodyshop") {
    // A bodyshop car: quoted before arrival (Full PPF, tint, old PPF removal). "at": sent (link open for the customer),
    // approved (booked, not here), in_work (gated in, stages running) or ready (work done, sign-off open).
    const at = (body as { at?: string }).at ?? "in_work";
    const today = dubaiDate();
    // People: the bodyshop manager is the existing one; the three leaders and an installer are made for the tests (PIN 1234).
    const ensurePerson = async (email: string, display_name: string, role_id: string, department_id: string) => {
      const { data: have } = await admin.from("staff").select("id").eq("display_name", display_name).maybeSingle();
      if (have) return have.id as string;
      const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      let userId = users?.users.find((u) => u.email === email)?.id;
      if (!userId) {
        const { data: made, error: mkErr } = await admin.auth.admin.createUser({ email, password: "E2e-" + randomBytes(6).toString("hex"), email_confirm: true });
        if (mkErr) throw new Error("Could not make the test person " + display_name + ": " + mkErr.message);
        userId = made.user?.id;
      }
      if (!userId) throw new Error("Could not make the test person " + display_name);
      await admin.from("staff").upsert({ id: userId, full_name: display_name, display_name, role_id, department_id, login_type: "both", is_active: true, created_by: owner.id, updated_by: owner.id });
      await admin.from("staff_private").upsert({ staff_id: userId, pin_hash: hashPin("1234"), email }, { onConflict: "staff_id" });
      return userId;
    };
    const { data: mgrRow } = await admin.from("staff").select("id").eq("role_id", "workshop_manager").in("department_id", ["bodyshop", "paint", "ppf_tint", "detailing"]).eq("is_active", true).order("display_name").limit(1).maybeSingle();
    const managerId = mgrRow?.id ?? (await ensurePerson("e2e-bodyshop-manager@ofj.test", "E2e Bodyshop Manager", "workshop_manager", "bodyshop"));
    const ppfLeader = await ensurePerson("e2e-ppf-leader@ofj.test", "E2e PPF Leader", "team_leader", "ppf_tint");
    const detailingLeader = await ensurePerson("e2e-detailing-leader@ofj.test", "E2e Detailing Leader", "team_leader", "detailing");
    const paintLeader = await ensurePerson("e2e-paint-leader@ofj.test", "E2e Paint Leader", "team_leader", "paint");
    const installer = await ensurePerson("e2e-installer@ofj.test", "E2e Installer", "technician", "ppf_tint");
    const detailer = await ensurePerson("e2e-detailer@ofj.test", "E2e Detailer", "technician", "detailing");
    await admin.from("vehicles").upsert({ id: BVEH, customer_id: CUST, plate_country: "UAE", plate_emirate: "Dubai", plate_code: "F", plate_number: "63000", has_plate: true, make_id: make?.id, vin: "WDC1234567E2E0001", model_year: 2025, colour: "Obsidian black", created_by: owner.id, updated_by: owner.id });
    const handoverToken = "e2ehandover" + randomBytes(10).toString("hex");
    const promised = addDaysIso(today, at === "ready" ? 1 : 4);
    // A job seeded earlier keeps its gate-in stamp: the stamp trigger only lets it change while the job is booked.
    const { data: haveJob } = await admin.from("jobs").select("gated_in_at, gated_in_by").eq("id", BJOB).maybeSingle();
    const { error: bjErr } = await admin.from("jobs").upsert({ id: BJOB, vehicle_id: BVEH, customer_id: CUST, status: "booked", stage: "quote", is_open: false, department: "bodyshop", priority: "normal", gated_in_by: haveJob?.gated_in_by ?? advisor.id, gated_in_at: haveJob?.gated_in_at ?? now, booked_at: now, booked_arrival_at: now, promised_at: promised, bodyshop_handover_token: handoverToken, bodyshop_started_at: null, gated_out_at: null, created_by: advisor.id, updated_by: advisor.id });
    if (bjErr) return NextResponse.json({ error: "jobs: " + bjErr.message }, { status: 500 });
    await admin.from("bodyshop_stages").update({ is_active: false }).eq("job_id", BJOB);
    const approvedNow = at !== "sent";
    const qToken = newToken();
    await admin.from("quotations").upsert({ id: BQ, kind: "quotation", number: "Q-STAGE-B", version: 1, job_id: BJOB, customer_id: CUST, vehicle_id: BVEH, status: "sent", token: qToken, sent_at: now, sent_by: advisor.id, sent_to_name: "Stage Customer", ...(approvedNow ? { responded_at: now, approver_name: "Stage Customer", approved_total_aed: 23100, removal_ack_at: now, removal_ack_name: "Stage Customer" } : {}), created_by: advisor.id, updated_by: advisor.id });
    const { data: bLines } = await admin.from("quotation_lines").select("id").eq("quotation_id", BQ);
    if (!(bLines ?? []).length) {
      const { data: svcs } = await admin.from("services").select("id, name, bodyshop_kind").in("bodyshop_kind", ["ppf", "tint", "ppf_removal"]);
      const svc = (k: string) => (svcs ?? []).find((s) => s.bodyshop_kind === k);
      await admin.from("quotation_lines").insert([
        { quotation_id: BQ, position: 0, line_type: "package", title: svc("ppf")?.name ?? "Full PPF", service_id: svc("ppf")?.id ?? null, price_per: "job", quantity: 1, unit_price: 18000, source_type: "manual", urgency: "recommended", created_by: advisor.id, updated_by: advisor.id },
        { quotation_id: BQ, position: 1, line_type: "package", title: svc("tint")?.name ?? "Window tint", service_id: svc("tint")?.id ?? null, price_per: "job", quantity: 1, unit_price: 2500, tint_percent: 35, source_type: "manual", urgency: "recommended", created_by: advisor.id, updated_by: advisor.id },
        { quotation_id: BQ, position: 2, line_type: "package", title: svc("ppf_removal")?.name ?? "Old PPF removal", service_id: svc("ppf_removal")?.id ?? null, price_per: "job", quantity: 1, unit_price: 1500, source_type: "manual", urgency: "recommended", created_by: advisor.id, updated_by: advisor.id },
      ]);
    }
    // The lines go in while the quotation is still open; the approved mark comes after (an approved quotation refuses new lines).
    if (approvedNow) await admin.from("quotations").update({ status: "approved", updated_by: advisor.id }).eq("id", BQ);
    await refreshQuoteTotals(BQ, settings, advisor.id);
    await admin.from("appointments").upsert({ id: BAPPT, kind: "car_drop", department: "bodyshop", customer_id: CUST, vehicle_id: BVEH, job_id: BJOB, reason: "Bodyshop: Full PPF, tint, old PPF removal", starts_at: now, duration_minutes: 30, advisor_id: advisor.id, status: at === "sent" || at === "approved" ? "booked" : "arrived", created_by: advisor.id, updated_by: advisor.id });
    const people = { manager: managerId, ppfLeader, detailingLeader, paintLeader, installer, detailer, advisor: advisor.id };
    if (at === "sent" || at === "approved") return NextResponse.json({ jobId: BJOB, quotationId: BQ, token: qToken, handoverToken, promised, people });
    // The car arrives: gate-in complete (legacy media rows), the stages start.
    await admin.from("jobs").update({ status: "gate_in_pending", stage: "gate_in", is_open: true, stage_entered_at: now }).eq("id", BJOB);
    await admin.from("gate_ins").upsert({ id: BGI, job_id: BJOB, arrived_by: "customer_drove", condition: "runs_drives", fuel_level: "half", cleanliness: "clean", mileage: 1200, keys_count: 1, wheels_required: false, major_damage: false, keys_keychain: false, old_parts_return: false, customer_requests: "Full PPF, tint, remove the old film", is_complete: true, created_by: owner.id, updated_by: owner.id });
    const { data: bgm } = await admin.from("gate_in_media").select("id").eq("job_id", BJOB).limit(1);
    if (!(bgm ?? []).length) await admin.from("gate_in_media").insert(["car_picture", "video", "dashboard_photo", "keys_photo"].map((kind) => ({ job_id: BJOB, kind, storage_path: `test/${BJOB}/${kind}.jpg`, uploaded_by: owner.id, created_by: owner.id, updated_by: owner.id })));
    const started = await startBodyshopWork(BJOB, { id: managerId, display_name: "Bodyshop manager" }, settings);
    if (started.error) return NextResponse.json({ error: "start: " + started.error }, { status: 500 });
    await assignPerson(BJOB, installer, { id: ppfLeader, display_name: "E2e PPF Leader" });
    await clockIn(BJOB, installer, "tablet", installer);
    const { data: stageRows } = await admin.from("bodyshop_stages").select("id, key, label, section, due_date, status, position").eq("job_id", BJOB).eq("is_active", true).order("position");
    if (at === "ready") {
      // Every stage but the handover is done; the car is Ready and the sign-off is open.
      for (const s of stageRows ?? []) if (s.key !== "handover") await admin.from("bodyshop_stages").update({ status: "done", done_at: now, done_by: managerId }).eq("id", s.id);
      const h = (stageRows ?? []).find((s) => s.key === "handover");
      if (h) await admin.from("bodyshop_stages").update({ status: "active", started_at: now }).eq("id", h.id);
      await admin.from("jobs").update({ status: "ready", stage: "ready", stage_entered_at: now, promised_at: promised }).eq("id", BJOB);
      await ensureProforma(BJOB, { id: advisor.id, display_name: advisor.display_name }, settings).catch(() => null);
    }
    return NextResponse.json({ jobId: BJOB, quotationId: BQ, token: qToken, handoverToken, promised, people, stages: stageRows ?? [] });
  }
  if (stage === "loose") {
    // Loose items at Quote, with two items and a request; the optional "at" moves it on (pending_qc or ready).
    const at = (body as { at?: string }).at ?? "pending_quote";
    const looseMake = await ensureLooseMake();
    await admin.from("vehicles").upsert({ id: LVEH, customer_id: CUST, kind: "loose", has_plate: false, plate_country: "UAE", make_id: looseMake, variant: "4 wheels, 1 bumper", created_by: owner.id, updated_by: owner.id });
    const stageOfAt = at === "ready" ? "ready" : at === "pending_qc" ? "qc" : at === "in_work" ? "work" : "quote";
    await admin.from("jobs").upsert({ id: LJOB, vehicle_id: LVEH, customer_id: CUST, job_kind: "loose", stage: stageOfAt, status: at, priority: "normal", department: "bodyshop", gated_in_by: advisor.id, first_approval_at: now, stage_entered_at: now, brought_by: "Stage Driver", assessment_note: "kerb marks on two wheels", is_open: true, created_by: owner.id, updated_by: owner.id });
    await admin.from("job_items").upsert([{ id: LIT1, job_id: LJOB, position: 1, item_type: "Wheel", description: "21 inch, black", quantity: 4, created_by: owner.id, updated_by: owner.id }, { id: LIT2, job_id: LJOB, position: 2, item_type: "Bumper", description: "front, scratched", quantity: 1, created_by: owner.id, updated_by: owner.id }]);
    for (const itemId of [LIT1, LIT2]) {
      const code = await ensureQrLink("item", { jobId: LJOB, vehicleId: LVEH, refId: itemId }, owner.id);
      await admin.from("job_items").update({ qr_code: code }).eq("id", itemId);
    }
    await admin.from("job_requests").upsert([{ id: LREQ, job_id: LJOB, position: 1, text: "Repair the kerb damage and repaint" }]);
    if (at === "pending_qc") {
      const { data: open } = await admin.from("qc_checks").select("id").eq("job_id", LJOB).eq("status", "open").limit(1);
      if (!(open ?? []).length) await admin.from("qc_checks").insert({ job_id: LJOB, round: 1, status: "open", items: [{ key: "general:1", kind: "general", label: "Paint matches and no runs", result: null, remark: null }], created_by: owner.id, updated_by: owner.id });
    }
    return NextResponse.json({ jobId: LJOB, vehicleId: LVEH, items: [LIT1, LIT2], technicians: (staff ?? []).filter((s) => s.role_id === "technician").map((t) => ({ id: t.id, name: t.display_name })) });
  }
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
  await admin.from("part_items").upsert({ id: PA, job_id: JOB, description: "front brake pads", part_number: "pad-stage-1", quantity: 1, cost_aed: 200, availability: "to_order", delivery_date: new Date(Date.now() + 4 * 3600000 + 3 * 86400000).toISOString().slice(0, 10), confirm_status: "confirmed", confirmed_quantity: 1, part_type: "genuine", priced_by: owner.id, priced_at: now, created_by: owner.id, updated_by: owner.id });
  await admin.from("part_requests").upsert({ id: PR1, job_id: JOB, inspection_id: inspectionId, source_type: "request", source_key: REQ1, label: "rear brake discs", requested_text: "set of two", status: "open", quantity: 2, unit: "pcs", created_by: tech1.id, updated_by: tech1.id });
  const token = newToken();
  await admin.from("quotations").upsert({ id: Q1, kind: "quotation", number: "Q-STAGE-1", version: 1, job_id: JOB, customer_id: CUST, vehicle_id: VEH, status: "draft", token, created_by: advisor.id, updated_by: advisor.id, ...(body.deposit ? { deposit_mode: "aed", deposit_value: Number(body.deposit) } : {}), ...(body.method ? { expected_payment_method: String(body.method) } : {}), ...(stage === "ready" ? { sent_at: now, sent_by: advisor.id } : {}) });
  const { data: existingLines } = await admin.from("quotation_lines").select("id").eq("quotation_id", Q1);
  if (!(existingLines ?? []).length) {
    await admin.from("quotation_lines").insert([
      { quotation_id: Q1, position: 0, line_type: "labour", title: "REPLACE FRONT BRAKE PADS", source_type: "request", source_key: REQ1, quantity: 1, hours: 2, labour_rate: 300, urgency: "urgent", created_by: advisor.id, updated_by: advisor.id },
      { quotation_id: Q1, position: 1, line_type: "part", title: "Front brake pads (PAD-STAGE-1)", source_type: "manual", quantity: 1, unit_cost: 200, markup_percent: 50, unit_price: 300, part_item_id: PA, part_type: "genuine", created_by: advisor.id, updated_by: advisor.id },
    ]);
  }
  if (body.labourTitle) await admin.from("quotation_lines").update({ title: String(body.labourTitle) }).eq("quotation_id", Q1).eq("line_type", "labour");
  // Ready: approved outright (the lines are in; an approved quotation refuses new lines, so the mark comes last).
  if (stage === "ready") await admin.from("quotations").update({ status: "approved", responded_at: now, approver_name: "Stage Customer", updated_by: advisor.id }).eq("id", Q1);
  await refreshQuoteTotals(Q1, settings, advisor.id);
  if (stage === "quote") return NextResponse.json({ jobId: JOB, inspectionId, quotationId: Q1, token, advisor: advisor.display_name });
  // Approved by the customer: planning (approved stage) or straight to Ready, where the proforma prepares itself.
  const r = await applyCustomerResponse(Q1, { approve: true, name: "Stage Customer", via: "customer" });
  if (stage === "approved") return NextResponse.json({ jobId: JOB, quotationId: Q1, approval: r });
  await admin.from("jobs").update({ status: "ready", stage: "ready", stage_entered_at: now }).eq("id", JOB);
  const inv = await ensureProforma(JOB, { id: advisor.id, display_name: advisor.display_name }, settings);
  return NextResponse.json({ jobId: JOB, quotationId: Q1, approval: r, invoice: inv ? { id: inv.id, number: inv.number, kind: inv.kind, token: inv.token, total: inv.total_aed } : null });
}
