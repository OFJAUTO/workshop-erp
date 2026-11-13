// Team form with two clean levels (13 November 2026, Section 12): THE rules.
//   node --import ./tests/unit/register.mjs tests/unit/team-levels.test.mjs        (npm run test:unit)
const { levelOfDepartment, storedDepartmentOf, teamProblem, placeOf, roleTitleOf, LEVEL_TEAMS } = await import("../../src/lib/teams.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

check("three levels from the stored departments", levelOfDepartment("paint") === "bodyshop" && levelOfDepartment("ppf_tint") === "bodyshop" && levelOfDepartment("detailing") === "bodyshop" && levelOfDepartment("mechanical") === "mechanical" && levelOfDepartment("office") === "office");
check("Bodyshop > Painting is stored as paint, > PPF and tint as ppf_tint", storedDepartmentOf("bodyshop", "painting") === "paint" && storedDepartmentOf("bodyshop", "ppf") === "ppf_tint" && storedDepartmentOf("bodyshop", "detailing_cleaning") === "detailing" && storedDepartmentOf("bodyshop", "dismantle_refit") === "bodyshop" && storedDepartmentOf("bodyshop", null) === "bodyshop");
check("the Team box only offers the chosen department's teams", LEVEL_TEAMS.mechanical.map((t) => t.key).join() === "technicians,electricians,helpers" && LEVEL_TEAMS.bodyshop.map((t) => t.label).join() === "Dismantle & refit,PPF and tint,Painting,Detailing & cleaning" && LEVEL_TEAMS.office.length === 0);
check("a team from the other department is refused in words", teamProblem("mechanical", "painting") === "Pick a Mechanical team." && teamProblem("bodyshop", "helpers") === "Pick a Bodyshop team." && teamProblem("office", "ppf") !== null && teamProblem("bodyshop", "ppf") === null);

const moved = (p) => { const r = placeOf(p); return `${r.level}/${r.team ?? "-"}/${r.department}`; };
check("department paint becomes Bodyshop > Painting", moved({ role_id: "technician", department_id: "paint", team: "painting" }) === "bodyshop/painting/paint");
check("a bodyshop painter keeps Painting and gets the paint department", moved({ role_id: "technician", department_id: "bodyshop", team: "painting" }) === "bodyshop/painting/paint");
check("a PPF team in the mechanical department moves to Bodyshop > PPF and tint", moved({ role_id: "technician", department_id: "mechanical", team: "ppf" }) === "bodyshop/ppf/ppf_tint");
check("a mechanical team in the detailing department follows the department", moved({ role_id: "technician", department_id: "detailing", team: "technicians" }) === "bodyshop/detailing_cleaning/detailing");
check("a mechanic with no team becomes Mechanical > Technicians", moved({ role_id: "technician", department_id: "mechanical", team: null }) === "mechanical/technicians/mechanical");
check("an accountant in Mechanical moves to Office", moved({ role_id: "accounts", department_id: "mechanical", team: null }) === "office/-/office");
check("a QC inspector stays in Mechanical with no team", moved({ role_id: "qc_inspector", department_id: "mechanical", team: null }) === "mechanical/-/mechanical");
check("the bodyshop manager stays Bodyshop > Dismantle & refit", moved({ role_id: "workshop_manager", department_id: "bodyshop", team: "dismantle_refit" }) === "bodyshop/dismantle_refit/bodyshop");
check("a workshop manager on the bodyshop side reads Bodyshop manager", roleTitleOf({ role_id: "workshop_manager", department_id: "bodyshop", team: "dismantle_refit" }, "Workshop manager") === "Bodyshop manager" && roleTitleOf({ role_id: "workshop_manager", department_id: "mechanical", team: null }, "Workshop manager") === "Workshop manager");

const { onTabletDepartment } = await import("../../src/lib/device-department.ts");
check("a Bodyshop tablet includes every bodyshop team (even one filed under Mechanical)", onTabletDepartment("bodyshop", "mechanical", "ppf") && onTabletDepartment("bodyshop", "paint", "painting") && onTabletDepartment("bodyshop", "detailing", null) && !onTabletDepartment("bodyshop", "mechanical", "technicians") && onTabletDepartment("workshop", "mechanical", null));

process.exit(failed ? 1 : 0);
