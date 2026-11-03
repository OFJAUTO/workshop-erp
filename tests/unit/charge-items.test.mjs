// Section 8 of 2 November 2026 (built 3 November): the Charges section shows the quotation's charges, every charge ONCE,
// and every charge's cost counts once (charge-items.ts).
//   node --import ./tests/unit/register.mjs tests/unit/charge-items.test.mjs        (npm run test:unit)
const C = await import("../../src/lib/charge-items.ts");
const { chargeItems, chargeCostsOnce, chargedTotal, recoveryAlready, recoveryAlreadyWords, recoveryWords, chargeLineCosts, isQuoteCharge, quoteChargeKind, rootLineOf, whereWords, shownVersions, chargeAmountWords, recoveryCostWords, belowCostWords, notBilledWords, readOnlyWords } = C;

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const line = (o) => ({ id: "l", quotation_id: "q1", position: 1, line_type: "other", title: "X", quantity: 1, unit_cost: null, markup_percent: null, markup_mode: "percent", markup_aed: null, unit_price: null, hours: null, labour_rate: null, discount_percent: 0, visible_to_customer: true, is_active: true, fee_kind: null, option_group: null, chosen: true, recovery_trips: null, recovery_provider: null, recovery_provider_kind: null, price_display: "normal", left_off: false, revised_from_line_id: null, recovery_paid_by: null, ...o });
const recovery = (o) => line({ line_type: "recovery", title: "RECOVERY, FULL DOWN, TWO WAYS", quantity: 2, recovery_trips: 2, unit_cost: 250, unit_price: 200, recovery_provider_kind: "external", recovery_provider: "E2E TOWING", recovery_paid_by: "customer", ...o });
const v = (id, number, version, status) => ({ id, number, version, status });
const row = (o) => ({ id: "c1", job_id: "j1", entry_id: null, kind: "recovery", description: "RECOVERY – FULL DOWN, TWO WAYS", provider: null, recovery_type: "full_down", trips: 2, litres: null, cost_aed: 540, supplier_trn: null, bill_path: null, charge_aed: 600, free: false, free_status: null, agreed_at: "2026-11-01T10:00:00Z", quotation_line_id: null, invoice_id: null, created_at: "2026-11-01T09:00:00Z", is_active: true, ...o });

/* ---------- 8.1: J-00969 - the approved quotation's recovery is listed ---------- */
const q39 = v("q1", "Q-00039", 1, "approved");
const rec = recovery({ id: "L1" });
const j969 = chargeItems({ rows: [], versions: [q39], lines: [rec] });
check("J-00969: the approved Q-00039's recovery is listed (it was missing: \"No recovery, fuel or other charges\")", j969.length === 1 && j969[0].source === "quotation");
check(`… with "on Q-00039 · approved" (${j969[0]?.whereWords})`, j969[0]?.whereWords === "on Q-00039 · approved");
check("… AED 400.00 charged, AED 500.00 quoted cost, counted", j969[0]?.charge === 400 && j969[0]?.quotedCost === 500 && j969[0]?.cost === 500 && j969[0]?.counted === true && j969[0]?.trips === 2);
check("… the bill is tied to the line's first version", j969[0]?.billRefId === "L1" && j969[0]?.rootLineId === "L1");
check(`… its words: ${recoveryWords(j969[0])}`, recoveryWords(j969[0]) === "RECOVERY, FULL DOWN, TWO WAYS · AED 400.00 · on Q-00039 · approved");

