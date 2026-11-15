// Each part on exactly one invoice (15 November 2026, Section 2): THE rules.
//   node --import ./tests/unit/register.mjs tests/unit/lpo-invoice-move.test.mjs        (npm run test:unit)
const { coverageOf, linesOnInvoice, coverageProblems, invoicesCheck, moveProblem, shiftLines, doublePayProblem, lineValue } = await import("../../src/lib/lpo-invoice-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// The LPO-00086-1 case: 9 lines; spark plugs (4) on invoice B, idler pulley 2 on invoice C, the rest on the first (A).
const lines = [
  { id: "spark", description: "Spark plug", quantity: 4, received_qty: 4 },
  { id: "belt", description: "Drive belt", quantity: 1, received_qty: 1 },
  { id: "idler2", description: "Idler pully - 2", quantity: 1, received_qty: 1 },
];
const extras = [{ id: "B", number: "1260925546", date: "2026-11-13", lines: [{ line_id: "spark", qty: 4 }] }, { id: "C", number: "1260925555", date: "2026-11-13", lines: [{ line_id: "idler2", qty: 1 }] }];
const cov = coverageOf(lines, { entered: true, number: "1260925542", date: "2026-11-13", lines: null }, extras);
check("the first invoice shows only its own lines (not the spark plugs or idler 2)", JSON.stringify(linesOnInvoice(cov, "first").map((l) => l.lineId)) === JSON.stringify(["belt"]));
check("a further invoice shows only its own lines", linesOnInvoice(cov, extras[0].lines)[0]?.lineId === "spark" && linesOnInvoice(cov, extras[0].lines).length === 1);
check("no part on two invoices, none on no invoice", coverageProblems(cov).twice.length === 0 && coverageProblems(cov).none.length === 0);
const ok = invoicesCheck(cov, [1040.55, 218.4, 147], 1732.41);
check("running check: Invoices total AED 1,405.95 of the LPO's AED 1,732.41, no warning", ok.words === "Invoices total AED 1,405.95 of the LPO's AED 1,732.41" && ok.ok, ok.words);

// A part on two invoices (the first names its lines and still holds the spark plugs).
const covTwice = coverageOf(lines, { entered: true, number: "1260925542", date: "x", lines: [{ line_id: "spark", qty: 4 }, { line_id: "belt", qty: 1 }] }, extras);
check("a part on two invoices is found", coverageProblems(covTwice).twice.map((c) => c.lineId).join() === "spark");
const warn = invoicesCheck(covTwice, [1300, 218.4, 147], 1500);
check("the running check warns: over the LPO and SPARK PLUG on two invoices", !warn.ok && warn.warnings.some((w) => /more than the LPO/.test(w)) && warn.warnings.some((w) => /SPARK PLUG is on two invoices/.test(w)), JSON.stringify(warn.warnings));
const covNone = coverageOf(lines, { entered: true, number: "A", date: "x", lines: [{ line_id: "belt", qty: 1 }] }, [extras[0]]);
check("a part on no invoice is warned", invoicesCheck(covNone, [100, 218.4], 500).warnings.some((w) => /IDLER PULLY - 2 is on no invoice/.test(w)));

// Moving: from the first to an existing invoice, with a split quantity.
const ex = extras.map((e) => ({ ...e, paid: false }));
check("move 2 of 4 spark plugs from B to the first: allowed", moveProblem({ lineId: "spark", qty: 2, from: "B", to: "first" }, cov, ex, false, "1260925542") === null);
check("move more than the invoice has: refused", /has only 4/.test(moveProblem({ lineId: "spark", qty: 5, from: "B", to: "first" }, cov, ex, false, "1260925542") ?? ""));
check("move all of B's only line: refused (change the invoice instead)", /Every part would leave invoice 1260925546/.test(moveProblem({ lineId: "spark", qty: 4, from: "B", to: "C" }, cov, ex, false, "1260925542") ?? ""));
check("move onto a paid invoice: refused", /already paid/.test(moveProblem({ lineId: "spark", qty: 1, from: "B", to: "first" }, cov, ex, true, "1260925542") ?? ""));
check("move to the same invoice: refused", /another invoice/.test(moveProblem({ lineId: "spark", qty: 1, from: "B", to: "B" }, cov, ex, false, "A") ?? ""));
check("shiftLines splits and adds quantities", JSON.stringify(shiftLines([{ line_id: "spark", qty: 4 }], "spark", -2)) === JSON.stringify([{ line_id: "spark", qty: 2 }]) && shiftLines([{ line_id: "belt", qty: 1 }], "spark", 2).length === 2 && shiftLines([{ line_id: "spark", qty: 2 }], "spark", -2).length === 0);
check("the amount that moves: quantity × price", lineValue(2, 52) === 104 && lineValue(1, 140) === 140);

// Never paid twice.
const invs = [{ key: "po", number: "1260925542", lineIds: ["spark", "belt"], paid: false }, { key: "po~B", number: "1260925546", lineIds: ["spark"], paid: true }, { key: "po~C", number: "1260925555", lineIds: ["idler2"], paid: false }];
check("paying the first invoice while the spark plugs are paid on B: refused", /SPARK PLUG is on invoice 1260925542 and invoice 1260925546 \(already paid\)/.test(doublePayProblem(covTwice, invs, new Set(["po"])) ?? ""));
check("paying C (its own part only): allowed", doublePayProblem(covTwice, invs, new Set(["po~C"])) === null);
check("one part on two invoices both in the same payment: refused", /would be paid twice/.test(doublePayProblem(covTwice, invs.map((i) => ({ ...i, paid: false })), new Set(["po", "po~B"])) ?? ""));
check("no part on two invoices: never refused", doublePayProblem(cov, invs, new Set(["po", "po~B", "po~C"])) === null);

console.log(failed ? `${failed} failed` : "All lpo-invoice-move checks passed");
process.exit(failed ? 1 : 0);
