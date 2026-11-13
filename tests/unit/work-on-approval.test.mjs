// Section 1 of 13 November 2026 (work starts on approval): THE rules.
//   node --import ./tests/unit/register.mjs tests/unit/work-on-approval.test.mjs        (npm run test:unit)
const { readinessOf } = await import("../../src/lib/jobs-to-do.ts");
const { scopeFromRequests } = await import("../../src/lib/inspection-scope.ts");
const nudge = await import("../../src/lib/lpo-nudge-rules.ts");
const head = await import("../../src/lib/approval-headline-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const part = (state, when = null, name = "ENGINE MOUNT") => ({ id: name, name, state, when });

check("no parts: READY TO START", readinessOf({ parts: [], done: false }).words === "READY TO START");
check("every part here: READY TO START", readinessOf({ parts: [part("here")], done: false }).kind === "ready");
check("a part arriving: WAITING FOR PART with the day", readinessOf({ parts: [part("arriving", "2026-11-14")], done: false }).words === "WAITING FOR PART: ENGINE MOUNT, 2026-11-14");
check("not ordered yet says so; more parts counted", readinessOf({ parts: [part("not_ordered"), part("arriving", "2026-11-15", "BELT")], done: false }).words === "WAITING FOR PART: ENGINE MOUNT, not ordered yet (+1 more)");
check("Start anyway turns it into a start (dismantle and prepare)", readinessOf({ parts: [part("arriving", "2026-11-14")], done: false, startAnyway: { by: "x", at: "y" } }).kind === "anyway");
check("a done line has no tag", readinessOf({ parts: [part("arriving")], done: true }).kind === "done");
check("the inspection type from a clear request", scopeFromRequests(["FULL INSPECTION", "AC not cold"]) === "full" && scopeFromRequests(["Pre-purchase check"]) === "pre_purchase" && scopeFromRequests(["AC not cold"]) === null);
const now = Date.parse("2026-11-13T10:00:00Z");
check("no nudge before 30 minutes", !nudge.nudgeDue("2026-11-13T09:40:00Z", null, now));
check("first nudge at 30 minutes, then every 30 minutes", nudge.nudgeDue("2026-11-13T09:25:00Z", null, now) && !nudge.nudgeDue("2026-11-13T08:00:00Z", "2026-11-13T09:45:00Z", now) && nudge.nudgeDue("2026-11-13T08:00:00Z", "2026-11-13T09:30:00Z", now));
check("a decline the customer later reversed never shows", head.headlineFrom({ declinedOutAt: "x", approvedAfterDecline: true, approved: 30, total: 30 }).kind === null);
check("a decline that stands shows", head.headlineFrom({ declinedOutAt: "x", approvedAfterDecline: false, approved: 0, total: 0 }).words === "Declined, car going out");
check("part approval: APPROVED IN PART: n OF m ITEMS", head.headlineFrom({ declinedOutAt: null, approvedAfterDecline: false, approved: 12, total: 30 }).words === "APPROVED IN PART: 12 OF 30 ITEMS");

process.exit(failed ? 1 : 0);