/* ---------- What is and is not a charge ---------- */
check("Consumables is not a charge", !isQuoteCharge(line({ title: "CONSUMABLES", unit_price: 150, unit_cost: 250 })));
check("The inspection fee line is not a charge", !isQuoteCharge(line({ title: "Inspection fee", unit_price: 750 })));
check("The automatic bank charge is not a charge", !isQuoteCharge(line({ line_type: "fee", fee_kind: "bank_charge", title: "BANK CHARGE" })));
check("A recovery the customer arranges (provider customer) is not a charge", !isQuoteCharge(recovery({ recovery_provider_kind: "customer" })));
check("An option not chosen / a line left off is not a charge", !isQuoteCharge(line({ option_group: "g", chosen: false })) && !isQuoteCharge(line({ left_off: true })));
check("An inactive line is not a charge", !isQuoteCharge(line({ is_active: false })));
check("RTA fees, parking, a courier: charges", isQuoteCharge(line({ title: "RTA FEES" })) && isQuoteCharge(line({ title: "PARTS COURIER CHARGES", unit_cost: 9000 })));
check("Fuel by its words, else Other", quoteChargeKind(line({ title: "FUEL 40 L" })) === "fuel" && quoteChargeKind(line({ title: "Petrol top-up" })) === "fuel" && quoteChargeKind(line({ title: "PARKING" })) === "other" && quoteChargeKind(rec) === "recovery");
const internal = chargeItems({ rows: [], versions: [q39], lines: [line({ id: "L9", title: "CAR WASH", visible_to_customer: false, unit_cost: 50 })] })[0];
check(`An Internal cost line shows as "Internal – not charged" (${chargeAmountWords(internal)}), its cost counted`, chargeAmountWords(internal) === "Internal – not charged" && internal.hidden && internal.charge === 0 && internal.cost === 50);
const comp = chargeItems({ rows: [], versions: [q39], lines: [recovery({ id: "L8", title: "COMPLIMENTARY PICK-UP & DROP-OFF", unit_price: 0, price_display: "complimentary", recovery_paid_by: "us" })] })[0];
check("A complimentary recovery shows \"Complimentary\" and keeps its cost", chargeAmountWords(comp) === "Complimentary" && comp.cost === 500 && comp.charge === 0);
check("AED + VAT words", chargeAmountWords(j969[0]) === "AED 400.00 + VAT");

/* ---------- Versions: never two versions of one line ---------- */
const v1 = v("q1", "Q-00039", 1, "approved");
const v2 = v("q2", "Q-00039", 2, "draft");
const l2 = recovery({ id: "L2", quotation_id: "q2", unit_price: 260, revised_from_line_id: "L1" });
const l3 = line({ id: "L3", quotation_id: "q2", title: "RTA FEES", unit_price: 120, position: 2 });
const rev = chargeItems({ rows: [], versions: [v1, v2], lines: [rec, l2, l3] });
check(`A revision being prepared: the approved line once (approved figures) + the new line (${rev.map((i) => `${i.id} ${i.whereWords}`).join(" | ")})`, rev.length === 2 && rev[0].id === "L1" && rev[0].charge === 400 && rev[0].whereWords === "on Q-00039 · approved" && rev[1].id === "L3" && rev[1].whereWords === "on Q-00039 v2 · being prepared");
check("… the new line on the draft does not count yet", rev[1].counted === false && rev[0].counted === true);
const v1s = v("q1", "Q-00039", 1, "superseded");
const v2a = v("q2", "Q-00039", 2, "approved");
const rev2 = chargeItems({ rows: [], versions: [v1s, v2a], lines: [rec, l2] });
check(`v2 approved: only v2's line, "on Q-00039 v2 · approved", still keyed to the first version (${rev2.map((i) => `${i.id}/${i.rootLineId}`).join(",")})`, rev2.length === 1 && rev2[0].id === "L2" && rev2[0].rootLineId === "L1" && rev2[0].whereWords === "on Q-00039 v2 · approved" && rev2[0].charge === 520);
check("shownVersions: approved + a revision under way; a declined number left out", shownVersions([v1, v2, v("q7", "Q-00041", 1, "declined")]).map((x) => x.id).join(",") === "q1,q2");
check("rootLineOf follows revisions and never loops", rootLineOf("L2", new Map([["L1", null], ["L2", "L1"]])) === "L1" && rootLineOf("A", new Map([["A", "B"], ["B", "A"]])) === "B" && rootLineOf("X", new Map([["X", "GONE"]])) === "GONE");
check("whereWords", whereWords({ number: "Q-00039", version: 1, status: "opened" }) === "on Q-00039 · opened by the customer" && whereWords({ number: "Q-00040", version: 3, status: "pending_owner" }) === "on Q-00040 v3 · waiting for the owner");

