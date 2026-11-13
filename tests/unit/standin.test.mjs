// Approvals stand-in (13 November 2026, Section 15): THE rules.
//   node --import ./tests/unit/register.mjs tests/unit/standin.test.mjs        (npm run test:unit)
const { readStandIn, standInActive, standInMay, moneyOf, onBehalfName, standInNotice, summaryWords } = await import("../../src/lib/standin-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const kinds = ["quote", "lpo", "void"];
const s = readStandIn({ staffId: "p1", staffName: "Peter", from: "2026-11-13", until: "2026-11-20", types: { quote: { on: true, limit: 5000 }, lpo: { on: true, limit: null }, bogus: { on: true } } }, kinds);
const peter = { id: "p1", display_name: "Peter", full_name: "Peter Paul" };

check("unknown types are dropped, missing ones are off", !("bogus" in s.types) && s.types.void.on === false);
check("active only between the two dates, never after End now", standInActive(s, "2026-11-13") && standInActive(s, "2026-11-20") && !standInActive(s, "2026-11-21") && !standInActive(s, "2026-11-12") && !standInActive({ ...s, endedAt: "2026-11-14T08:00:00Z" }, "2026-11-15"));
check("money words read back", moneyOf("AED 4,999.50") === 4999.5 && moneyOf(null) === 0);
check("a ticked type within the limit: yes", standInMay(s, { kind: "quote", money: "AED 4,999.99", askedBy: "Arsalan" }, peter, "2026-11-14").ok);
check("above the limit: waits for the owner", !standInMay(s, { kind: "quote", money: "AED 5,000.01", askedBy: "Arsalan" }, peter, "2026-11-14").ok);
check("no limit on that type: any amount", standInMay(s, { kind: "lpo", money: "AED 90,000.00", askedBy: "Parts" }, peter, "2026-11-14").ok);
check("a type not sent: waits for the owner", !standInMay(s, { kind: "void", money: null, askedBy: "Mathew" }, peter, "2026-11-14").ok);
check("nobody approves their own request (by short or full name)", !standInMay(s, { kind: "quote", money: "AED 10", askedBy: "Peter" }, peter, "2026-11-14").ok && !standInMay(s, { kind: "quote", money: "AED 10", askedBy: "peter paul" }, peter, "2026-11-14").ok);
check("someone else is never the stand-in", !standInMay(s, { kind: "quote", money: "AED 10", askedBy: "Arsalan" }, { id: "x", display_name: "Mathew" }, "2026-11-14").ok);
check("the words", onBehalfName("Peter") === "Peter on behalf of the owner" && standInNotice("Peter", "2026-11-20") === "Approvals go to Peter until 20 Nov" && summaryWords("Peter", [{ decision: "approved" }, { decision: "approved" }, { decision: "refused" }]) === "Peter today: 2 approved, 1 refused on your behalf");

process.exit(failed ? 1 : 0);
