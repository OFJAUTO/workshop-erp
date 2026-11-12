// 12 November 2026: auto-approve while the owner is away - the pure rules (which types, the limits, the end date, the log).
//   node --import ./tests/unit/register.mjs tests/unit/auto-approve.test.mjs        (npm run test:unit)
const R = await import("../../src/lib/auto-approve-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const d = R.defaultConfig();
const ticked = R.AUTO_TYPES.filter((t) => d.types[t.key].on).map((t) => t.key).sort();
check("only the free items are pre-ticked", JSON.stringify(ticked) === JSON.stringify(["comp_goodwill", "comp_our_mistake", "comp_recovery", "comp_warranty", "free_charge_recovery"]), ticked.join(","));
check("off until the owner switches it on", d.on === false && !R.isActive(d, "2026-11-12"));

const on = { ...d, on: true, until: "2026-11-20" };
check("on, within the end date", R.isActive(on, "2026-11-20"));
check("switched off by itself after the end date", !R.isActive(on, "2026-11-21"));
check("on with no end date", R.isActive({ ...on, until: null }, "2027-01-01"));

const comp = "complimentary (Goodwill gesture: loyal customer): RECOVERY · normal price AED 150.00";
const f = { discount: 0, roundDown: 0, total: 1000, compCost: 150, compReason: "goodwill", compAllRecovery: true };
check("a complimentary quotation (goodwill) is approved by itself", R.quoteAutoDecision(on, [comp], f).ok);
const disc = "discount AED 600.00 = 20.0% of labour (limit 15%)";
const mixed = R.quoteAutoDecision(on, [comp, disc], { ...f, discount: 600 });
check("complimentary + a discount above the limit (not ticked): it goes to the owner, nothing half-approved", !mixed.ok && mixed.blocking.length === 1 && mixed.blocking[0] === disc);
const limited = { ...on, types: { ...on.types, comp_goodwill: { on: true, limit: 100 }, comp_recovery: { on: true, limit: 100 } } };
check("above the cost limit: it goes to the owner", !R.quoteAutoDecision(limited, [comp], f).ok);
check("at the cost limit: approved", R.quoteAutoDecision({ ...limited, types: { ...limited.types, comp_goodwill: { on: true, limit: 150 } } }, [comp], f).ok);
const noGoodwill = { ...on, types: { ...on.types, comp_goodwill: { on: false, limit: null } } };
check("goodwill unticked but free recovery only, recovery ticked: approved as complimentary recovery", R.quoteAutoDecision(noGoodwill, [comp], f).types.join() === "comp_recovery");
check("goodwill unticked and not only recovery: to the owner", !R.quoteAutoDecision(noGoodwill, [comp], { ...f, compAllRecovery: false }).ok);
check("an unknown reason always goes to the owner", !R.quoteAutoDecision(on, ["something new"], f).ok);
check("the reasons' types are read from their words", R.quoteReasonType(disc) === "quote_discount" && R.quoteReasonType("round-off AED 120.00 (limit AED 100)") === "quote_roundoff" && R.quoteReasonType("Total of AED 90,000.00 is above AED 50,000.00") === "quote_total" && R.quoteReasonType("BRAKE PADS: part discount of 10%") === "quote_discount");

check("a free recovery charge is its own type", R.freeChargeType("recovery") === "free_charge_recovery" && R.freeChargeType("fuel") === "free_charge_other");
check("a free fuel charge is not ticked by default", !R.typeAllows(on, "free_charge_other", 50));

const note = R.autoLogNote("Q-00012 v1 – complimentary", "Peter", 1234.5);
check("the log line", note === "AUTO-APPROVED (OWNER AWAY): Q-00012 v1 – complimentary · asked by Peter · cost to us AED 1,234.50", note);
check("the cost read back from the log line", R.costFromNote(note) === 1234.5);
check("the evening summary", R.summaryWords(3, 900) === "Auto-approved today: 3 items, total cost AED 900.00");

const read = R.readConfig({ on: true, until: "bad", types: { comp_goodwill: { on: false, limit: "abc" }, nonsense: { on: true } } });
check("a stored value is read safely (bad date dropped, bad limit = no limit, unknown type ignored)", read.on && read.until === null && read.types.comp_goodwill.on === false && read.types.comp_goodwill.limit === null && !("nonsense" in read.types));

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