/* ---------- A job-card charge that went into a quotation shows ONCE ---------- */
const pushedLine = line({ id: "L5", title: "PARKING AT THE DEALER", unit_cost: 50, markup_percent: 20, unit_price: 60, position: 3 });
const pushedRow = row({ id: "c5", kind: "other", description: "PARKING AT THE DEALER", cost_aed: 50, charge_aed: 60, trips: null, agreed_at: null, quotation_line_id: "L5" });
const once = chargeItems({ rows: [pushedRow], versions: [q39], lines: [rec, pushedLine] });
check(`A pushed charge is one item (the job-card row) with "on Q-00039 · approved" (${once.map((i) => i.key).join(", ")})`, once.length === 2 && once.filter((i) => i.description === "PARKING AT THE DEALER").length === 1 && once.find((i) => i.id === "c5")?.whereWords === "on Q-00039 · approved");
check("… it bills what the quotation line says and keeps its own bill", once.find((i) => i.id === "c5")?.charge === 60 && once.find((i) => i.id === "c5")?.billRefId === "c5" && once.find((i) => i.id === "c5")?.lineId === "L5");
const pushedCopy = line({ id: "L6", quotation_id: "q2", title: "PARKING AT THE DEALER", unit_cost: 50, markup_percent: 20, revised_from_line_id: "L5", position: 3 });
const onceRev = chargeItems({ rows: [pushedRow], versions: [v1s, v2a], lines: [pushedLine, pushedCopy] });
check("… still once after a revision copies the line", onceRev.length === 1 && onceRev[0].id === "c5" && onceRev[0].lineId === "L6" && onceRev[0].whereWords === "on Q-00039 v2 · approved");
const gone = chargeItems({ rows: [pushedRow], versions: [q39], lines: [{ ...pushedLine, is_active: false }] });
check(`A pushed charge whose line was taken off: "${gone[0]?.whereWords}"`, gone[0]?.whereWords === "taken off Q-00039 – not charged" && gone[0]?.counted === true);
const declined = chargeItems({ rows: [pushedRow], versions: [v("q1", "Q-00039", 1, "declined")], lines: [pushedLine] });
check(`A pushed charge on a declined quotation: "${declined[0]?.whereWords}", its cost still counts`, declined[0]?.whereWords === "on Q-00039 · declined – not charged" && declined[0]?.counted === true);

/* ---------- Review fix: "not charged" is never counted as charged ---------- */
check(`Taken off: charge 0, "${chargeAmountWords(gone[0])}", not in "charged" (${chargedTotal(gone)})`, gone[0].charge === 0 && !gone[0].billed && gone[0].notCharged && chargeAmountWords(gone[0]) === "Not charged" && chargedTotal(gone) === 0);
check("Declined: charge 0, not in \"charged\"", declined[0].charge === 0 && chargedTotal(declined) === 0 && chargeAmountWords(declined[0]) === "Not charged");
check("A recovery taken off its quotation never asks 8.2 again", recoveryAlready(chargeItems({ rows: [row({ id: "c30", quotation_line_id: "L40" })], versions: [q39], lines: [recovery({ id: "L40", is_active: false })] })).length === 0);
const onDraft = chargeItems({ rows: [row({ id: "c31", kind: "fuel", description: "FUEL – 40 L", trips: null, cost_aed: 120, charge_aed: 130, agreed_at: null, quotation_line_id: "L41" })], versions: [v1, v2], lines: [rec, line({ id: "L41", quotation_id: "q2", title: "FUEL – 40 L", unit_cost: 120, markup_percent: 8.33, unit_price: 130 })] });
const fuelOnDraft = onDraft.find((i) => i.id === "c31");
check(`A job-card charge pushed onto a revision being prepared: its cost counts, it is charged once approved ("${notBilledWords(fuelOnDraft)}")`, fuelOnDraft.counted && !fuelOnDraft.billed && notBilledWords(fuelOnDraft) === "Charged to the customer once Q-00039 v2 is approved; its cost counts already." && chargedTotal(onDraft) === 400);
check("… once on the approved version it is charged", once.find((i) => i.id === "c5").billed && notBilledWords(once.find((i) => i.id === "c5")) === null);

