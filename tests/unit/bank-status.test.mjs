// Money waiting for the bank (9 November 2026, Section 2): THE rules in src/lib/bank-status.ts.
//   node --import ./tests/unit/register.mjs tests/unit/bank-status.test.mjs        (npm run test:unit)
const { awaitsBank, countsAsPaid, chequeNotDue, transferArrival, pendingLine, duplicateWords, zohoPayDay } = await import("../../src/lib/bank-status.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

check("a cheque waits until cleared", awaitsBank({ method: "cheque", cheque_status: "pending" }) && !countsAsPaid({ method: "cheque", cheque_status: "pending" }));
check("a cleared cheque counts", countsAsPaid({ method: "cheque", cheque_status: "cleared" }));
check("a new transfer waits", awaitsBank({ method: "transfer", cheque_status: "pending" }) && !countsAsPaid({ method: "transfer", cheque_status: "pending" }));
check("an old transfer (no status) counts as before", countsAsPaid({ method: "transfer", cheque_status: null }) && !awaitsBank({ method: "transfer", cheque_status: null }));
check("a bounced one counts for nothing", !countsAsPaid({ method: "cheque", cheque_status: "bounced" }) && !countsAsPaid({ method: "transfer", cheque_status: "bounced" }));
check("cash and card count", countsAsPaid({ method: "cash", cheque_status: null }) && countsAsPaid({ method: "card", cheque_status: null }));
check("post-dated: due on its date", chequeNotDue("2026-11-12", "2026-11-09") === "due on 12 Nov 2026");
check("dated today or before: can go in", chequeNotDue("2026-11-09", "2026-11-09") === null && chequeNotDue("2026-11-02", "2026-11-09") === null);
check("transfer arrived short", JSON.stringify(transferArrival(1000, 980)) === JSON.stringify({ kind: "less", difference: 20 }));
check("transfer arrived over", JSON.stringify(transferArrival(500, 520)) === JSON.stringify({ kind: "more", difference: 20 }));
check("transfer exact", transferArrival(500, 500.001).kind === "exact");
const line = pendingLine({ paid: 0, pending: [{ method: "cheque", number: "RCT-00058", amount: 2131.5 }], balance: 2131.5 });
check("the owner's pending words", line === "Paid 0.00 · Cheque pending 2,131.50 (RCT-00058) · Balance once cleared 0.00", line ?? "");
check("nothing pending: no words", pendingLine({ paid: 10, pending: [], balance: 0 }) === null);
check("duplicate warning in the owner's words", duplicateWords([{ method: "cheque", number: "RCT-00058", amount: 2131.5 }], 2131.5) === "A cheque for AED 2,131.50 is already pending (RCT-00058). Record another anyway?");
check("no warning when the pending money does not cover the balance", duplicateWords([{ method: "cheque", number: "RCT-1", amount: 100 }], 2131.5) === null);
const base = { received_at: "2026-11-02T08:00:00Z", cleared_at: "2026-11-09T08:00:00Z" };
check("Zoho day: before the change a pending cheque is not posted", zohoPayDay({ method: "cheque", cheque_status: "pending", ...base }, false) === null);
check("Zoho day: after the change a pending cheque posts on receipt (Undeposited Funds)", zohoPayDay({ method: "cheque", cheque_status: "pending", ...base }, true) === base.received_at);
check("Zoho day: a posted cheque in a posting row: receipt day", zohoPayDay({ method: "cheque", cheque_status: "cleared", settlement_id: "x", ...base }, true) === base.received_at);
check("Zoho day: an old cleared cheque: its clearing day", zohoPayDay({ method: "cheque", cheque_status: "cleared", settlement_id: null, ...base }, true) === base.cleared_at);
check("Zoho day: a bounced one is not posted", zohoPayDay({ method: "transfer", cheque_status: "bounced", ...base }, true) === null);
check("Zoho day: cash on receipt", zohoPayDay({ method: "cash", cheque_status: null, ...base }, false) === base.received_at);

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
