// Inspection report: PCV valve and fuel injectors (13 November 2026, Section 14): THE rules.
//   node --import ./tests/unit/register.mjs tests/unit/pcv-injectors.test.mjs        (npm run test:unit)
const { itemStatusesFor, itemStatusLabel, engineOptionWords, itemExtraWords, hasStructuredDetail, DEFAULT_CHECKLIST, ENGINE_ONLY_KEYS } = await import("../../src/lib/inspection.ts");
const { autoNotCheckedReason, needsOf } = await import("../../src/lib/inspection-scope.ts");
const { quoteReferenceOf } = await import("../../src/lib/quote-reference.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const bay = DEFAULT_CHECKLIST.find((s) => s.key === "engine_bay").items.map((i) => i.key);
const at = bay.indexOf("engine_bay.intake_manifold");
check("both sit in Engine bay right after the intake manifold", bay[at + 1] === "engine_bay.pcv_valve" && bay[at + 2] === "engine_bay.fuel_injectors");
check("PCV answers: OK / Faulty, replace", itemStatusesFor("pcv").map((s) => itemStatusLabel(s, "pcv")).join(" / ") === "OK / Faulty, replace");
check("Injector answers: OK / Needs service and further check / Replace", itemStatusesFor("injector").map((s) => itemStatusLabel(s, "injector")).join(" / ") === "OK / Needs service and further check / Replace");
check("both need the engine running", needsOf({ key: "engine_bay.pcv_valve", label: "PCV valve" }).includes("engine") && needsOf({ key: "engine_bay.fuel_injectors", label: "Fuel injectors" }).includes("engine"));
check("a car that does not start: automatic 'Could not check' (engine not running)", autoNotCheckedReason({ key: "engine_bay.pcv_valve", label: "PCV valve" }, "no_start") === "engine not running" && autoNotCheckedReason({ key: "engine_bay.fuel_injectors", label: "Fuel injectors" }, "no_start") === "engine not running" && autoNotCheckedReason({ key: "engine_bay.fuel_injectors", label: "Fuel injectors" }, "drives") === null);
check("electric cars leave both off", ENGINE_ONLY_KEYS.includes("engine_bay.pcv_valve") && ENGINE_ONLY_KEYS.includes("engine_bay.fuel_injectors"));
check("optional details in words", engineOptionWords("engine_bay.pcv_valve", { pcv_in_valve_cover: "1" })[0] === "Built into the valve cover" && engineOptionWords("engine_bay.fuel_injectors", { injector_cylinders: "1,3" })[0] === "Cylinders 1, 3" && engineOptionWords("engine_bay.fuel_injectors", { injector_cylinders: "All" })[0] === "All cylinders");
check("the details reach the report and quotation words", itemExtraWords({ item_key: "engine_bay.fuel_injectors", style: "injector" }, { injector_cylinders: "2" }).includes("Cylinder 2"));
check("a PCV answer needs no written remark; an injector does until cylinders are picked", hasStructuredDetail({ label: "PCV valve", style: "pcv", status: "bad" }) && !hasStructuredDetail({ label: "Fuel injectors", style: "injector", status: "average" }, {}) && hasStructuredDetail({ label: "Fuel injectors", style: "injector", status: "average" }, { injector_cylinders: "1" }));

const item = (key, label, style, status) => ({ item_key: key, item_label: label, section_title: "Engine bay", section_key: "engine_bay", style, status, remarks: null, dangerous: false, service_due: false });
const ref = quoteReferenceOf({ inspection: { measurements: { injector_cylinders: "1,3" } }, items: [item("engine_bay.fuel_injectors", "Fuel injectors", "injector", "average"), item("engine_bay.pcv_valve", "PCV valve", "pcv", "bad")] }, []);
const inj = ref.findings.find((f) => f.sourceKey === "engine_bay.fuel_injectors");
const pcv = ref.findings.find((f) => f.sourceKey === "engine_bay.pcv_valve");
check("a fault lands in the quotation's 'Nothing quoted yet for' list (needs service counts)", inj?.status === "bad" && pcv?.status === "bad" && /Cylinders 1, 3/.test(inj?.remark ?? ""), JSON.stringify(ref.findings.map((f) => [f.sourceKey, f.status, f.remark])));

process.exit(failed ? 1 : 0);
