// The owner's month card (C3, 1 November 2026): on a month that starts on a Sunday the target so far is 0, so the
// card reads "Month just started" over an empty bar - never "100% of target (AED 0 by today)" or "AED −0 above".
//   node --import ./tests/unit/register.mjs tests/unit/month-card.test.mjs        (npm run test:unit)
const { aedWhole, monthCard } = await import("../../src/lib/month-card.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// Sunday 1 November 2026: no working day yet.
const sun = monthCard({ targetSoFar: 0, percent: 100, daysPassed: 0, breakEvenSoFar: 0 }, 0);
check(`1 Nov (Sunday): "${sun.words}"`, sun.words === "Month just started");
check("1 Nov: an empty bar", sun.empty && sun.barPercent === 0);
check("1 Nov: no 'short by' or 'above' line", sun.costs === null);
check("never −0", aedWhole(-0) === "AED 0" && aedWhole(-0.4) === "AED 0" && !/−|-/.test(aedWhole(-0.2)));
// Monday 2 November: one working day.
const mon = monthCard({ targetSoFar: 12000, percent: 25, daysPassed: 1, breakEvenSoFar: 9000 }, 3000);
check(`2 Nov: "${mon.words}"`, mon.words === "25% of target (AED 12,000 by today)" && mon.barPercent === 25 && !mon.empty);
check("2 Nov: short by 6,000", mon.costs?.kind === "short" && mon.costs.amount === 6000);
const above = monthCard({ targetSoFar: 12000, percent: 120, daysPassed: 1, breakEvenSoFar: 9000 }, 14400);
check("above the costs: 5,400 above, the bar full", above.costs?.kind === "above" && above.costs.amount === 5400 && above.barPercent === 100);
const even = monthCard({ targetSoFar: 12000, percent: 75, daysPassed: 1, breakEvenSoFar: 9000 }, 9000.2);
check("exactly even: 'AED 0 above', never −0", even.costs?.kind === "above" && aedWhole(even.costs.amount) === "AED 0");
const noTarget = monthCard({ targetSoFar: 0, percent: 100, daysPassed: 5, breakEvenSoFar: 0 }, 2000);
check(`no target in Settings: "${noTarget.words}", empty bar`, noTarget.words === "No daily target set" && noTarget.barPercent === 0);

console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
