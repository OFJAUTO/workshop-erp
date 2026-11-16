// The stock report (16 November 2026, Section 1): THE count and value as of any day, rebuilt from the movements.
//   node --import ./tests/unit/register.mjs tests/unit/stock-report.test.mjs        (npm run test:unit)
const { stockAsOf, itemAsOf, endOfDubaiDay, lastMonthEnd, movementValue } = await import("../../src/lib/stock-report-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const item = { id: "oil", name: "Engine oil 5W30", part_number: "OIL-1", item_type: "consumable", unit: "l", created_at: "2026-10-01T06:00:00Z", quantity: 26, unit_cost: 22.5, is_active: true };
// 20 l in at 20, 10 used on a job, 16 l in at 25 (average 22.5), a count -0... and 0 adjustments.
const moves = [
  { id: "m1", stock_item_id: "oil", kind: "in", quantity: 20, unit_cost: 20, quantity_after: 20, created_at: "2026-10-02T06:00:00Z" },
  { id: "m2", stock_item_id: "oil", kind: "out", quantity: -10, unit_cost: 20, quantity_after: 10, created_at: "2026-10-10T06:00:00Z", job_id: "j1" },
  { id: "m3", stock_item_id: "oil", kind: "in", quantity: 16, unit_cost: 25, quantity_after: 26, created_at: "2026-11-03T06:00:00Z" },
];
const before = stockAsOf([item], moves, "2026-10-01");
check("before anything came in: nothing on the shelf", before.rows.length === 0 && before.totalValue === 0);
const oct5 = stockAsOf([item], moves, "2026-10-05");
check("5 Oct: 20 l at 20.00 = 400.00", oct5.rows[0]?.quantity === 20 && oct5.rows[0]?.unitCost === 20 && oct5.totalValue === 400, JSON.stringify(oct5.rows[0]));
const oct31 = stockAsOf([item], moves, "2026-10-31");
check("31 Oct (month end): 10 l at 20.00 = 200.00", oct31.rows[0]?.quantity === 10 && oct31.totalValue === 200, JSON.stringify(oct31.rows[0]));
const nov = stockAsOf([item], moves, "2026-11-16");
check("16 Nov: 26 l, weighted average (10×20 + 16×25)/26 = 23.08, value 600.08", nov.rows[0]?.quantity === 26 && nov.rows[0]?.unitCost === 23.08 && Math.abs(nov.totalValue - 600.08) < 0.01, JSON.stringify(nov.rows[0]));
check("a movement late on a Dubai day counts on that day (23:30 Dubai = 19:30 UTC)", itemAsOf(item, [{ id: "x", stock_item_id: "oil", kind: "in", quantity: 5, unit_cost: 10, quantity_after: 5, created_at: "2026-10-02T19:30:00Z" }], endOfDubaiDay("2026-10-02")).quantity === 5);
const opening = { ...item, id: "pads", name: "Brake pads", quantity: 3, created_at: "2026-09-01T06:00:00Z", unit_cost: 100 };
check("an item made with a quantity and no movement yet: its quantity from the day it was made", stockAsOf([opening], [], "2026-10-01").rows[0]?.quantity === 3);
check("an item made after the day: nothing", stockAsOf([{ ...opening, created_at: "2026-12-01T00:00:00Z" }], [], "2026-10-01").rows.length === 0);
check("last month end of 16 Nov is 31 Oct; of 1 Mar is 28/29 Feb", lastMonthEnd("2026-11-16") === "2026-10-31" && lastMonthEnd("2027-03-01") === "2027-02-28");
check("a movement's value is signed (out negative)", movementValue({ quantity: -10, unit_cost: 20 }) === -200 && movementValue({ quantity: 16, unit_cost: 25 }) === 400);

console.log(failed ? `${failed} failed` : "All stock-report checks passed");
process.exit(failed ? 1 : 0);
