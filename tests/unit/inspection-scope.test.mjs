// The inspection type and "Could not check" (11 November 2026, Section 10).
//   node --import ./tests/unit/register.mjs tests/unit/inspection-scope.test.mjs        (npm run test:unit)
const { needsOf, autoNotCheckedReason, isDowngrade, scopeStatusWords, reportTitleOf, nowRunsWords, scopeLabel } = await import("../../src/lib/inspection-scope.ts");
const { reportProblemsOf } = await import("../../src/lib/inspection.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

check("a road test needs driving, the engine and power", ["driving", "engine", "power"].every((n) => needsOf({ key: "road_test_gearbox", label: "Gearbox shifting", sectionKey: "road_test" }).includes(n)));
check("headlights need power only", JSON.stringify(needsOf({ key: "headlights", label: "Headlights" })) === JSON.stringify(["power"]));
check("brake pads need nothing", needsOf({ key: "pads_front", label: "Front brake pads" }).length === 0);
check("doesn't start: the A/C cooling could not be checked (engine not running)", autoNotCheckedReason({ key: "ac", label: "A/C cooling" }, "no_start") === "engine not running");
check("no power: the headlights could not be checked", autoNotCheckedReason({ key: "headlights", label: "Headlights" }, "no_power") === "no battery power");
check("starts and drives: nothing impossible", autoNotCheckedReason({ key: "road", label: "Road test" }, "drives") === null);
check("complaints after full is a downgrade", isDowngrade("full", "complaints") && !isDowngrade("complaints", "full"));
check("the status never says complete with items waiting", scopeStatusWords("full", 34, 6) === "Full inspection: 34 checked · 6 pending");
check("the complaints title", reportTitleOf("complaints").title === "INSPECTION REPORT – CUSTOMER REQUESTS ONLY" && reportTitleOf("complaints").note === "OTHER SYSTEMS WERE NOT CHECKED.");
check("not set reads Type: not set", scopeLabel(null) === "Type: not set");
check("Car now runs words", nowRunsWords(6) === "Car now runs: 6 items still to check");
const state = { items: [{ key: "a", label: "Item A", sectionKey: "engine", status: null, remarks: "" }, { key: "b", label: "Item B", sectionKey: "engine", status: null, remarks: "" }], measurements: {} };
const p1 = reportProblemsOf({ ...state, notChecked: ["a"] }).map((p) => p.label);
check("an item marked Could not check is not 'not marked'", !p1.some((l) => /Item A/.test(l)) && p1.some((l) => /Item B: not marked/.test(l)));
const p2 = reportProblemsOf({ ...state, scope: "complaints" }).map((p) => p.label);
check("complaints only: unanswered items, tyres and measurements are not asked", !p2.some((l) => /not marked|tread|missing/.test(l)), p2.slice(0, 3).join("; "));

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all passed");