/* ---------- Review fix: the below-cost words say only what happened ---------- */
const cheap = recovery({ id: "L50", unit_cost: 250, unit_price: 200 });
const cheapItem = chargeItems({ rows: [], versions: [q39], lines: [cheap] })[0];
check(`A quotation charge quoted below its cost before the rule, nobody told: "${belowCostWords(cheapItem)}"`, cheapItem.ownerKnows === null && belowCostWords(cheapItem) === "Costs more than it is charged.");
const approvedCheap = chargeItems({ rows: [], versions: [q39], lines: [{ ...cheap, below_cost_reason: "Regular customer", below_cost_at: "2026-11-02T10:00:00Z", below_cost_sell_aed: 400, below_cost_cost_aed: 500 }] })[0];
check(`… the owner approved it below cost: "${belowCostWords(approvedCheap)}"`, approvedCheap.ownerKnows === "approved" && belowCostWords(approvedCheap) === "Costs more than it is charged – the owner approved it.");
const billAbove = chargeItems({ rows: [], costRows: [{ id: "k5", quotation_line_id: "L50", cost_aed: 600, provider: null, supplier_trn: null, by_owner: false }], versions: [q39], lines: [{ ...cheap, below_cost_reason: "Regular customer", below_cost_at: "2026-11-02T10:00:00Z", below_cost_sell_aed: 400, below_cost_cost_aed: 500 }] })[0];
check(`… a higher bill typed by an advisor is not covered by that approval, and that save told the owner: "${belowCostWords(billAbove)}"`, billAbove.ownerKnows === "told" && belowCostWords(billAbove) === "Costs more than it is charged – the owner was told.");
const billByOwner = chargeItems({ rows: [], costRows: [{ id: "k6", quotation_line_id: "L50", cost_aed: 600, provider: null, supplier_trn: null, by_owner: true }], versions: [q39], lines: [cheap] })[0];
check("… the owner typed the bill himself: \"entered by the owner\"", billByOwner.ownerKnows === "owner" && belowCostWords(billByOwner) === "Costs more than it is charged – entered by the owner.");
const rowAbove = row({ id: "c40", kind: "other", description: "PARKING", trips: null, cost_aed: 90, charge_aed: 60, created_by: "S-ADVISOR" });
check("A job-card charge above its price, saved by an advisor: the owner was told", chargeItems({ rows: [rowAbove], versions: [], lines: [], owners: ["S-OWNER"] })[0].ownerKnows === "told");
check("… saved by the owner: entered by the owner", chargeItems({ rows: [{ ...rowAbove, created_by: "S-OWNER" }], versions: [], lines: [], owners: ["S-OWNER"] })[0].ownerKnows === "owner");

/* ---------- Review fix: how a quotation's charge changes ---------- */
check("Approved: only with a revised quotation the owner allows", readOnlyWords("approved").lead === "Read-only – it changes only with a revised " && readOnlyWords("approved").tail === ", which the owner allows.");
check("Draft: on the quotation itself", readOnlyWords("draft").lead === "Read-only here – change it on ");
check("Sent: with a new version", readOnlyWords("sent").lead === "Read-only here – it changes with a new version of ");

/* ---------- 8.1: the real cost from the bill ---------- */
const withBill = chargeItems({ rows: [], costRows: [{ id: "k1", quotation_line_id: "L1", cost_aed: 480, provider: "E2E TOWING CO", supplier_trn: "100000000000003" }], versions: [v1s, v2a], lines: [rec, l2] });
check("The bill's cost (typed on the job card, kept on the first version) replaces the estimate on v2", withBill[0].actualCost === 480 && withBill[0].cost === 480 && withBill[0].quotedCost === 500 && withBill[0].costRowId === "k1" && withBill[0].provider === "E2E TOWING CO");
check("chargeLineCosts: the shown line costs the bill's figure", chargeLineCosts(withBill).get("L2") === 480);
check("chargeLineCosts: a pushed job-card charge costs its own figure", chargeLineCosts(once).get("L5") === 50);

