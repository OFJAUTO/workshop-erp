// "Urgent" must mean urgent (9 November 2026): THE rule in src/lib/urgent-rule.ts.
//   node --import ./tests/unit/register.mjs tests/unit/urgent-rule.test.mjs        (npm run test:unit)
const { urgentReason, waitingHeader, customerWaitHoursOf, CUSTOMER_WAITS_IN } = await import("../../src/lib/urgent-rule.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const day = "2026-11-09T08:00:00Z";

check("nothing special: not urgent", urgentReason({ status: "in_work" }, 4) === null);
check("an old task alone is not urgent", urgentReason({ status: "in_work", waitedHours: 40 }, 4) === null);
check("money at risk names the money", urgentReason({ status: "ready", money: "AED 500.00 still owed" }, 4) === "Money at risk: AED 500.00 still owed");
const passed = urgentReason({ status: "in_work", promisedAt: day, hoursToPromise: -1 }, 4);
check("a passed promised date before Ready", /^Promised date passed \(Mon 9 Nov\)$/.test(passed ?? ""), passed);
check("a passed promise on a car already Ready is not that reason", urgentReason({ status: "ready", promisedAt: day, hoursToPromise: -1 }, 4) === null);
const risk = urgentReason({ status: "in_work", promisedAt: day, hoursToPromise: 2.5 }, 4);
check("due within 4 working hours, still in work: at risk", /^Promised date at risk .*2\.5 h left/.test(risk ?? ""), risk);
check("due within 4 working hours, already at QC: not at risk", urgentReason({ status: "pending_qc", promisedAt: day, hoursToPromise: 2 }, 4) === null);
check("due in 2 days: not at risk", urgentReason({ status: "in_work", promisedAt: day, hoursToPromise: 18 }, 4) === null);
check("customer waiting 5 h (limit 4)", /^Customer waiting 5 h \(over 4 working hours\)$/.test(urgentReason({ status: "pending_quote", customerWaiting: true, waitedHours: 5 }, 4) ?? ""));
check("customer waiting 3 h (limit 4): not yet", urgentReason({ status: "pending_quote", customerWaiting: true, waitedHours: 3 }, 4) === null);
check("the owner's own limit counts", urgentReason({ customerWaiting: true, waitedHours: 3 }, 2) !== null);
check("money first when several reasons", /^Money/.test(urgentReason({ status: "in_work", money: "x", promisedAt: day, hoursToPromise: -1 }, 4) ?? ""));
check("header with urgent", waitingHeader(41, 6) === "41 waiting · 6 urgent");
check("header without urgent", waitingHeader(41, 0) === "41 waiting");
check("default limit 4", customerWaitHoursOf({}) === 4 && customerWaitHoursOf({ urgent_customer_wait_hours: 6 }) === 6);
check("work and parts are covered by the promised date, not the waiting hours", !CUSTOMER_WAITS_IN.has("in_work") && !CUSTOMER_WAITS_IN.has("waiting_parts") && CUSTOMER_WAITS_IN.has("pending_quote"));

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
