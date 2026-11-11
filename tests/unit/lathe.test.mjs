// Outsourced lathe work (9 November 2026, Section 8): THE rules in src/lib/lathe-rules.ts.
//   node --import ./tests/unit/register.mjs tests/unit/lathe.test.mjs        (npm run test:unit)
const { parsePriceList, latheCost, customerServiceName, minimumPrice, skipsLpo, nextTicket, splitBill, billProblem, ticketStatus, unbilledTooLong } = await import("../../src/lib/lathe-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const list = parsePriceList("Brake disc | 80\nFlywheel | 150-250\nDrum | 60 | Brake drum resurfacing\nbad line");
check("three items read, the bad line left out", list.length === 3, JSON.stringify(list));
check("a range costs the highest", latheCost(list[1]) === 250);
check("the customer's words: given, else '<item> resurfacing'", customerServiceName(list[2]) === "Brake drum resurfacing" && customerServiceName(list[0]) === "Brake disc resurfacing");
check("at least 3 × the cost at 200%", minimumPrice(80, 200) === 240);
check("under AED 200 of cost skips the LPO", skipsLpo(80, 2, 200) && !skipsLpo(250, 1, 200) && !skipsLpo(100, 2, 200));
check("ticket numbers", nextTicket(null) === "SUB-00001" && nextTicket("SUB-00041") === "SUB-00042");
const t = [{ partId: "a", estimate: 160, typed: null }, { partId: "b", estimate: 250, typed: null }];
const split = splitBill(400, 0, t);
check("a bill shared by estimate adds up exactly", Math.abs((split.get("a") ?? 0) + (split.get("b") ?? 0) - 400) < 0.001, JSON.stringify([...split]));
const typed = splitBill(350, 30, [{ partId: "a", estimate: 160, typed: 140 }, { partId: "b", estimate: 250, typed: 180 }]);
check("itemised amounts are kept", typed.get("a") === 140 && typed.get("b") === 180);
check("typed amounts must add up to the bill less the extra lines", (billProblem(350, 30, [{ partId: "a", estimate: 1, typed: 100 }, { partId: "b", estimate: 1, typed: 100 }]) ?? "").includes("AED 320.00"));
check("no tickets ticked is allowed, warned in the confirm (11 Nov)", billProblem(100, 0, []) === null);
check("status Sent → Back → Billed", ticketStatus({ lathe_sent_at: "x", lathe_back_at: null, lathe_bill_id: null }) === "Sent" && ticketStatus({ lathe_sent_at: "x", lathe_back_at: "y", lathe_bill_id: null }) === "Back" && ticketStatus({ lathe_sent_at: "x", lathe_back_at: "y", lathe_bill_id: "z" }) === "Billed");
check("not billed after a month is flagged", unbilledTooLong("2026-10-01T08:00:00Z", false, Date.parse("2026-11-09T08:00:00Z")) && !unbilledTooLong("2026-11-01T08:00:00Z", false, Date.parse("2026-11-09T08:00:00Z")));

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
