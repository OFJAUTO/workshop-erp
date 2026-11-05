// Parts changed after the customer's approval (5 November 2026, J-00985): the one rule, with J-00985's real figures.
//   node --import ./tests/unit/register.mjs tests/unit/parts-changes.test.mjs        (npm run test:unit)
const { partsChangesOf, costDeltaWords, needsApprovalAfter } = await import("../../src/lib/parts-changes.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// The six approved parts (on Q-00052 v2), all cancelled after approval; the eight new AL NABOODA parts.
const approved = [
  { part_item_id: "o1", unit_cost: 705.79, quantity: 1 },
  { part_item_id: "o2", unit_cost: 150.16, quantity: 1 },
  { part_item_id: "o3", unit_cost: 1352.66, quantity: 2 },
  { part_item_id: "o4", unit_cost: 529.51, quantity: 1 },
  { part_item_id: "o5", unit_cost: 150.16, quantity: 1 },
  { part_item_id: "o6", unit_cost: 702.86, quantity: 2 },
];
const gone = (id, d) => ({ id, description: d, cost: null, qty: 1, order_status: "none", live: false, reason: "Deleted from the Parts table" });
const fresh = (id, d, cost, qty) => ({ id, description: d, cost, qty, order_status: "none", live: true, reason: null });
const parts = [
  gone("o1", "BRAKE PADS"), gone("o2", "BRAKE PAD WEAR SENSOR"), gone("o3", "BRAKE DISC"), gone("o4", "BRAKE PADS"), gone("o5", "BRAKE PAD WEAR SENSOR"), gone("o6", "BRAKE DISC"),
  fresh("n1", "FRONT BRAKE PAD", 674.8, 1), fresh("n2", "FRONT BRAKE PAD SENSOR", 143.5, 1), fresh("n3", "FRONT BRAKE DISC", 1311.37, 2), fresh("n4", "REAR BRAKE PAD", 506.1, 1),
  fresh("n5", "RETAINING SPRING SET", 80.5, 1), fresh("n6", "FIT SWREW", 4.9, 4), fresh("n7", "REAR BRAKE PAD SENSOR", 143.5, 2), fresh("n8", "REAR BRAKE DISC", 672, 2),
];
const c = partsChangesOf(approved, parts);
check("J-00985: 8 added, 6 removed, 0 changed", c.added.length === 8 && c.removed.length === 6 && c.changed.length === 0);
check(`J-00985: the new parts cost AED 5,678.24 (${c.added.reduce((a, x) => a + x.total, 0).toFixed(2)})`, Math.abs(c.added.reduce((a, x) => a + x.total, 0) - 5678.24) < 0.005);
check(`J-00985: the removed parts were AED 5,646.66 (${c.removed.reduce((a, x) => a + x.oldTotal, 0).toFixed(2)})`, Math.abs(c.removed.reduce((a, x) => a + x.oldTotal, 0) - 5646.66) < 0.005);
check(`J-00985: "${c.words}"`, c.words === "Changes since approval: 8 added, 6 removed, cost + AED 31.58");
check("J-00985: all eight new parts need approval", c.needsApproval.length === 8 && c.needsApproval.every((id) => id.startsWith("n")));
check("a removed part keeps its reason", c.removed[0].reason === "Deleted from the Parts table");

// A cost changed on an approved part, a left-off part (on the quotation, order "none") is never "new".
const c2 = partsChangesOf([{ part_item_id: "a", unit_cost: 250, quantity: 2 }, { part_item_id: "left", unit_cost: 80, quantity: 1 }], [
  { id: "a", description: "STABILISER LINK", cost: 260, qty: 2, order_status: "to_order", live: true, reason: null },
  { id: "left", description: "WIPER BLADES", cost: 80, qty: 1, order_status: "none", live: true, reason: null },
]);
check(`a cost change reads as changed, old vs new (${c2.words})`, c2.changed.length === 1 && c2.changed[0].oldTotal === 500 && c2.changed[0].newTotal === 520 && c2.words === "Changes since approval: 1 changed, cost + AED 20.00");
check("a part left off the approved quotation is never new and never needs approval", c2.added.length === 0 && c2.needsApproval.length === 0);
// After "Resend for approval" the new parts are "to order" (then ordered, received): still ADDED since approval,
// no longer waiting for approval.
const resent = partsChangesOf(approved, parts.map((p) => (p.live ? { ...p, order_status: "to_order" } : p)));
check("after the resend: still 8 added (the card keeps the words), none needs approval", resent.added.length === 8 && resent.needsApproval.length === 0 && resent.words === c.words);
check("nothing changed: no words", partsChangesOf([{ part_item_id: "a", unit_cost: 10, quantity: 1 }], [{ id: "a", description: "X", cost: 10, qty: 1, order_status: "ordered", live: true, reason: null }]).words === null);
check("a new part not priced yet is listed as not priced", partsChangesOf([], [{ id: "z", description: "NEW", cost: null, qty: 1, order_status: "none", live: true, reason: null }]).added[0].priced === false);
check("cost words", costDeltaWords(31.58) === "cost + AED 31.58" && costDeltaWords(-12) === "cost − AED 12.00" && costDeltaWords(0.001) === "cost unchanged");
check("an ordered part off the quotation is not 'needs approval'", needsApprovalAfter({ id: "q", live: true, order_status: "ordered" }, new Set()) === false);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll parts-changes checks passed");
process.exit(failed ? 1 : 0);