/* ---------- Every charge counts once ---------- */
const noTrips = chargeCostsOnce(j969, []);
check(`No trips: the recovery counts its estimate once (${noTrips.recovery})`, noTrips.recovery === 500 && noTrips.total === 500 && !noTrips.fromTrips);
check("No trips, the bill typed: the bill counts (480)", chargeCostsOnce(withBill, []).recovery === 480);
// The towing company's own trips on the Recovery page (Q-00039's recovery is by E2E TOWING).
const priced = chargeCostsOnce(j969, [{ id: "t1", price_aed: 220, company: "E2E Towing" }, { id: "t2", price_aed: 240, company: "E2E TOWING" }]);
check(`Two priced trips of the same company: the trips ARE the recovery cost, not trips + estimate (${priced.recovery}, was 960 before)`, priced.recovery === 460 && priced.fromTrips && priced.provisional.length === 0 && priced.tripKeys.includes(j969[0].key));
const half = chargeCostsOnce(j969, [{ id: "t1", price_aed: 220, company: "E2E TOWING" }, { id: "t2", price_aed: null, company: "E2E TOWING" }]);
check(`One of two trips priced: 220 + 250 estimate = 470 (${half.recovery}), "${half.provisional[0]}"`, half.recovery === 470 && half.provisional[0] === "recovery: 1 of 2 trips priced");
const extra = chargeCostsOnce(j969, [{ id: "t1", price_aed: 220, company: "E2E TOWING" }, { id: "t2", price_aed: 240, company: "E2E TOWING" }, { id: "t3", price_aed: 200, company: null }]);
check("A third trip (a package's complimentary one, our truck) counts on its own once priced", extra.recovery === 660);

/* ---------- Review fix: a trip replaces only the charge of whoever did it ---------- */
const towIn = row({ id: "c20", description: "RECOVERY – FULL DOWN, ONE WAY", provider: "ABC TOWING", trips: 1, cost_aed: 400, charge_aed: 450 });
const towItems = chargeItems({ rows: [towIn], versions: [], lines: [] });
const ownDelivery = chargeCostsOnce(towItems, [{ id: "t9", price_aed: 150, company: null }]);
check(`An outside tow-in (ABC TOWING, cost 400) + our own delivery trip (150): both count, 550 (${ownDelivery.recovery}), was 150`, ownDelivery.recovery === 550 && !ownDelivery.tripKeys.includes(towItems[0].key) && ownDelivery.provisional.length === 0);
check("… the same company's trip does replace it", chargeCostsOnce(towItems, [{ id: "t9", price_aed: 380, company: "ABC Towing LLC" }]).recovery === 380);
const quoteOutside = chargeCostsOnce(j969, [{ id: "t9", price_aed: 150, company: null }]);
check(`A quotation's outside recovery (E2E TOWING, 500) + our own delivery trip (150): 650 (${quoteOutside.recovery})`, quoteOutside.recovery === 650 && !quoteOutside.tripKeys.includes(j969[0].key));
const oursLine = chargeItems({ rows: [], versions: [q39], lines: [recovery({ id: "L30", recovery_provider_kind: "ours", recovery_provider: null })] });
check("A quotation recovery by our trucks is replaced by our trucks' priced trips", chargeCostsOnce(oursLine, [{ id: "a", price_aed: 180, company: null }, { id: "b", price_aed: 190, company: null }]).recovery === 370);
const anyRow = chargeItems({ rows: [row({ id: "c21", provider: null, trips: 1, cost_aed: 300 })], versions: [], lines: [] });
check("A job-card recovery with no provider typed takes any trip", chargeCostsOnce(anyRow, [{ id: "a", price_aed: 260, company: "XYZ RECOVERY" }]).recovery === 260);
check("\"OUR TRUCK\" typed as the provider is our own trucks", chargeItems({ rows: [row({ id: "c22", provider: "OUR TRUCK" })], versions: [], lines: [] })[0].who === "ours");

/* ---------- Review fix: once the car has left, the recorded trips are the truth ---------- */
const twoWays = chargeItems({ rows: [], versions: [q39], lines: [recovery({ id: "L31", recovery_provider_kind: "ours", recovery_provider: null })] });
const openOne = chargeCostsOnce(twoWays, [{ id: "d", price_aed: 200, company: null }], { open: true });
check(`Open job, TWO WAYS, only the delivery trip recorded: 200 + 250 estimate, "${openOne.provisional[0]}"`, openOne.recovery === 450 && openOne.provisional[0] === "recovery: 1 of 2 trips priced");
const closedOne = chargeCostsOnce(twoWays, [{ id: "d", price_aed: 200, company: null }], { open: false });
check(`Closed job, the same: the recorded trip only (${closedOne.recovery}), never provisional for good`, closedOne.recovery === 200 && closedOne.provisional.length === 0);
const closedUnpriced = chargeCostsOnce(twoWays, [{ id: "d", price_aed: null, company: null }], { open: false });
check(`Closed job, its one recorded trip not priced yet: the estimate stands in for it (${closedUnpriced.recovery}), "${closedUnpriced.provisional[0]}"`, closedUnpriced.recovery === 250 && closedUnpriced.provisional[0] === "recovery: 0 of 1 trip priced");

