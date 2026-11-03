// The optional round-off (3 November 2026): VAT stays exactly 5% of the taxable amount and the total
// lands on the chosen number; the limits; the owner-approval reason and its coverage.
//   node --import ./tests/unit/register.mjs tests/unit/roundoff.test.mjs        (npm run test:unit)
const { fitTotal, roundTargets, roundoffCheck, roundoffLimitsOf, roundoffWords, roundoffReason, roundoffReasonAmount } = await import("../../src/lib/roundoff.ts");
const { quoteTotals, ownerApprovalReasons, approvalCovers } = await import("../../src/lib/quotes.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const r2 = (n) => Math.round(n * 100) / 100;

// --- fitTotal: the owner's own example (Q-00039). 37,930.00 = 36,123.81 + VAT 1,806.19, VAT exactly 5%.
{
  const f = fitTotal(37930, 0.05);
  check("Q-00039: 37,930.00 splits 36,123.81 + 1,806.19", f.total === 37930 && f.taxable === 36123.81 && f.vat === 1806.19, JSON.stringify(f));
  check("VAT is exactly 5% of the taxable amount", r2(f.taxable * 0.05) === f.vat);
}
// VAT "exactly 5%" = 5% of the taxable amount to the nearest fils (half a fils may land either way).
const vatExact = (f) => Math.abs(f.vat - f.taxable * 0.05) <= 0.005 + 1e-9;
// Every whole-dirham target from 1 to 20,000 lands exactly, with VAT exactly 5%.
{
  let bad = 0;
  for (let t = 1; t <= 20000; t++) {
    const f = fitTotal(t, 0.05);
    if (f.total !== t || r2(f.taxable + f.vat) !== t || !vatExact(f)) bad++;
  }
  check("every whole total 1..20,000 lands exactly with VAT exactly 5%", bad === 0, `${bad} misses`);
}
// Fils targets land exactly or on the nearest reachable total, never with VAT off the 5%.
{
  let off = 0;
  let drift = 0;
  for (let i = 0; i < 5000; i++) {
    const t = r2(10 + i * 0.73);
    const f = fitTotal(t, 0.05);
    if (r2(f.taxable + f.vat) !== f.total || !vatExact(f)) off++;
    if (Math.abs(f.total - t) > 0.011) drift++;
  }
  check("5,000 fils targets: VAT always exactly 5%, total within a fils of the ask", off === 0 && drift === 0, `${off} off, ${drift} drifted`);
}

// --- roundTargets
{
  const t = roundTargets(37938.54, 10);
  check("nearest 10: down 37,930, up 37,940", t.down === 37930 && t.up === 37940);
  const one = roundTargets(37938.54, 1);
  check("nearest 1: down 37,938, up 37,939", one.down === 37938 && one.up === 37939);
  const whole = roundTargets(100, 10);
  check("already on the step: nothing to round", whole.down === null && whole.up === null);
  const low = roundTargets(40, 50);
  check("never to zero", low.down === null && low.up === 50);
}

// --- limits
const limits = roundoffLimitsOf({});
check("the defaults are down 100 / up 10", limits.downMax === 100 && limits.upMax === 10);
check("Settings override them", JSON.stringify(roundoffLimitsOf({ roundoff_down_limit_aed: "250", roundoff_up_limit_aed: 5 })) === JSON.stringify({ downMax: 250, upMax: 5 }));
{
  const adv = (target, extra = {}) => roundoffCheck({ current: 37938.54, target, isOwner: false, limits, ...extra });
  check("an advisor rounds down 8.54: allowed", !adv(37930).error && !adv(37930).needsOwner);
  check("an advisor rounds down 138.54: stored, goes to the owner", !adv(37800).error && adv(37800).needsOwner === true);
  check("the same on an invoice is refused in words", String(adv(37800, { refuseOverLimit: true }).error ?? "").includes("only the owner"));
  check("the owner rounds down any amount", !roundoffCheck({ current: 37938.54, target: 30000, isOwner: true, limits }).error);
  check("up 10 is the cap for everyone (owner too)", String(roundoffCheck({ current: 37938.54, target: 37950, isOwner: true, limits }).error ?? "").includes("limited to AED 10"));
  check("up within the cap is allowed", !adv(37940).error);
  check("an invoice never above the approved quotation total", String(adv(37940, { approvedCap: 37938.54 }).error ?? "").includes("approved quotation total"));
  check("zero or the same total is refused", !!adv(0).error && !!adv(37938.54).error);
}

// --- words and the owner-approval reason
check("the words", roundoffWords(-8.13) === "Round-off − AED 8.13" && roundoffWords(1.87) === "Round-off + AED 1.87");
{
  const reason = roundoffReason(134.29, 100);
  check("the reason names the figure and the limit", reason === "round-off AED 134.29 (limit AED 100)");
  check("its amount reads back", roundoffReasonAmount(reason) === 134.29 && roundoffReasonAmount("discount AED 5 = 1% of labour") === null);
  check("an approval covers a round-off that only went down", approvalCovers(reason, [roundoffReason(120, 100)]) && !approvalCovers(reason, [roundoffReason(150, 100)]));
}

// --- quoteTotals carries the round-off with VAT exactly 5%
{
  const lines = [
    { id: "l1", quotation_id: "q", is_active: true, line_type: "labour", title: "GEARBOX SERVICE", quantity: 1, hours: 10, labour_rate: 350, unit_cost: null, unit_price: null, markup_percent: 0, discount_percent: 0, line_total: 3500, position: 1 },
    { id: "l2", quotation_id: "q", is_active: true, line_type: "part", title: "OIL", quantity: 9, unit_cost: 40, markup_percent: 50, unit_price: null, hours: null, labour_rate: null, discount_percent: 0, line_total: 540, position: 2 },
  ];
  const q = { discount_percent: 0, vat_percent: 5, rounded_total_aed: null, discount_kind: null, discount_value: null, discount_scope: "labour", commission_kind: null, commission_value: null, commission_status: null, materials_cost_aed: 0, deposit_mode: null, deposit_value: null };
  const plain = quoteTotals(lines, q);
  check("without a round-off: 4,040 + 202 VAT", plain.net === 4040 && plain.vat === 202 && plain.total === 4242 && plain.rounding === 0, JSON.stringify({ net: plain.net, vat: plain.vat, total: plain.total }));
  const rounded = quoteTotals(lines, { ...q, rounded_total_aed: 4240 });
  check("rounded to 4,240: taxable 4,038.10 + VAT 201.90", rounded.total === 4240 && rounded.net === 4038.1 && rounded.vat === 201.9, JSON.stringify({ net: rounded.net, vat: rounded.vat, total: rounded.total, rounding: rounded.rounding }));
  check("VAT exactly 5% of the taxable amount", Math.abs(rounded.vat - rounded.net * 0.05) <= 0.005 + 1e-9);
  check("the round-off is the pre-VAT adjustment", rounded.rounding === r2(rounded.net - plain.net));
  check("profit moves by the round-off (net is the price before VAT)", r2(plain.profit - rounded.profit) === r2(plain.net - rounded.net));
  // The owner-approval reason fires only above the AED limit and never for the owner's own rounding.
  const totals = { total: rounded.total, discountBase: 0, discount: 0, rounding: -150 };
  const reasons = ownerApprovalReasons(q, [], totals, { discountLimit: 10, approvalAbove: 0, roundDownMax: 100 }, {});
  check("down 150 over the 100 limit is a reason", reasons.some((x) => x.startsWith("round-off AED 150.00")), JSON.stringify(reasons));
  check("the owner's own round-off is no reason", ownerApprovalReasons(q, [], totals, { discountLimit: 10, approvalAbove: 0, roundDownMax: 100 }, { roundingByOwner: true }).length === 0);
  check("down 80 under the limit is no reason", ownerApprovalReasons(q, [], { ...totals, rounding: -80 }, { discountLimit: 10, approvalAbove: 0, roundDownMax: 100 }, {}).length === 0);
}

console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
