// The bell only counts what is still open + promised dates (9 November 2026): src/lib/bell-rules.ts, src/lib/promise-dates.ts.
//   node --import ./tests/unit/register.mjs tests/unit/bell-promise.test.mjs        (npm run test:unit)
const { isActionType, taskStillOpen, hrefId } = await import("../../src/lib/bell-rules.ts");
const { promiseState, partsLaterWarning, readPromise, promiseEventWords } = await import("../../src/lib/promise-dates.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const job = (o = {}) => ({ status: "in_work", is_open: true, assigned_to: null, promised_at: null, plan_date_confirmed_at: null, ready_sent_at: null, inspection_fee_request_aed: null, followup_due_at: null, followup_done_at: null, ...o });

check("an LPO to approve is an action", isActionType("po_approval"));
check("a scan that arrived is information", !isActionType("scan_received") && !isActionType("quote_opened") && !isActionType("approval_opened"));
check("LPO approved: the notice clears", !taskStillOpen("po_approval", { po: { status: "approved", supplier_invoice_status: null, invoice_check: null } }));
check("LPO still waiting: open", taskStillOpen("po_approval", { po: { status: "pending_approval", supplier_invoice_status: null, invoice_check: null } }));
check("car assigned: the assignment notice clears", !taskStillOpen("job_awaiting_assignment", { job: job({ status: "pending_inspection", assigned_to: "x" }) }));
check("car not assigned: open", taskStillOpen("job_awaiting_assignment", { job: job({ status: "pending_inspection" }) }));
check("any car task clears once the car has left", !taskStillOpen("wash", { job: job({ status: "closed", is_open: false }) }));
check("wash done: clears", !taskStillOpen("wash", { job: job({ status: "ready" }) }) && taskStillOpen("wash", { job: job({ status: "pending_wash" }) }));
check("reported payment recorded: clears", !taskStillOpen("payment_reported", { report: { status: "recorded" } }) && taskStillOpen("payment_reported", { report: { status: "waiting" } }));
check("proforma sent: car_ready clears", !taskStillOpen("car_ready", { job: job({ status: "ready", ready_sent_at: "2026-11-09" }) }));
check("a manual action stays until read", taskStillOpen("owner_approval_needed", {}));
check("hrefId reads an LPO id", hrefId("/parts/orders/0f1e2d3c-1111-4222-8333-444455556666?x=1", "po") === "0f1e2d3c-1111-4222-8333-444455556666");

check("promise: overdue", promiseState("2026-11-08", "in_work", "2026-11-09") === "overdue");
check("promise: due today", promiseState("2026-11-09", "waiting_parts", "2026-11-09") === "due_today");
check("promise: a car already Ready is never overdue", promiseState("2026-11-01", "ready", "2026-11-09") === null);
check("promise: no date = nothing (stage targets never count)", promiseState(null, "in_work", "2026-11-09") === null);
check("parts later than the date: warned", /expected on 2026-11-12/.test(partsLaterWarning("2026-11-10", "2026-11-12") ?? ""));
check("parts before the date: no warning", partsLaterWarning("2026-11-12", "2026-11-10") === null);
const f = (o) => ({ get: (k) => o[k] ?? null });
check("the date is required", !!readPromise(f({}), null, "2026-11-09").error);
check("a past date is refused", !!readPromise(f({ promised_at: "2026-11-01" }), null, "2026-11-09").error);
check("a first date needs no reason", !readPromise(f({ promised_at: "2026-11-12" }), null, "2026-11-09").error);
check("changing a date needs a reason", /why it changes/.test(readPromise(f({ promised_at: "2026-11-14" }), "2026-11-12", "2026-11-09").error ?? ""));
const ok = readPromise(f({ promised_at: "2026-11-14", promised_time: "14:00", promise_reason: "parts late" }), "2026-11-12", "2026-11-09");
check("with a reason it saves, time kept", !ok.error && ok.changed && ok.value.time === "14:00");
check("the history names old, new and why", promiseEventWords("2026-11-12", ok.value, "Kevin", "release") === "Promised date 2026-11-12 → 2026-11-14 14:00: parts late (Kevin, release)");

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
