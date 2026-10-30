// Complimentary work (30 October 2026, night batch section 5). The owner's case: Q-00038 on J-00937 (Porsche Cayenne),
// "PPF front right mirror housing" 1 h marked Complimentary plus our recovery "mentioned as free" - total AED 0, and the
// materials showed 0 although film was used. Now: it needs a reason and the owner, and the cost to us is worked out
// from THE calculation (labour at the cost rate, the film's share of a car, the recovery).
//   node --import ./tests/unit/register.mjs tests/unit/complimentary.test.mjs        (npm run test:unit)
const { compLinesOf, compCost, compCostWords, compProblem, compApprovalReason, customerCompWord, hasPpfPackage, normalPriceOf } = await import("../../src/lib/complimentary.ts");
const { quoteTotals } = await import("../../src/lib/quotes.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const near = (a, b) => Math.abs(a - b) < 0.006;

const line = (o) => ({ id: o.id, quotation_id: "q", position: 1, is_active: true, title: "", details: null, line_type: "labour", quantity: 1, hours: null, labour_rate: null, unit_price: null, unit_cost: null, markup_percent: null, discount_percent: 0, visible_to_customer: true, customer_approved: null, option_group: null, chosen: true, left_off: false, fee_kind: null, ...o });
const mirror = line({ id: "m", line_type: "labour", title: "PPF front right mirror housing", hours: 1, labour_rate: 350, price_display: "complimentary" });
const recovery = line({ id: "r", line_type: "recovery", title: "Recovery", quantity: 1, recovery_trips: 1, unit_cost: 150, unit_price: 0, recovery_paid_by: "us", recovery_mention_free: true, recovery_provider_kind: "outside" });
const paid = line({ id: "p", line_type: "labour", title: "Front bumper repair", hours: 2, labour_rate: 350 });
const q = { discount_percent: 0, vat_percent: 5, comp_reason: null, comp_note: null, comp_original_job_id: null };
const costing = { filmRollPriceGloss: 1429, filmRollPriceMatte: 1524, tintPerCar: 120, tintFactor: 1, tintExtraHours: 0, ceramicExteriorPerCar: 75, ceramicInteriorPerCar: 55, consumablesPerCar: 125, packageHours: 80, ratePerHour: 50, rolls: 1 };

const free = compLinesOf([mirror, recovery], q);
check("the free mirror housing and the free recovery both need the owner", free.map((l) => l.id).join(",") === "m,r", free.map((l) => l.id).join(","));
check("a paid line beside them is not free", compLinesOf([mirror, recovery, paid], q).every((l) => l.id !== "p"));
check("a 100% line discount counts as free", compLinesOf([{ ...paid, discount_percent: 100 }], q).length === 1);
check("\"Included\" alone is not a gift - unless the whole quotation totals nothing", compLinesOf([paid, line({ id: "i", line_type: "package", title: "Wheel clean", unit_price: 0, price_display: "included" })], q).length === 0);

const c = compCost(free, q, { technicianCostRate: 50, bodyshopRate: 50, packageCosting: costing }, { technician: 50, bodyshop: 50 });
check("materials are never 0 on PPF work: the film's share of a car (1 h of 80 h × AED 1,429)", near(c.film, 17.86) && c.materials > 0, JSON.stringify(c));
check("cost to us = labour 50 + film 17.86 + recovery 150", near(c.cost, 217.86) && near(c.labour, 50) && near(c.recovery, 150), `${c.cost}`);
check("the normal price is what the customer would have paid (1 h × AED 350)", near(c.normal, 350) && normalPriceOf(mirror) === 350);
check("the words read like the owner's example", compCostWords(c) === "Normal price AED 350.00 · Cost to us AED 217.86 (labour 50 · film 18 · recovery 150)", compCostWords(c));
check("the same film now shows in THE profit calculation", near(quoteTotals([mirror], q, { technicianCostRate: 50, packageCosting: costing }).packageMaterials.film, 17.86));

check("no reason: blocked", compProblem(q) === "Complimentary needs a reason: our mistake, goodwill or warranty");
check("goodwill without a note: blocked", /write why/.test(compProblem({ ...q, comp_reason: "goodwill" }) ?? ""));
check("our mistake without the original job: blocked", /original job/.test(compProblem({ ...q, comp_reason: "our_mistake" }) ?? ""));
check("our mistake with the original job: fine", compProblem({ ...q, comp_reason: "our_mistake", comp_original_job_id: "x" }) === null);
const reason = compApprovalReason([mirror, recovery], { ...q, comp_reason: "goodwill", comp_note: "Loyal customer" });
check("the owner's approval reason names the reason, the note, the lines and the normal price", reason === "complimentary (Goodwill gesture: Loyal customer): PPF front right mirror housing, Recovery · normal price AED 350.00", reason);
check("nothing free: no approval needed", compApprovalReason([paid], q) === null);

const ppfPkg = line({ id: "k", line_type: "package", title: "OFJ FULL PROTECTION PACKAGE", package_key: "full", unit_price: 20000, package_items: { key: "full", items: [{ label: "Full body paint protection film (PPF) – gloss, self healing" }] } });
check("with a PPF package the free pick-up and drop-off is pre-approved", hasPpfPackage([ppfPkg, recovery]) && compLinesOf([ppfPkg, recovery], q).length === 0);

check("goodwill on the customer's copy: COMPLIMENTARY (value AED 350.00)", customerCompWord(mirror, "goodwill") === "COMPLIMENTARY (value AED 350.00)");
check("our mistake and warranty: NO CHARGE", customerCompWord(mirror, "our_mistake") === "NO CHARGE" && customerCompWord(mirror, "warranty") === "NO CHARGE");
check("an older quotation with no reason keeps \"Complimentary\"; Included stays Included", customerCompWord(mirror, null) === "Complimentary" && customerCompWord({ price_display: "included" }, "goodwill") === "Included");
console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
