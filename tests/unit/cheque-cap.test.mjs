// One cheque never more than its amount (11 November 2026, Section 5, AL ALI cheque 019383).
//   node --import ./tests/unit/register.mjs tests/unit/cheque-cap.test.mjs        (npm run test:unit)
const { chequeCapProblem, chequeAlreadyWords } = await import("../../src/lib/cheque-cap.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const sibs = [
  { number: "RCT-00057", amount: 2236.5, jobNumber: "J-00860", cleared: true, chequeTotal: null },
  { number: "RCT-00058", amount: 2131.5, jobNumber: "J-00858", cleared: true, chequeTotal: null },
];
check("the words name what is already on the cheque", chequeAlreadyWords("019383", sibs) === "Cheque 019383 is already recorded: RCT-00057 AED 2,236.50 (J-00860, cleared) + RCT-00058 AED 2,131.50 (J-00858, cleared) = AED 4,368.00.");
check("a first receipt on a cheque passes", chequeCapProblem({ chequeNumber: "1", amount: 500, siblings: [], typedTotal: null }) === null);
const dup = chequeCapProblem({ chequeNumber: "019383", amount: 2236.5, siblings: sibs, typedTotal: null });
check("RCT-00062 again on 019383 with no full amount: refused, asks for it", !!dup?.needsTotal && /already recorded/.test(dup.error));
const over = chequeCapProblem({ chequeNumber: "019383", amount: 2236.5, siblings: sibs, typedTotal: 4368 });
check("with the full amount 4,368 the duplicate goes above the cheque: refused", !!over && /more than the cheque/.test(over.error) && !over.needsTotal);
check("a real share within the cheque passes", chequeCapProblem({ chequeNumber: "9", amount: 1000, siblings: [{ number: "R1", amount: 2000, jobNumber: null, cleared: false, chequeTotal: 3000 }], typedTotal: null }) === null);
check("one receipt above its own cheque is refused", /more than the cheque/.test(chequeCapProblem({ chequeNumber: "9", amount: 3500, siblings: [], typedTotal: 3000 })?.error ?? ""));

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all passed");