/* ---------- Review fix: the recovery cost line names what is priced and what is an estimate ---------- */
const dCase = chargeCostsOnce([{ key: "a", kind: "recovery", cost: 480, counted: true, trips: 2, who: "company", provider: "E2E TOWING CO" }, { key: "b", kind: "recovery", cost: 300, counted: true, trips: 1, who: "company", provider: "E2E TOWING CO" }], [{ id: "t1", price_aed: 220, company: "E2E TOWING CO" }, { id: "t2", price_aed: 240, company: "E2E TOWING CO" }]);
check(`Words: "${recoveryCostWords(dCase)}"`, dCase.recovery === 720 && recoveryCostWords(dCase) === "Recovery cost AED 720.00: AED 460.00 from 2 priced trips + AED 260.00 estimated for 1 trip still to price" && dCase.provisional[0] === "recovery: 2 of 3 trips priced");
check(`… with an outside tow that has no trip: "${recoveryCostWords(ownDelivery)}"`, recoveryCostWords(ownDelivery) === "Recovery cost AED 550.00: AED 150.00 from 1 priced trip + AED 400.00 from the recovery charge with no trip on the Recovery page");
check("… no trips, no line", recoveryCostWords(chargeCostsOnce(j969, [])) === null);
const fuel = row({ id: "c7", kind: "fuel", description: "FUEL – 40 L", trips: null, cost_aed: 120, charge_aed: 130, agreed_at: null });
const withFuel = chargeItems({ rows: [fuel], versions: [q39], lines: [rec] });
const fc = chargeCostsOnce(withFuel, []);
check(`A job-card fuel charge counts at once, before any invoice (other ${fc.other}, total ${fc.total})`, fc.other === 120 && fc.total === 620);
check("Charged so far: the counted charges (400 + 130)", chargedTotal(withFuel) === 530);
const draftOnly = chargeItems({ rows: [], versions: [v("q1", "Q-00039", 1, "sent")], lines: [rec] });
check("A quotation not approved yet: listed, its cost not counted", draftOnly.length === 1 && !draftOnly[0].counted && chargeCostsOnce(draftOnly, []).total === 0 && draftOnly[0].whereWords === "on Q-00039 · sent, waiting for the customer");
const both = chargeItems({ rows: [row({ id: "c9", quotation_line_id: null })], versions: [q39], lines: [rec] });
check("A check-in recovery AND a quotation recovery (a second trip the person confirmed): both count, as said", chargeCostsOnce(both, []).recovery === 1040);

/* ---------- 8.2: a recovery already on the car asks once ---------- */
const already = recoveryAlready(j969);
check("8.2: J-00969's recovery is already on the car", already.length === 1);
check("8.2: the quotation's own editor leaves its own quotation out", recoveryAlready(j969, { exceptNumber: "Q-00039" }).length === 0);
check("8.2: a job-card recovery counts too", recoveryAlready(chargeItems({ rows: [row({})], versions: [], lines: [] })).length === 1);
check("8.2: fuel and other never ask", recoveryAlready(withFuel).length === 1 && recoveryAlready(chargeItems({ rows: [fuel], versions: [], lines: [] })).length === 0);
const words = recoveryAlreadyWords(already);
check(`8.2 words: ${words}`, words === "Recovery already on this car: RECOVERY, FULL DOWN, TWO WAYS · AED 400.00 · on Q-00039 · approved. Another recovery charges the customer twice unless it is a different trip.");
check("8.2: a job-card recovery's words", recoveryWords(chargeItems({ rows: [row({})], versions: [], lines: [] })[0]) === "RECOVERY – FULL DOWN, TWO WAYS · AED 600.00 · agreed on the vehicle check-in");
check("8.2: nothing on the car, no question", recoveryAlreadyWords([]) === null);

console.log(failed ? `${failed} check(s) failed` : "All charge-items checks passed");
process.exit(failed ? 1 : 0);
