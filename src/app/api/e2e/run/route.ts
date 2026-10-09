import { NextResponse, type NextRequest } from "next/server";
import { buildInvoiceDraft, nextDocumentNumber } from "@/lib/invoice-data";
import { recordJobSummary } from "@/lib/job-summary";
import { dubaiDate } from "@/lib/jobs";
import { newToken } from "@/lib/media";
import { nextStepOf } from "@/lib/next-step";
import { newLabelCode } from "@/lib/parts-data";
import { decideOverpayment, recordPaymentCore, settleJob, verifyPayment, voidPayment } from "@/lib/payments";
import { loadPlanning } from "@/lib/planning";
import { jobProfits } from "@/lib/profit";
import { refreshQuoteTotals } from "@/lib/quote-data";
import { applyCustomerResponse } from "@/lib/quote-respond";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureWorkLines, latestQc } from "@/lib/work-data";
import { addTechnician, finishMyPart, managerConfirmWork, openQcRound, pauseWork, startWorking, workBudget } from "@/lib/work-flow";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The end-to-end test of the overnight build, run from a script against the local server with the
 * E2E secret: one car from approval to gate-out, then a free comeback. Never available in production.
 * Seeds fixed ids; the clean-up SQL in the scratchpad removes them.
 */
const ID = (n: string) => `22222222-0000-4000-8000-00000000e2${n}`;
const CUST = ID("01"), VEH = ID("02"), JOB1 = ID("03"), JOB2 = ID("04"), Q1 = ID("05"), Q2 = ID("06"), PA = ID("07"), PB = ID("08"), PC = ID("09"), GI1 = ID("0a"), GI2 = ID("0b"), INV1 = ID("0c"), INV2 = ID("0d");

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || !process.env.E2E_SECRET || request.headers.get("x-e2e-secret") !== process.env.E2E_SECRET) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const admin = createAdminClient();
  const settings = await getSettings();
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  try {
    // People: the owner's real team, one per role.
    const { data: staff } = await admin.from("staff").select("id, display_name, role_id, is_head_accountant").eq("is_active", true);
    const by = (role: string, n = 0) => (staff ?? []).filter((s) => s.role_id === role)[n];
    const owner = by("owner"), advisor = by("service_advisor") ?? by("owner"), manager = by("workshop_manager") ?? by("owner"), parts = by("parts") ?? by("owner"), tech1 = by("technician", 0), tech2 = by("technician", 1) ?? by("technician", 0);
    if (!owner || !tech1) return NextResponse.json({ error: "Need an owner and a technician on the team." }, { status: 400 });
    const actor = (s: { id: string; display_name: string; role_id: string; is_head_accountant?: boolean }) => ({ id: s.id, display_name: s.display_name, role_id: s.role_id, is_head_accountant: s.is_head_accountant });
    const { data: make } = await admin.from("vehicle_makes").select("id").limit(1).maybeSingle();
    const now = new Date().toISOString();
    const today = dubaiDate();

    // 1. A car with an approved job card, assigned, sent quotation with three lines (labour, part in stock, part to order).
    await admin.from("customers").upsert({ id: CUST, customer_type: "individual", full_name: "E2E Customer", phone: "+971500000000", created_by: owner.id, updated_by: owner.id });
    await admin.from("vehicles").upsert({ id: VEH, customer_id: CUST, plate_country: "UAE", plate_emirate: "Dubai", plate_code: "E", plate_number: "20260", has_plate: true, make_id: make?.id, colour: "Black", created_by: owner.id, updated_by: owner.id });
    await admin.from("jobs").upsert({ id: JOB1, vehicle_id: VEH, customer_id: CUST, stage: "approval", status: "pending_customer_approval", priority: "normal", gated_in_by: advisor.id, first_approval_at: now, assigned_to: tech1.id, department: "mechanical", stage_entered_at: now, is_open: true, created_by: owner.id, updated_by: owner.id });
    await admin.from("gate_ins").upsert({ id: GI1, job_id: JOB1, arrived_by: "customer_drove", condition: "runs_drives", fuel_level: "half", cleanliness: "clean", mileage: 50000, keys_count: 1, customer_requests: "1. Brake noise", is_complete: true, location_type: "branch", location_name: "Main", created_by: owner.id, updated_by: owner.id });
    await admin.from("job_requests").insert([{ job_id: JOB1, position: 1, text: "Brake noise" }, { job_id: JOB1, position: 2, text: "Pulls to the left" }]);
    await admin.from("part_items").upsert([
      { id: PA, job_id: JOB1, description: "Front brake pads", part_number: "PAD-1", quantity: 1, cost_aed: 100, availability: "in_stock", confirm_status: "confirmed", confirmed_quantity: 1, order_status: "none", part_type: "genuine", created_by: parts.id, updated_by: parts.id },
      { id: PB, job_id: JOB1, description: "Front brake discs", part_number: "DISC-1", quantity: 1, cost_aed: 400, availability: "to_order", delivery_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), confirm_status: "confirmed", confirmed_quantity: 1, order_status: "none", part_type: "aftermarket", created_by: parts.id, updated_by: parts.id },
    ]);
    const token1 = newToken();
    await admin.from("quotations").upsert({ id: Q1, kind: "quotation", number: "Q-E2E-1", version: 1, job_id: JOB1, customer_id: CUST, vehicle_id: VEH, status: "sent", token: token1, sent_at: now, sent_by: advisor.id, sent_to_name: "E2E Customer", sent_to_phone: "+971500000000", completed_at: now, created_by: advisor.id, updated_by: advisor.id });
    await admin.from("quotation_lines").insert([
      { quotation_id: Q1, position: 0, line_type: "labour", title: "Replace front brake pads and discs", source_type: "manual", quantity: 1, hours: 4, labour_rate: 300, urgency: "urgent", created_by: advisor.id, updated_by: advisor.id },
      { quotation_id: Q1, position: 1, line_type: "part", title: "Front brake pads (PAD-1)", source_type: "manual", quantity: 1, unit_cost: 100, markup_percent: 50, unit_price: 150, part_item_id: PA, part_type: "genuine", created_by: advisor.id, updated_by: advisor.id },
      { quotation_id: Q1, position: 2, line_type: "part", title: "Front brake discs (DISC-1)", source_type: "manual", quantity: 1, unit_cost: 400, markup_percent: 50, unit_price: 600, part_item_id: PB, part_type: "aftermarket", created_by: advisor.id, updated_by: advisor.id },
    ]);
    await refreshQuoteTotals(Q1, settings, advisor.id);

    // 2. The customer approves: planning starts inside the Parts step.
    const r1 = await applyCustomerResponse(Q1, { approve: true, name: "E2E Customer", via: "customer" });
    check("customer approval accepted", !r1.error, r1.error);
    const job = async (id = JOB1) => (await admin.from("jobs").select("*").eq("id", id).maybeSingle()).data!;
    let j = await job();
    check("job goes to planning (waiting_parts)", j.status === "waiting_parts" && j.stage === "parts", j.status);
    const pa = (await admin.from("part_items").select("order_status, received_qty, label_code").eq("id", PA).maybeSingle()).data!;
    check("in-stock part is received with a label, no purchase order", pa.order_status === "received" && Number(pa.received_qty) === 1 && !!pa.label_code);
    let plan = await loadPlanning(j, settings);
    check("planning waits on Parts first", plan.waitingOn === "parts" && plan.circles[0].state === "amber");
    check("one part still to come (the ordered disc)", plan.missing.length === 1 && plan.unplanned.length === 0, `missing ${plan.missing.length}, unplanned ${plan.unplanned.length}`);
    check("next step says Parts plan", nextStepOf(JOB1, baseStep(j, { planningOn: plan.waitingOn })).line.includes("Parts"));

    // 3. Parts planned → the workshop manager's turn.
    await admin.from("jobs").update({ plan_parts_done_at: now, plan_parts_by: parts.id, plan_parts_ready_date: plan.partsReadyDate }).eq("id", JOB1);
    j = await job();
    plan = await loadPlanning(j, settings);
    check("then waits on the workshop manager", plan.waitingOn === "workshop" && plan.circles[0].state === "green" && plan.circles[1].state === "amber");
    check("next step names the manager", nextStepOf(JOB1, baseStep(j, { planningOn: plan.waitingOn })).actorRole === "workshop_manager");

    // 4. Released to the workshop with two technicians (started with available parts).
    await admin.from("jobs").update({ status: "in_work", stage: "work", stage_entered_at: now, plan_released_at: now, plan_released_by: manager.id, plan_start_date: today, plan_release_note: "Started with available parts", work_started_at: now }).eq("id", JOB1);
    const a1 = await addTechnician(JOB1, tech1.id, actor(manager));
    const a2 = tech2.id !== tech1.id ? await addTechnician(JOB1, tech2.id, actor(manager)) : { ok: true };
    check("technicians put on the car", !a1.error && !a2.error, a1.error ?? a2.error);
    const made = await ensureWorkLines(JOB1, manager.id);
    check("work order has the labour line only", made === 1, `made ${made}`);
    const budget = await workBudget(JOB1);
    check("time budget is 4 h charged", budget.hoursCharged === 4, String(budget.hoursCharged));
    j = await job();
    plan = await loadPlanning(j, settings);
    check("then waits on the advisor for the date, without blocking the work", plan.waitingOn === "advisor" && j.status === "in_work" && !!plan.suggestedFinish, `${plan.waitingOn} ${plan.suggestedFinish}`);
    await admin.from("jobs").update({ promised_at: plan.suggestedFinish, plan_date_confirmed_at: now, plan_date_confirmed_by: advisor.id }).eq("id", JOB1);
    j = await job();
    plan = await loadPlanning(j, settings);
    check("planning complete: three green circles", plan.waitingOn === null && plan.circles.every((c) => c.state === "green"), plan.circles.map((c) => c.state).join(","));

    // 5. Work: Working, Pause with a reason, Working again, My part is done, Job finished.
    const w1 = await startWorking(JOB1, actor(tech1));
    check("technician 1 Working", !!w1.ok, w1.error);
    if (tech2.id !== tech1.id) {
      const w2 = await startWorking(JOB1, actor(tech2));
      check("technician 2 Working at the same time", !!w2.ok, w2.error);
    }
    const pz = await pauseWork(JOB1, actor(tech1), "Waiting for parts");
    check("Pause with a reason", !!pz.ok, pz.error);
    const { data: pauses } = await admin.from("work_pauses").select("id, reason, ended_at").eq("job_id", JOB1);
    check("pause is logged", (pauses ?? []).length === 1 && pauses![0].reason === "Waiting for parts");
    const w3 = await startWorking(JOB1, actor(tech1));
    check("Working again closes the pause", !!w3.ok && !!(await admin.from("work_pauses").select("ended_at").eq("id", pauses![0].id).maybeSingle()).data?.ended_at);
    if (tech2.id !== tech1.id) {
      const f2 = await finishMyPart(JOB1, actor(tech2));
      check("My part is done waits for the other technician", !!f2.ok && (f2.message ?? "").includes("Waiting") && !(await job()).work_done_at, f2.message);
    }
    const f1 = await finishMyPart(JOB1, actor(tech1));
    check("Job finished locks the clock and tells the manager", !!f1.ok && !!(await job()).work_done_at, f1.error);
    const { data: openSessions } = await admin.from("work_sessions").select("id").eq("job_id", JOB1).is("ended_at", null);
    check("no clock still running after Job finished", (openSessions ?? []).length === 0);

    // 6. The manager sends it back with a note, then the technicians finish again.
    const sb = await managerConfirmWork(JOB1, actor(manager), false, "Brake noise still there", settings);
    check("Not done, send back", !!sb.ok && !(await job()).work_done_at && (await job()).work_sendbacks === 1, sb.error);
    const { data: jt } = await admin.from("job_technicians").select("manager_sendbacks").eq("job_id", JOB1).eq("staff_id", tech1.id).maybeSingle();
    check("send-back counted against the technician", Number(jt?.manager_sendbacks) === 1);
    await startWorking(JOB1, actor(tech1));
    if (tech2.id !== tech1.id) await finishMyPart(JOB1, actor(tech2));
    await finishMyPart(JOB1, actor(tech1));
    check("Job finished again", !!(await job()).work_done_at);
    const blocked = await managerConfirmWork(JOB1, actor(manager), true, null, settings);
    check("cannot confirm while a part was never handed over", !!blocked.error && /handed/.test(blocked.error ?? ""), blocked.error);
    // The disc arrives and is handed over with one PIN (recorded as the handover would).
    await admin.from("part_items").update({ order_status: "received", received_qty: 1, label_code: newLabelCode() }).eq("id", PB);
    const { data: ho } = await admin.from("part_handovers").insert({ job_id: JOB1, kind: "handover", from_staff: parts.id, to_staff: tech1.id, confirmed_by: tech1.id, pin_used: true, items: [{ id: PA, description: "Front brake pads", quantity: 1 }, { id: PB, description: "Front brake discs", quantity: 1 }], created_by: parts.id, updated_by: parts.id }).select("id").single();
    await admin.from("part_items").update({ issue_status: "confirmed", issued_qty: 1, issued_at: now, issued_by: parts.id, issue_confirmed_at: now, issue_confirmed_by: tech1.id, handover_id: ho?.id ?? null }).in("id", [PA, PB]);
    const ok1 = await managerConfirmWork(JOB1, actor(manager), true, null, settings);
    check("Confirmed, send to QC", !!ok1.ok && (await job()).status === "pending_qc", ok1.error);
    let qc = await latestQc(JOB1);
    check("QC round 1 opened with the job's items", !!qc && qc.status === "open" && qc.round === 1 && qc.items.length >= 5, `${qc?.items.length}`);

    // 7. QC fails one item: back to Work, counted against the technicians; then passes on round 2.
    const failItem = qc!.items[0];
    await admin.from("qc_checks").update({ status: "failed", finished_at: now, items: qc!.items.map((i) => (i.key === failItem.key ? { ...i, result: "fail", remark: "Still noisy" } : { ...i, result: "pass" })) }).eq("id", qc!.id);
    await admin.from("jobs").update({ status: "in_work", stage: "work", rework_count: 1, work_done_at: null }).eq("id", JOB1);
    await admin.from("job_technicians").update({ done_at: null, qc_sendbacks: 1 }).eq("job_id", JOB1);
    await startWorking(JOB1, actor(tech1));
    if (tech2.id !== tech1.id) await finishMyPart(JOB1, actor(tech2));
    await finishMyPart(JOB1, actor(tech1));
    const ok2 = await managerConfirmWork(JOB1, actor(manager), true, null, settings);
    qc = await latestQc(JOB1);
    check("QC round 2 lists only the failed item", !!ok2.ok && !!qc && qc.round === 2 && qc.items.length === 1, `${qc?.round} ${qc?.items.length}`);
    await admin.from("qc_checks").update({ status: "passed", finished_at: now, items: qc!.items.map((i) => ({ ...i, result: "pass" })) }).eq("id", qc!.id);
    await admin.from("jobs").update({ status: "pending_wash", stage: "wash", stage_entered_at: now, wash_sent_at: null }).eq("id", JOB1);
    const summary = await recordJobSummary(JOB1, "E2E", "mechanical", settings);
    check("job summary built at QC pass", summary.qcRounds === 2 && summary.managerSendbacks === 1 && summary.hoursCharged === 4 && !!(await job()).summary_verdict, `${summary.verdict}: ${summary.reasons.join("; ")}`);
    check("verdict is acceptable or needs a talk (one QC fail, one send-back)", summary.verdict !== "good", summary.verdict);
    const openRound = await openQcRound(JOB1, owner.id, settings);
    check("opening a QC round when one is closed makes round 3 (A1)", openRound === 3, String(openRound));
    await admin.from("qc_checks").update({ is_active: false }).eq("job_id", JOB1).eq("round", 3);

    // 8. Wash: waits for the advisor, then at the wash, then Ready.
    j = await job();
    check("next step: advisor sends to wash", nextStepOf(JOB1, baseStep(j, { washSentAt: null })).line.includes("Ready for wash"));
    await admin.from("jobs").update({ wash_sent_at: now, wash_sent_by: advisor.id }).eq("id", JOB1);
    await admin.from("washes").upsert({ job_id: JOB1, done_by: advisor.id, done_at: now, skipped: false, created_by: advisor.id, updated_by: advisor.id }, { onConflict: "job_id" });
    await admin.from("jobs").update({ status: "ready", stage: "ready", stage_entered_at: now }).eq("id", JOB1);

    // 9. Invoice from the approved quotation; the balance; payments with every rule.
    const draft = await buildInvoiceDraft(JOB1, settings, { labourMode: "itemised" });
    check("invoice draft has the labour line and two parts with their types", draft.lines.length === 3 && draft.lines.filter((l) => l.section === "parts").every((l) => /genuine|aftermarket/i.test(l.details ?? "")), draft.lines.map((l) => `${l.section}:${l.details}`).join("|"));
    const number1 = await nextDocumentNumber("tax_invoice", settings);
    const tok1 = newToken();
    await admin.from("invoices").upsert({ id: INV1, number: number1, kind: "tax_invoice", job_id: JOB1, customer_id: CUST, vehicle_id: VEH, token: tok1, labour_mode: "itemised", subtotal_aed: draft.totals.gross, discount_aed: draft.totals.discount, taxable_aed: draft.totals.taxable, vat_aed: draft.totals.vat, total_aed: draft.totals.total, warranty_credit_aed: 0, prepared_by: advisor.id, issued_by: owner.id, created_by: owner.id, updated_by: owner.id });
    await admin.from("invoice_lines").insert(draft.lines.map((l, i) => ({ invoice_id: INV1, position: i, section: l.section, description: l.description, details: l.details, part_number: l.part_number, quantity: l.quantity, unit_price: l.unit_price, amount_aed: l.amount_aed, vat_aed: Math.round(l.amount_aed * 5) / 100, total_aed: Math.round(l.amount_aed * 105) / 100, cost_aed: l.cost_aed, quotation_line_id: l.quotation_line_id, part_item_id: l.part_item_id, created_by: owner.id, updated_by: owner.id })));
    await admin.from("jobs").update({ status: "pending_payment", ready_token: tok1 }).eq("id", JOB1);
    const total = draft.totals.total;
    const pay1 = await recordPaymentCore(actor(advisor), { invoiceId: INV1, jobId: JOB1, method: "cash", amount: 100, clientKey: "e2e-k1" }, settings);
    check("advisor records a partial cash payment", !!pay1.ok && !!pay1.number, pay1.error);
    const pay1again = await recordPaymentCore(actor(advisor), { invoiceId: INV1, jobId: JOB1, method: "cash", amount: 100, clientKey: "e2e-k1" }, settings);
    check("the same tap twice gives the same receipt (K3)", pay1again.number === pay1.number && !pay1again.error, pay1again.message);
    const dup = await recordPaymentCore(actor(advisor), { invoiceId: INV1, jobId: JOB1, method: "cash", amount: 100 }, settings);
    check("an identical payment within a minute is refused (K3)", !!dup.error && /recorded a moment ago/.test(dup.error), dup.error);
    const { count: receipts } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("invoice_id", INV1).eq("status", "recorded");
    check("exactly one receipt so far", receipts === 1, String(receipts));
    const verifyRow = (await admin.from("payments").select("verified_at").eq("id", pay1.paymentId!).maybeSingle()).data;
    check("advisor's payment waits for accounts to verify (K8)", !verifyRow?.verified_at);
    const over = await recordPaymentCore(actor(advisor), { invoiceId: INV1, jobId: JOB1, method: "card", amount: total + 500, clientKey: "e2e-k2" }, settings);
    check("more than the balance waits for the owner (K4)", !!over.pendingOwner, over.error ?? over.message);
    const refused = await decideOverpayment(over.paymentId!, actor(owner), false, "Too much");
    check("the owner refuses it: voided, never deleted (K5)", !!refused.ok && (await admin.from("payments").select("status").eq("id", over.paymentId!).maybeSingle()).data?.status === "voided");
    const rest = await recordPaymentCore(actor(owner), { invoiceId: INV1, jobId: JOB1, method: "card", amount: Math.round((total - 100) * 100) / 100, clientKey: "e2e-k3" }, settings);
    check("the owner records the rest by card", !!rest.ok, rest.error);
    check("paid in full releases the car (K9)", (await job()).status === "ready", (await job()).status);
    const v = await verifyPayment(pay1.paymentId!, actor(owner));
    check("accounts verify the advisor's payment", !!v.ok, v.error);
    const voided = await voidPayment(pay1.paymentId!, actor(owner), "Recorded against the wrong car");
    check("voiding a receipt reopens the balance", !!voided.ok && (await job()).status === "pending_payment", voided.error);
    const again = await recordPaymentCore(actor(owner), { invoiceId: INV1, jobId: JOB1, method: "cash", amount: 100, clientKey: "e2e-k4" }, settings);
    check("paid again in full", !!again.ok && (await job()).status === "ready", again.error);
    const { data: allPays } = await admin.from("payments").select("number, status").eq("invoice_id", INV1);
    check("every receipt kept, two voided", (allPays ?? []).length === 4 && (allPays ?? []).filter((p) => p.status === "voided").length === 2, JSON.stringify(allPays));
    await settleJob(JOB1, INV1, owner.id);

    // 10. Gate-out, then the car comes back: a free comeback for our workmanship.
    await admin.from("jobs").update({ status: "closed", is_open: false, gated_out_at: now, gated_out_by: advisor.id }).eq("id", JOB1);
    await admin.from("jobs").upsert({ id: JOB2, vehicle_id: VEH, customer_id: CUST, stage: "approval", status: "pending_customer_approval", priority: "high", gated_in_by: advisor.id, first_approval_at: now, assigned_to: tech1.id, department: "mechanical", stage_entered_at: now, is_open: true, comeback_of: JOB1, comeback_cause: "workmanship", comeback_cause_by: manager.id, comeback_cause_at: now, comeback_confirmed_by: owner.id, comeback_confirmed_at: now, comeback_free: true, created_by: owner.id, updated_by: owner.id });
    await admin.from("gate_ins").upsert({ id: GI2, job_id: JOB2, arrived_by: "customer_drove", condition: "runs_drives", fuel_level: "half", cleanliness: "clean", mileage: 50300, keys_count: 1, customer_requests: "1. Brake noise again", is_complete: true, location_type: "branch", location_name: "Main", created_by: owner.id, updated_by: owner.id });
    await admin.from("part_items").upsert({ id: PC, job_id: JOB2, description: "Front brake pads", part_number: "PAD-1", quantity: 1, cost_aed: 100, availability: "in_stock", confirm_status: "confirmed", confirmed_quantity: 1, order_status: "none", part_type: "genuine", created_by: parts.id, updated_by: parts.id });
    await admin.from("quotations").upsert({ id: Q2, kind: "quotation", number: "Q-E2E-2", version: 1, job_id: JOB2, customer_id: CUST, vehicle_id: VEH, status: "draft", token: newToken(), completed_at: now, created_by: advisor.id, updated_by: advisor.id });
    await admin.from("quotation_lines").insert([
      { quotation_id: Q2, position: 0, line_type: "labour", title: "Redo front brakes", source_type: "manual", quantity: 1, hours: 2, labour_rate: 300, created_by: advisor.id, updated_by: advisor.id },
      { quotation_id: Q2, position: 1, line_type: "part", title: "Front brake pads (PAD-1)", source_type: "manual", quantity: 1, unit_cost: 100, markup_percent: 50, unit_price: 150, part_item_id: PC, part_type: "genuine", created_by: advisor.id, updated_by: advisor.id },
    ]);
    await refreshQuoteTotals(Q2, settings, advisor.id);
    const r2 = await applyCustomerResponse(Q2, { approve: true, name: "Warranty repair (owner)", by: owner.id, via: "warranty" });
    check("warranty repair approved without the customer (L3)", !r2.error && (await job(JOB2)).status === "waiting_parts", r2.error);
    const draft2 = await buildInvoiceDraft(JOB2, settings, { labourMode: "itemised" });
    check("comeback invoice shows the work then a zero total (L3)", draft2.totals.gross > 0 && draft2.totals.warrantyCredit === draft2.totals.gross && draft2.totals.total === 0, `${draft2.totals.gross} ${draft2.totals.warrantyCredit} ${draft2.totals.total}`);
    const number2 = await nextDocumentNumber("tax_invoice", settings);
    await admin.from("invoices").upsert({ id: INV2, number: number2, kind: "tax_invoice", job_id: JOB2, customer_id: CUST, vehicle_id: VEH, token: newToken(), labour_mode: "itemised", subtotal_aed: draft2.totals.gross, discount_aed: 0, taxable_aed: 0, vat_aed: 0, total_aed: 0, warranty_credit_aed: draft2.totals.warrantyCredit, prepared_by: advisor.id, issued_by: owner.id, created_by: owner.id, updated_by: owner.id });
    await admin.from("invoice_lines").insert(draft2.lines.map((l, i) => ({ invoice_id: INV2, position: i, section: l.section, description: l.description, details: l.details, part_number: l.part_number, quantity: l.quantity, unit_price: l.unit_price, amount_aed: l.amount_aed, vat_aed: 0, total_aed: l.amount_aed, cost_aed: l.cost_aed, quotation_line_id: l.quotation_line_id, part_item_id: l.part_item_id, created_by: owner.id, updated_by: owner.id })));
    const profits = await jobProfits(settings, { jobIds: [JOB1, JOB2] });
    const p1 = profits.find((p) => p.invoice.job_id === JOB1), p2 = profits.find((p) => p.invoice.job_id === JOB2);
    check("comeback invoice is a loss, flagged as our fault (L4)", !!p2 && p2.profit < 0 && !!p2.comeback?.ours, `${p2?.profit} ${JSON.stringify(p2?.comeback)}`);
    check("original job shows profit after comeback (L4)", !!p1 && p1.profitAfterComeback !== null && p1.profitAfterComeback < p1.profit, `${p1?.profit} → ${p1?.profitAfterComeback}`);
  } catch (e) {
    check("no crash", false, e instanceof Error ? e.message + "\n" + e.stack : String(e));
  }
  return NextResponse.json({ passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, checks });
}

type JobLike = { status: string; is_open: boolean; assigned_to: string | null; first_approval_at: string | null; gated_in_at: string; stage_entered_at: string; work_done_at: string | null };
function baseStep(j: JobLike, extra: Record<string, unknown>) {
  return { status: j.status as never, is_open: j.is_open, assigned_to: j.assigned_to, first_approval_at: j.first_approval_at, gated_in_at: j.gated_in_at, stage_entered_at: j.stage_entered_at, assigneeName: "Tech", advisorName: "Advisor", managerLabel: "the workshop manager", inspection: null, roadTest: null, approval: null, gateInComplete: true, extra: { workFinishedAt: j.work_done_at, ...extra } };
}
