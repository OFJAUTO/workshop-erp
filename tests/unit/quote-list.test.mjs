// Section 6 of 13 November 2026 (the Estimates and Quotations lists): THE rules.
//   node --import ./tests/unit/register.mjs tests/unit/quote-list.test.mjs        (npm run test:unit)
const r = await import("../../src/lib/quote-list-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const NOW = Date.parse("2026-11-13T12:00:00Z");
const ago = (d) => new Date(NOW - d * 86_400_000).toISOString();
const base = { status: "draft", carried: false, handback: false, withDesk: 0, lineCount: 2, createdAt: ago(1), sentAt: null, respondedAt: null };

check("draft and pending owner are Preparing", r.tabOf(base) === "preparing" && r.tabOf({ ...base, status: "pending_owner" }) === "preparing");
check("sent, opened, urgent-only asked are Sent", ["sent", "opened", "urgent_requested"].every((s) => r.tabOf({ ...base, status: s }) === "sent"));
check("approved is Approved; carried, declined, expired, cancelled are Closed", r.tabOf({ ...base, status: "approved" }) === "approved" && r.tabOf({ ...base, status: "approved", carried: true }) === "closed" && ["declined", "expired", "cancelled"].every((s) => r.tabOf({ ...base, status: s }) === "closed"));
check("ready to send: a draft with lines and nothing on the desk", r.readyToSend(base) && !r.readyToSend({ ...base, withDesk: 1 }) && !r.readyToSend({ ...base, lineCount: 0 }) && !r.readyToSend({ ...base, status: "pending_owner" }));
const tags = (f) => r.tagsOf(f).map((t) => t.key).join(",");
check("tags: Ready to send", tags(base) === "ready");
check("tags: With parts desk (2)", r.tagsOf({ ...base, withDesk: 2 }).find((t) => t.key === "desk")?.words === "With parts desk (2)");
check("tags: Waiting for owner", tags({ ...base, status: "pending_owner" }) === "owner");
check("tags: Opened by customer", tags({ ...base, status: "opened", sentAt: ago(1) }) === "opened");
check("age: today, 1 day, 3 days", r.ageTag(base, NOW).words === "1 day" && r.ageTag({ ...base, createdAt: ago(0) }, NOW).words === "today" && r.ageTag({ ...base, createdAt: ago(3) }, NOW).words === "3 days");
check("age turns red at 2 days (preparing, sent), 7 days (approved)", r.ageTag({ ...base, createdAt: ago(2) }, NOW).red && !r.ageTag(base, NOW).red && !r.ageTag({ ...base, status: "approved", respondedAt: ago(5) }, NOW).red && r.ageTag({ ...base, status: "approved", respondedAt: ago(7) }, NOW).red);
check("sent rows age from the send", r.ageTag({ ...base, status: "sent", createdAt: ago(10), sentAt: ago(1) }, NOW).days === 1);
const rows = [{ number: "E-3", facts: { ...base, createdAt: ago(1) } }, { number: "E-1", facts: { ...base, createdAt: ago(5) } }, { number: "E-2", facts: { ...base, createdAt: ago(3) } }];
check("oldest waiting first", r.oldestFirst(rows).map((x) => x.number).join(",") === "E-1,E-2,E-3");
check("search: number, plate with or without spaces, VIN, customer", r.listSearchHit(["E-00092", "DUBAI D 93511 · BENTLEY", "SCBZK"], "e-00092") && r.listSearchHit(["DUBAI D 93511 · BENTLEY"], "d93511") && r.listSearchHit(["SCBZK25E3MC012345"], "MC012345") && r.listSearchHit(["Some Company LLC"], "company") && !r.listSearchHit(["E-00092"], "Q-00001"));
check("advisors open on Mine, others on All", r.readWho(undefined, "service_advisor") === "mine" && r.readWho(undefined, "owner") === "all" && r.readWho("all", "service_advisor") === "all");
check("tab param: unknown is Preparing", r.readTab(undefined) === "preparing" && r.readTab("closed") === "closed" && r.readTab("x") === "preparing");
check("owner-approved unsent: after 2 days, until sent", r.ownerApprovedUnsent({ status: "draft", carried: false, ownerApprovedAt: ago(3), sentAt: null }, NOW) && !r.ownerApprovedUnsent({ status: "draft", carried: false, ownerApprovedAt: ago(1), sentAt: null }, NOW) && !r.ownerApprovedUnsent({ status: "sent", carried: false, ownerApprovedAt: ago(3), sentAt: ago(1) }, NOW));
check("reminder: ready and untouched 2 days, then every 2 days", r.readyReminderDue({ ...base, updatedAt: ago(2.1) }, null, NOW) && !r.readyReminderDue({ ...base, updatedAt: ago(1) }, null, NOW) && !r.readyReminderDue({ ...base, updatedAt: ago(3) }, ago(1), NOW) && r.readyReminderDue({ ...base, updatedAt: ago(5) }, ago(2.5), NOW) && !r.readyReminderDue({ ...base, updatedAt: ago(5), withDesk: 1 }, null, NOW));

console.log(`${failed ? "FAILED" : "passed"}: ${failed} failed`);
process.exit(failed ? 1 : 0);
